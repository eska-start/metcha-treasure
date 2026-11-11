// 멧챠 보물찾기 — camera treasure hunt, fully static (GitHub Pages).
// The game link carries the settings and a random seed, so every phone computes the SAME treasure spots and prizes.
// Only "who joined / who opened which chest" goes through a tiny public relay (ntfy.sh) under an unguessable room topic.
// No GPS position ever leaves the phone.
'use strict';

const RELAY = 'https://ntfy.sh';
const OPEN_M = 10;
const RANK = { 0: '꽝', 1: '1등', 2: '2등', 3: '3등' };
const MEDAL = { 1: '🥇', 2: '🥈', 3: '🥉' };
const TEAMS = [
  { id: 'red', name: '빨강 팀', color: '#ff6b6b' }, { id: 'blue', name: '파랑 팀', color: '#4dabf7' },
  { id: 'green', name: '초록 팀', color: '#51cf66' }, { id: 'yellow', name: '노랑 팀', color: '#fcc419' },
];
const NAMES = ['도토리', '솔방울', '반딧불', '조약돌', '나뭇잎', '버섯', '별사탕', '무지개', '구름빵', '달팽이', '민들레', '모닥불'];

const $app = document.getElementById('app');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const store = {
  get(k) { try { return localStorage.getItem('mt:' + k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem('mt:' + k, v); } catch {} },
};
function toast(msg, ms = 2600) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.hidden = false;
  clearTimeout(toast.h); toast.h = setTimeout(() => (t.hidden = true), ms);
}
const rid = (n) => { const a = new Uint8Array(n); crypto.getRandomValues(a); return Array.from(a, (b) => 'abcdefghijkmnpqrstuvwxyz23456789'[b % 32]).join(''); };

// ---------- link payload  (#/g/<payload> = play, #/h/<payload> = host)
const b64e = (o) => btoa(unescape(encodeURIComponent(JSON.stringify(o)))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const b64d = (s) => JSON.parse(decodeURIComponent(escape(atob(s.replace(/-/g, '+').replace(/_/g, '/')))));
const baseUrl = () => location.href.split('#')[0];
const gameLink = (cfg) => `${baseUrl()}#/g/${b64e(cfg)}`;

// ---------- seeded random → identical treasures on every phone
function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
function scatter(cfg, seed) {
  const R = rng(seed), n = cfg.n, rad = cfg.r;
  const mLat = 1 / 111320, mLng = 1 / (111320 * Math.cos((cfg.lat * Math.PI) / 180));
  let gap = Math.max(4, (rad / Math.sqrt(n)) * 0.9);
  const pts = [];
  while (pts.length < n) {
    let placed = false;
    for (let tries = 0; tries < 400 && !placed; tries++) {
      const rr = 3 + Math.sqrt(R()) * (rad - 3), a = R() * Math.PI * 2;
      const p = { x: Math.cos(a) * rr, y: Math.sin(a) * rr };
      if (pts.every((q) => Math.hypot(q.x - p.x, q.y - p.y) >= gap)) { pts.push(p); placed = true; }
    }
    if (!placed) gap *= 0.8;
  }
  const prizes = [];
  for (const k of [1, 2, 3]) for (let i = 0; i < cfg.pz[k][0]; i++) prizes.push(k);
  while (prizes.length < n) prizes.push(0);
  for (let i = prizes.length - 1; i > 0; i--) { const j = Math.floor(R() * (i + 1)); [prizes[i], prizes[j]] = [prizes[j], prizes[i]]; }
  return pts.map((p, i) => ({ id: i, lat: cfg.lat + p.y * mLat, lng: cfg.lng + p.x * mLng, prize: prizes[i] }));
}

// ---------- geo
const toR = Math.PI / 180;
function distM(a, b) {
  const dLat = (b.lat - a.lat) * toR, dLng = (b.lng - a.lng) * toR;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * toR) * Math.cos(b.lat * toR) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.sqrt(s));
}
function bearing(a, b) {
  const y = Math.sin((b.lng - a.lng) * toR) * Math.cos(b.lat * toR);
  const x = Math.cos(a.lat * toR) * Math.sin(b.lat * toR) - Math.sin(a.lat * toR) * Math.cos(b.lat * toR) * Math.cos((b.lng - a.lng) * toR);
  return (Math.atan2(y, x) / toR + 360) % 360;
}
const wrap180 = (d) => ((((d + 180) % 360) + 360) % 360) - 180;
function sampleGps(ms, onTick) {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error('이 폰은 위치를 못 써요'));
    const pts = [];
    const w = navigator.geolocation.watchPosition(
      (p) => { pts.push(p.coords); onTick?.(p.coords); },
      (e) => { navigator.geolocation.clearWatch(w); reject(new Error(e.code === 1 ? '위치 권한을 허용해 주세요' : '위치를 못 찾았어요')); },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 });
    setTimeout(() => {
      navigator.geolocation.clearWatch(w);
      if (!pts.length) return reject(new Error('위치를 못 찾았어요. 하늘이 보이는 곳에서 다시 해 주세요'));
      let sw = 0, la = 0, ln = 0, best = 1e9;
      for (const c of pts) { const k = 1 / Math.max(3, c.accuracy) ** 2; sw += k; la += c.latitude * k; ln += c.longitude * k; best = Math.min(best, c.accuracy); }
      resolve({ lat: la / sw, lng: ln / sw, acc: Math.round(best) });
    }, ms);
  });
}

// ---------- sound
const Sound = {
  ctx: null,
  unlock() {
    if (!this.ctx) { try { this.ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch { return; } }
    if (this.ctx.state === 'suspended') this.ctx.resume();
  },
  tone(f, at, len, vol, type = 'sine', f2) {
    const c = this.ctx; if (!c) return;
    const t0 = c.currentTime + 0.02 + at, o = c.createOscillator(), e = c.createGain();
    o.type = type; o.frequency.setValueAtTime(f, t0); if (f2) o.frequency.linearRampToValueAtTime(f2, t0 + len);
    e.gain.setValueAtTime(0, t0); e.gain.linearRampToValueAtTime(vol, t0 + 0.02); e.gain.exponentialRampToValueAtTime(0.001, t0 + len);
    o.connect(e); e.connect(c.destination); o.start(t0); o.stop(t0 + len + 0.05);
  },
  whistle(vol, pan = 0) {
    const c = this.ctx; if (!c) return;
    const t0 = c.currentTime + 0.02, out = c.createGain();
    let dest = c.destination;
    if (c.createStereoPanner) { const p = c.createStereoPanner(); p.pan.value = Math.max(-1, Math.min(1, pan)); p.connect(dest); dest = p; }
    out.connect(dest);
    for (const [at, len, f0, f1, f2] of [[0, 0.22, 1500, 2300, 2300], [0.32, 0.62, 1700, 2500, 1900]]) {
      const o = c.createOscillator(), e = c.createGain(), lfo = c.createOscillator(), lg = c.createGain();
      lfo.frequency.value = 6; lg.gain.value = 22; lfo.connect(lg); lg.connect(o.frequency);
      e.gain.setValueAtTime(0, t0 + at); e.gain.linearRampToValueAtTime(0.45 * vol, t0 + at + 0.05); e.gain.setValueAtTime(0.45 * vol, t0 + at + len * 0.75); e.gain.linearRampToValueAtTime(0, t0 + at + len);
      o.frequency.setValueAtTime(f0, t0 + at); o.frequency.linearRampToValueAtTime(f1, t0 + at + len * 0.4); o.frequency.linearRampToValueAtTime(f2, t0 + at + len);
      o.connect(e); e.connect(out); o.start(t0 + at); lfo.start(t0 + at); o.stop(t0 + at + len + 0.05); lfo.stop(t0 + at + len + 0.05);
    }
  },
  fanfare() { [523, 659, 784, 1047, 784, 1047, 1319].forEach((f, i) => this.tone(f, i * 0.11, 0.35, 0.3, 'triangle')); },
  boing() { this.tone(300, 0, 0.5, 0.35, 'sine', 120); this.tone(180, 0.25, 0.5, 0.25, 'triangle', 90); },
  boop(f = 660) { this.tone(f, 0, 0.18, 0.2); },
};

// ---------- the shared game state, rebuilt from the relay's message log (same order on every phone)
class Game {
  constructor(cfg) {
    this.cfg = cfg;
    this.seed = cfg.s;
    this.treasures = scatter(cfg, this.seed);
    this.players = new Map();
    this.opened = new Map(); // treasure id -> player id
    this.ended = false;
    this.feed = [];
    this.listeners = new Set();
    this.seen = new Set();
    this.waiting = new Map(); // treasure id -> resolve (my pending open)
    this.online = false;
  }
  connect() {
    // since=all replays the room history, so late joiners get the same state
    const es = new EventSource(`${RELAY}/${this.cfg.tp}/sse?since=all`);
    es.onopen = () => { this.online = true; this.emit(); };
    es.onerror = () => { this.online = false; this.emit(); };
    es.onmessage = (e) => {
      let m; try { m = JSON.parse(e.data); } catch { return; }
      if (m.event !== 'message' || this.seen.has(m.id)) return;
      this.seen.add(m.id);
      let msg; try { msg = JSON.parse(m.message); } catch { return; }
      this.apply(msg, m.time * 1000, m.id);
    };
    this.es = es;
  }
  close() { this.es?.close(); }
  async send(msg) {
    const res = await fetch(`${RELAY}/${this.cfg.tp}`, { method: 'POST', body: JSON.stringify(msg) });
    if (!res.ok) throw new Error(res.status === 429 ? '잠깐만요, 너무 빨라요! 조금 뒤에 다시' : '연결이 불안해요');
  }
  apply(m, t) {
    const live = Date.now() - t < 15000; // only fresh events make toasts/sounds
    if (m.t === 'join' && m.p) {
      const isNew = !this.players.has(m.p);
      this.players.set(m.p, { name: String(m.n || '?').slice(0, 12), team: TEAMS.some((x) => x.id === m.tm) ? m.tm : 'red' });
      if (isNew) this.feed.push({ t, kind: 'join', text: `${this.players.get(m.p).name} 들어왔어요`, by: m.p });
    } else if (m.t === 'open' && m.s === this.seed && !this.ended) {
      const tr = this.treasures[m.i];
      if (tr && !this.opened.has(tr.id)) {
        this.opened.set(tr.id, m.p);
        const name = this.players.get(m.p)?.name || '누군가';
        const pz = tr.prize ? this.cfg.pz[tr.prize][1] : '';
        this.feed.push({ t, kind: tr.prize ? 'win' : 'miss', by: m.p, prize: tr.prize, live,
          text: tr.prize ? `${name}: ${RANK[tr.prize]} 당첨!${pz ? ` (${pz})` : ''}` : `${name}: 꽝!` });
        if (!this.treasures.some((x) => x.prize && !this.opened.has(x.id))) { this.ended = true; this.feed.push({ t, kind: 'end', text: '상품을 전부 찾았어요! 끝!', live }); }
      }
      this.waiting.get(m.i)?.(); this.waiting.delete(m.i);
    } else if (m.t === 'reseed' && Number.isInteger(m.s)) {
      this.seed = m.s; this.treasures = scatter(this.cfg, m.s); this.opened.clear(); this.ended = false;
      this.feed = [{ t, kind: 'start', text: '보물이 새로 숨었어요!', live }];
    } else if (m.t === 'end') {
      if (!this.ended) { this.ended = true; this.feed.push({ t, kind: 'end', text: '보물찾기 끝!', live }); }
    }
    this.emit();
  }
  emit() { for (const f of this.listeners) f(this); }
  /** Ask to open; resolves once the relay has ordered it. Whoever's message came first owns the chest. */
  async open(i, me) {
    const wait = new Promise((resolve) => { this.waiting.set(i, resolve); setTimeout(resolve, 8000); });
    await this.send({ t: 'open', s: this.seed, i, p: me });
    await wait;
    const by = this.opened.get(i);
    if (by === me) return { ok: true, prize: this.treasures[i].prize, name: this.treasures[i].prize ? this.cfg.pz[this.treasures[i].prize][1] : '' };
    if (by) return { ok: false, already: true, by: this.players.get(by)?.name || '누군가' };
    return { ok: false, error: '연결이 불안해요. 다시 눌러 주세요' };
  }
  prizeLeft() {
    const out = {};
    for (const k of [1, 2, 3]) out[k] = this.treasures.filter((x) => x.prize === k && !this.opened.has(x.id)).length;
    return out;
  }
}

function prizeChips(g) {
  const left = g.prizeLeft(), cls = { 1: 'gold', 2: 'silver', 3: 'bronze' };
  return [1, 2, 3].filter((k) => g.cfg.pz[k][0]).map((k) =>
    `<span class="chip ${cls[k]} ${left[k] ? '' : 'out'}">${MEDAL[k]} ${RANK[k]} ${left[k]}/${g.cfg.pz[k][0]}</span>`).join('');
}
const teamOf = (id) => TEAMS.find((t) => t.id === id) || TEAMS[0];
function qrImg(text, cell = 4) {
  if (typeof qrcode !== 'function') return '';
  const q = qrcode(0, 'L'); q.addData(text); q.make();
  return q.createDataURL(cell, 2);
}

// ---------- router (hash based, works on GitHub Pages)
let cleanup = [];
const go = (h) => { location.hash = h; };
window.addEventListener('hashchange', () => route());
function route() {
  for (const f of cleanup) f(); cleanup = [];
  document.querySelectorAll('.ar,.start,.result').forEach((e) => e.remove());
  const [, kind, payload] = (location.hash || '#/').split('/');
  let cfg = null;
  if (payload) { try { cfg = b64d(payload); } catch { cfg = null; } }
  if (kind === 'new') return newScreen();
  if ((kind === 'h' || kind === 'g') && !cfg) { $app.innerHTML = '<div class="card"><h2>링크가 망가졌어요</h2><p>진행자에게 QR을 다시 받아 주세요.</p><a class="btn" href="#/">처음으로</a></div>'; return; }
  if (kind === 'h') return hostScreen(cfg);
  if (kind === 'g') return playScreen(cfg);
  homeScreen();
}

function homeScreen() {
  $app.innerHTML = `
    <div class="hero"><img src="metcha.svg" alt=""><h1>멧챠 보물찾기</h1>
    <p class="muted">멧챠가 숨겨둔 보물상자를 카메라로 찾아요!<br>1등, 2등, 3등… 아니면 꽝?</p></div>
    <div class="card"><h2>보물 찾으러 가기</h2>
      <p>진행자 폰에 나온 <b>QR을 카메라로 찍으면</b> 바로 들어와요.</p>
    </div>
    <div class="card"><h2>보물 숨기기 (진행자)</h2>
      <p class="muted">놀이터 한가운데에서 버튼 한 번이면 보물이 알아서 숨어요.</p>
      <button class="sun big" onclick="go('#/new')">새 보물찾기 만들기</button>
    </div>
    <p class="muted" style="text-align:center">상자를 연 기록(별명·상자 번호)만 공개 중계 서버(ntfy.sh)로 오가요. 위치는 폰 밖으로 안 나가요.</p>`;
}

// ---------- new game (host)
function newScreen() {
  const cfg = { r: 40, n: 12, pz: { 1: [1, ''], 2: [2, ''], 3: [3, ''] } };
  const draw = () => {
    const sum = cfg.pz[1][0] + cfg.pz[2][0] + cfg.pz[3][0];
    cfg.n = Math.max(cfg.n, sum);
    $app.innerHTML = `
      <div class="row"><h1 class="grow">새 보물찾기</h1><a class="btn ghost small" href="#/">처음으로</a></div>
      <div class="card"><h2>어디까지 숨길까요?</h2>
        <div class="seg">${[[20, '좁게 20m'], [40, '보통 40m'], [70, '넓게 70m']].map(([v, l]) => `<button data-r="${v}" class="${cfg.r === v ? '' : 'ghost'}">${l}</button>`).join('')}</div>
        <p class="muted">지금 서 있는 곳에서 이 거리 안에 숨어요. 길·물가가 없는 넓은 곳에서 해 주세요.</p></div>
      <div class="card"><h2>보물상자 몇 개?</h2>
        <div class="seg">${[8, 12, 20, 30].map((v) => `<button data-c="${v}" class="${cfg.n === v ? '' : 'ghost'}" ${v < sum ? 'disabled' : ''}>${v}개</button>`).join('')}</div>
        <p class="muted">상품 ${sum}개 + 꽝 ${cfg.n - sum}개</p></div>
      <div class="card"><h2>상품</h2>
        ${[1, 2, 3].map((k) => `<div class="prizerow"><b>${MEDAL[k]} ${RANK[k]}</b>
          <input data-pn="${k}" maxlength="20" placeholder="상품 이름" value="${esc(cfg.pz[k][1])}">
          <div class="stepper"><button class="small ghost" data-m="${k}">−</button><b>${cfg.pz[k][0]}</b><button class="small ghost" data-p="${k}">+</button></div></div>`).join('')}
      </div>
      <button id="go" class="sun big">📍 여기를 중심으로 보물 숨기기</button>
      <p id="note" class="muted" style="text-align:center"></p>`;
    for (const b of $app.querySelectorAll('[data-r]')) b.onclick = () => { cfg.r = +b.dataset.r; draw(); };
    for (const b of $app.querySelectorAll('[data-c]')) b.onclick = () => { cfg.n = +b.dataset.c; draw(); };
    for (const b of $app.querySelectorAll('[data-m]')) b.onclick = () => { const p = cfg.pz[b.dataset.m]; p[0] = Math.max(0, p[0] - 1); draw(); };
    for (const b of $app.querySelectorAll('[data-p]')) b.onclick = () => { const p = cfg.pz[b.dataset.p]; if (sum < 30) p[0]++; draw(); };
    for (const i of $app.querySelectorAll('[data-pn]')) i.oninput = () => { cfg.pz[i.dataset.pn][1] = i.value.slice(0, 20); };
    document.getElementById('go').onclick = async (ev) => {
      const btn = ev.currentTarget, note = document.getElementById('note');
      btn.disabled = true; Sound.unlock();
      try {
        const pos = await sampleGps(4000, (c) => { note.textContent = `위치 찾는 중… 오차 약 ${Math.round(c.accuracy)}m`; });
        const game = { v: 1, tp: 'metcha-' + rid(20), lat: +pos.lat.toFixed(6), lng: +pos.lng.toFixed(6), r: cfg.r, n: cfg.n, pz: cfg.pz, s: (Math.random() * 2 ** 31) | 0 };
        store.set('host:' + game.tp, '1');
        go('#/h/' + b64e(game));
      } catch (e) { note.textContent = ''; toast(e.message); btn.disabled = false; }
    };
  };
  draw();
}

// ---------- host dashboard
function hostScreen(cfg) {
  const g = new Game(cfg);
  g.connect();
  cleanup.push(() => g.close());
  const link = gameLink(cfg);
  $app.innerHTML = `
    <div class="row"><h1 class="grow">진행자</h1><a class="btn ghost small" href="#/">처음으로</a></div>
    <div class="card" style="text-align:center">
      <img id="joinqr" alt="참가 QR" style="width:230px;image-rendering:pixelated">
      <p class="muted">이 QR을 찍으면 바로 들어와요</p>
      <div class="row"><button id="copy" class="ghost grow">링크 복사</button><button id="share" class="ghost grow">공유하기</button></div>
      <div style="height:10px"></div>
      <button class="big" onclick="go('#/g/${b64e(cfg)}')">🎥 나도 찾으러 가기</button>
      <p class="muted">⚠️ 이 진행자 화면 주소는 다른 사람에게 보내지 마세요.</p>
    </div>
    <div class="card"><h2>남은 상품</h2><div class="row" id="chips"></div><p id="opened" class="muted"></p></div>
    <div class="card"><h2>당첨자</h2><div id="winners"></div></div>
    <div class="card feed" id="feed"></div>
    <div class="card"><h2>진행</h2><div class="row">
      <button id="again" class="ghost grow">같은 자리에서 다시 숨기기</button>
      <button id="end" class="danger grow">끝내기</button></div></div>`;
  document.getElementById('joinqr').src = qrImg(link);
  document.getElementById('copy').onclick = async () => { try { await navigator.clipboard.writeText(link); toast('링크를 복사했어요'); } catch { prompt('이 링크를 복사하세요', link); } };
  document.getElementById('share').onclick = () => navigator.share ? navigator.share({ title: '멧챠 보물찾기', url: link }).catch(() => {}) : document.getElementById('copy').click();
  document.getElementById('end').onclick = async () => { if (confirm('보물찾기를 끝낼까요?')) await g.send({ t: 'end' }).catch((e) => toast(e.message)); };
  document.getElementById('again').onclick = async () => {
    if (!confirm('보물을 새로 숨길까요? 당첨 기록이 지워져요.')) return;
    await g.send({ t: 'reseed', s: (Math.random() * 2 ** 31) | 0 }).then(() => toast('새로 숨겼어요!')).catch((e) => toast(e.message));
  };
  g.listeners.add(() => {
    if (!document.getElementById('chips')) return;
    document.getElementById('chips').innerHTML = prizeChips(g) || '<span class="muted">상품 없음</span>';
    document.getElementById('opened').textContent = `열린 상자 ${g.opened.size} / ${g.treasures.length} · 참가자 ${g.players.size}명${g.ended ? ' · 끝!' : ''}${g.online ? '' : ' · 연결 중…'}`;
    winners(g); feed(g);
  });
  g.emit();
}
function winners(g) {
  const el = document.getElementById('winners'); if (!el) return;
  const rows = [];
  for (const k of [1, 2, 3]) for (const t of g.treasures.filter((x) => x.prize === k && g.opened.has(x.id))) {
    const p = g.players.get(g.opened.get(t.id));
    rows.push(`<li><span style="font-size:24px">${MEDAL[k]}</span><span class="grow"><b>${esc(p?.name || '?')}</b> <span class="muted">${esc(teamOf(p?.team).name)}</span></span><span>${esc(g.cfg.pz[k][1] || RANK[k])}</span></li>`);
  }
  el.innerHTML = `<ul class="list">${rows.join('') || '<li class="muted">아직 없어요</li>'}</ul>`;
}
function feed(g) {
  const el = document.getElementById('feed'); if (!el) return;
  el.innerHTML = '<h2>소식</h2>' + (g.feed.slice(-25).reverse().map((f) => `<div>${f.kind === 'win' ? '🎉' : f.kind === 'miss' ? '😜' : f.kind === 'join' ? '👋' : '🚩'} ${esc(f.text)}</div>`).join('') || '<div class="muted">아직 조용해요</div>');
}

// ---------- join
function joinForm(g, done) {
  let team = null;
  $app.innerHTML = `
    <div class="hero"><img src="metcha.svg" alt=""><h1>보물찾기에 왔어요!</h1><p class="muted">이름(별명)을 정하고 팀을 골라요</p></div>
    <div class="card"><label for="nm">내 별명</label><input id="nm" maxlength="12" placeholder="예: 하준">
      <label>팀</label><div class="teams">${TEAMS.map((t) => `<div class="team" data-t="${t.id}" style="background:${t.color}">${esc(t.name)}</div>`).join('')}</div>
      <p class="muted">안 고르면 사람 적은 팀으로 들어가요</p>
      <button id="go" class="big">시작하기</button></div>`;
  for (const el of $app.querySelectorAll('[data-t]')) el.onclick = () => { team = el.dataset.t; for (const x of $app.querySelectorAll('[data-t]')) x.classList.toggle('on', x === el); };
  document.getElementById('go').onclick = async (ev) => {
    ev.currentTarget.disabled = true;
    const counts = Object.fromEntries(TEAMS.map((t) => [t.id, 0]));
    for (const p of g.players.values()) counts[p.team]++;
    const me = { p: store.get('me:' + g.cfg.tp) || rid(10), n: document.getElementById('nm').value.trim().slice(0, 12) || NAMES[Math.floor(Math.random() * NAMES.length)],
      tm: team || TEAMS.slice().sort((a, b) => counts[a.id] - counts[b.id])[0].id };
    try {
      await g.send({ t: 'join', ...me });
      store.set('me:' + g.cfg.tp, me.p);
      store.set('joined:' + g.cfg.tp, '1');
      done(me.p);
    } catch (e) { toast(e.message); ev.currentTarget.disabled = false; }
  };
}

// ---------- the camera hunt
const IMG = { closed: new Image(), open: new Image() };
IMG.closed.src = 'chest.svg'; IMG.open.src = 'chest-open.svg';

function playScreen(cfg) {
  const g = new Game(cfg);
  g.connect();
  cleanup.push(() => g.close());
  const pid = store.get('me:' + cfg.tp);
  if (!pid || !store.get('joined:' + cfg.tp)) return joinForm(g, () => startGate(g, store.get('me:' + cfg.tp)));
  startGate(g, pid);
}

async function startGate(g, pid) {
  $app.innerHTML = '';
  const gate = document.createElement('div');
  gate.className = 'start';
  gate.innerHTML = `<div><img src="metcha.svg" alt=""><h1 style="color:#fff">보물상자를 찾아라!</h1>
    <p>폰을 세워서 카메라로 주변을 둘러보세요.<br>상자가 보이면 가까이 가서 <b>톡!</b> 눌러요.</p>
    <button id="startbtn" class="sun big" style="margin-top:14px">🎥 카메라로 찾기 시작</button></div>`;
  document.body.append(gate);
  cleanup.push(() => gate.remove());
  await new Promise((resolve) => (gate.querySelector('#startbtn').onclick = resolve));
  Sound.unlock();
  try { if (typeof DeviceOrientationEvent?.requestPermission === 'function') await DeviceOrientationEvent.requestPermission(); } catch {}
  gate.remove();
  hunt(g, pid);
}

function hunt(g, pid) {
  const ar = document.createElement('div');
  ar.className = 'ar';
  ar.innerHTML = `<video playsinline muted autoplay></video><canvas></canvas>
    <div class="top"><span id="me"></span><span class="grow"></span><span id="chips" class="row" style="gap:4px"></span><button id="snd" class="iconbtn">🔊</button></div>
    <div class="bottom">
      <div class="signal"><div class="bars">${[1, 2, 3, 4, 5].map((i) => `<i style="height:${i * 20}%"></i>`).join('')}</div><small id="sigtxt">신호 없음</small></div>
      <div class="heat"><b id="word">위치 찾는 중</b><span id="sub">하늘이 보이는 곳에서 잠깐 기다려요</span></div>
      <button id="scan" class="scanbtn">🔍<br>찾기</button></div>`;
  document.body.append(ar);
  const video = ar.querySelector('video'), cv = ar.querySelector('canvas');
  const gx = cv.getContext('2d');
  let here = null, heading = null, pitch = 0, dragHeading = 0, soundOn = true, lastWhistle = 0, boxes = [], stream = null, busy = false;
  // chests stay invisible until you press 찾기 close enough; then they show for a while
  const revealed = new Map(); // treasure id -> until (ms)
  const REVEAL_M = 15, REVEAL_FOR = 45000;
  let scanUntil = 0, scanCool = 0, signal = 0;
  let fedTo = g.feed.length, endShown = false;

  navigator.mediaDevices?.getUserMedia({ video: { facingMode: 'environment' }, audio: false })
    .then((st) => { stream = st; video.srcObject = st; video.play().catch(() => {}); })
    .catch(() => toast('카메라를 못 켰어요. 그래도 레이더로 찾을 수 있어요', 3500));

  const onOri = (e) => {
    let h = null;
    if (typeof e.webkitCompassHeading === 'number') h = e.webkitCompassHeading;
    else if (e.absolute && typeof e.alpha === 'number') h = (360 - e.alpha) % 360;
    if (h == null) return;
    h = (h + (screen.orientation?.angle || 0)) % 360;
    heading = heading == null ? h : (heading + wrap180(h - heading) * 0.2 + 360) % 360;
    if (typeof e.beta === 'number') pitch += ((e.beta - 90) - pitch) * 0.2;
  };
  window.addEventListener('deviceorientationabsolute', onOri);
  window.addEventListener('deviceorientation', onOri);

  let gpsW = null;
  if (navigator.geolocation) {
    gpsW = navigator.geolocation.watchPosition((p) => {
      const c = { lat: p.coords.latitude, lng: p.coords.longitude, acc: p.coords.accuracy };
      if (!here || distM(here, c) > 25) here = c;
      else { const k = Math.min(0.6, 8 / Math.max(8, c.acc)); here = { lat: here.lat + (c.lat - here.lat) * k, lng: here.lng + (c.lng - here.lng) * k, acc: c.acc }; }
    }, (e) => { if (e.code === 1) { document.getElementById('word').textContent = '위치 권한이 필요해요'; document.getElementById('sub').textContent = '설정에서 위치를 허용해 주세요'; } },
    { enableHighAccuracy: true, maximumAge: 1000, timeout: 30000 });
  }

  let dragX = null, moved = false;
  cv.addEventListener('pointerdown', (e) => { dragX = e.clientX; moved = false; });
  cv.addEventListener('pointermove', (e) => { if (dragX != null && heading == null) { const dx = e.clientX - dragX; if (Math.abs(dx) > 4) moved = true; dragHeading = (dragHeading - dx * 0.25 + 360) % 360; dragX = e.clientX; } });
  cv.addEventListener('pointerup', (e) => { dragX = null; if (!moved) tap(e.clientX, e.clientY); });

  ar.querySelector('#scan').onclick = () => {
    const now = performance.now();
    if (now < scanCool || g.ended) return;
    scanCool = now + 2500; scanUntil = now + 1200;
    Sound.tone(900, 0, 0.12, 0.25); Sound.tone(1200, 0.15, 0.12, 0.25); Sound.tone(1600, 0.3, 0.2, 0.25);
    if (!here) { toast('아직 내 위치를 몰라요'); return; }
    const reach = REVEAL_M + Math.min(10, here.acc || 0);
    const found = g.treasures.filter((t) => !g.opened.has(t.id) && distM(here, t) <= reach);
    setTimeout(() => {
      if (found.length) {
        for (const t of found) revealed.set(t.id, Date.now() + REVEAL_FOR);
        toast(found.length > 1 ? `✨ 상자 ${found.length}개가 나타났어요! 둘러봐요` : '✨ 상자가 나타났어요! 카메라로 둘러봐요', 3000);
        Sound.tone(1320, 0, 0.25, 0.3, 'triangle'); Sound.tone(1760, 0.12, 0.35, 0.3, 'triangle');
        navigator.vibrate?.([40, 40, 80]);
      } else {
        toast(signal >= 3 ? '거의 다 왔어! 조금 더 움직여서 다시 찾아봐' : '여긴 없어요… 신호가 강한 쪽으로 가 봐요', 2600);
        Sound.boop(330);
      }
    }, 1200);
  };

  const sndBtn = ar.querySelector('#snd');
  sndBtn.onclick = () => { soundOn = !soundOn; sndBtn.textContent = soundOn ? '🔊' : '🔇'; };

  async function tap(x, y) {
    const hit = boxes.filter((b) => x >= b.x - 14 && x <= b.x + b.w + 14 && y >= b.y - 14 && y <= b.y + b.h + 14).sort((a, b) => a.d - b.d)[0];
    if (!hit || busy || g.ended) return;
    if (g.opened.has(hit.id)) return;
    const allow = OPEN_M + Math.min(15, here?.acc || 0);
    if (hit.d > allow) { toast(`조금 더 가까이! (약 ${Math.round(hit.d)}m)`); Sound.boop(440); return; }
    busy = true;
    try {
      const r = await g.open(hit.id, pid);
      if (r.ok) showResult(r.prize, r.name);
      else if (r.already) toast(`${r.by} 친구가 먼저 열었어요!`);
      else toast(r.error);
    } catch (e) { toast(e.message); }
    busy = false;
  }

  function showResult(prize, name) {
    const el = document.createElement('div');
    if (prize) {
      el.className = 'result win';
      el.innerHTML = `<div><div class="medal">${MEDAL[prize]}</div><h1>${RANK[prize]} 당첨!</h1>${name ? `<p><b>${esc(name)}</b></p>` : ''}<p>진행자에게 화면을 보여주세요</p>
        <button class="big" style="margin-top:16px">계속 찾기</button></div>`;
      Sound.fanfare(); navigator.vibrate?.([80, 60, 200]);
      const colors = ['#ff6b6b', '#4dabf7', '#51cf66', '#fcc419', '#cc5de8'];
      for (let i = 0; i < 70; i++) {
        const c = document.createElement('i'); c.className = 'confetti';
        c.style.cssText = `left:${Math.random() * 100}vw;background:${colors[i % 5]};animation-duration:${1.6 + Math.random() * 1.6}s;animation-delay:${Math.random() * 0.6}s`;
        el.append(c);
      }
    } else {
      el.className = 'result miss';
      el.innerHTML = `<div><img class="tongue" src="metcha.svg" alt=""><h1>꽝!</h1><p>멧챠가 메롱~ 😜<br>다른 상자를 찾아봐요!</p>
        <button class="big" style="margin-top:16px">다시 찾기</button></div>`;
      Sound.boing(); navigator.vibrate?.(60);
    }
    el.querySelector('button').onclick = () => el.remove();
    document.body.append(el);
  }

  const onState = () => {
    const me = g.players.get(pid);
    const mine = g.treasures.filter((t) => g.opened.get(t.id) === pid && t.prize).map((t) => MEDAL[t.prize]).join('');
    document.getElementById('me').textContent = me ? `${me.name}${mine}` : '';
    document.getElementById('chips').innerHTML = prizeChips(g);
    if (g.feed.length < fedTo) fedTo = 0; // reseed
    for (const f of g.feed.slice(fedTo)) {
      if (!f.live || f.by === pid) continue;
      if (f.kind === 'win') { toast('🎉 ' + f.text, 3500); if (soundOn) Sound.boop(990); }
      else if (f.kind === 'start') toast(f.text, 3500);
    }
    fedTo = g.feed.length;
    if (g.ended && !endShown) { endShown = true; setTimeout(endOverlay, 1200); }
    if (!g.ended) endShown = false;
  };
  g.listeners.add(onState);
  onState();

  function endOverlay() {
    const el = document.createElement('div');
    el.className = 'result win end';
    const rows = [];
    for (const k of [1, 2, 3]) for (const t of g.treasures.filter((x) => x.prize === k && g.opened.has(x.id))) rows.push(`<div style="font-size:20px">${MEDAL[k]} ${esc(g.players.get(g.opened.get(t.id))?.name || '?')}</div>`);
    el.innerHTML = `<div><img src="metcha.svg" alt="" style="width:110px"><h1>보물찾기 끝!</h1>${rows.join('') || '<p>당첨자가 없어요</p>'}<button class="big" style="margin-top:16px">닫기</button></div>`;
    el.querySelector('button').onclick = () => el.remove();
    document.body.append(el);
  }

  let raf = 0;
  const HFOV = 52;
  function frame() {
    raf = requestAnimationFrame(frame);
    const W = cv.clientWidth, H = cv.clientHeight, dpr = Math.min(2, devicePixelRatio || 1);
    if (cv.width !== Math.round(W * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
    gx.setTransform(dpr, 0, 0, dpr, 0, 0);
    gx.clearRect(0, 0, W, H);
    boxes = [];
    const head = heading ?? dragHeading, ppd = W / HFOV;
    const word = document.getElementById('word'), sub = document.getElementById('sub');
    // scan ripple
    const sNow = performance.now();
    if (sNow < scanUntil) {
      const k = 1 - (scanUntil - sNow) / 1200;
      for (const off of [0, 0.33, 0.66]) {
        const kk = (k + off) % 1;
        gx.strokeStyle = `rgba(255,224,102,${0.8 * (1 - kk)})`; gx.lineWidth = 4;
        gx.beginPath(); gx.arc(W / 2, H * 0.55, kk * Math.max(W, H) * 0.6, 0, Math.PI * 2); gx.stroke();
      }
    }
    if (!here) { drawSignal(0); return; }
    const now = Date.now();
    const list = g.treasures.map((t) => ({ t, opened: g.opened.has(t.id), d: distM(here, t), b: bearing(here, t) }));
    const open = list.filter((o) => !o.opened).sort((a, b) => a.d - b.d);
    // only chests found with 찾기 (or already-opened ones right next to you) are drawn
    const visible = list.filter((o) => (o.opened ? o.d < 15 : (revealed.get(o.t.id) || 0) > now && o.d < 40));
    for (const o of visible.sort((a, b) => b.d - a.d)) {
      const rel = wrap180(o.b - head);
      if (Math.abs(rel) > HFOV / 2 + 15) continue;
      const elev = -Math.atan2(1.3, Math.max(1.5, o.d)) / toR;
      const x = W / 2 + rel * ppd, y = H / 2 - (elev - pitch) * ppd;
      const size = Math.max(42, Math.min(W * 0.7, (Math.atan2(1.1, Math.max(1, o.d)) / toR) * ppd));
      const img = o.opened ? IMG.open : IMG.closed, h = size * 0.85;
      const bobY = o.opened ? 0 : Math.sin(performance.now() / 300 + o.t.id * 1.7) * size * 0.04;
      gx.globalAlpha = o.opened ? 0.55 : Math.max(0.55, 1 - o.d / 80);
      if (!o.opened && o.d < OPEN_M + (here.acc || 0)) {
        gx.save(); gx.shadowColor = '#ffe066'; gx.shadowBlur = 30 + Math.sin(performance.now() / 150) * 12; gx.drawImage(img, x - size / 2, y - h + bobY, size, h); gx.restore();
      } else gx.drawImage(img, x - size / 2, y - h + bobY, size, h);
      gx.globalAlpha = 1;
      gx.font = `800 ${Math.max(13, Math.min(22, size * 0.16))}px system-ui`; gx.textAlign = 'center';
      const label = o.opened ? (o.t.prize ? `${MEDAL[o.t.prize]} ${RANK[o.t.prize]}` : '꽝') : `${Math.round(o.d)}m`;
      gx.lineWidth = 4; gx.strokeStyle = 'rgba(0,0,0,.55)'; gx.strokeText(label, x, y + 20); gx.fillStyle = '#fff'; gx.fillText(label, x, y + 20);
      if (!o.opened) boxes.push({ id: o.t.id, x: x - size / 2, y: y - h + bobY, w: size, h, d: o.d });
    }
    // a revealed chest you've turned away from: small arrow back to it (only for ones you already found with 찾기)
    const shown = visible.filter((o) => !o.opened).sort((a, b) => a.d - b.d)[0];
    if (shown && Math.abs(wrap180(shown.b - head)) > HFOV / 2) {
      const left = wrap180(shown.b - head) < 0, ax = left ? 30 : W - 30, ay = H * 0.45;
      gx.fillStyle = 'rgba(255,209,77,.95)'; gx.beginPath();
      if (left) { gx.moveTo(ax - 16, ay); gx.lineTo(ax + 10, ay - 20); gx.lineTo(ax + 10, ay + 20); } else { gx.moveTo(ax + 16, ay); gx.lineTo(ax - 10, ay - 20); gx.lineTo(ax - 10, ay + 20); }
      gx.fill();
    }
    const near = open[0];
    if (near && !g.ended) {
      const d = near.d;
      // signal strength 0..5: nothing far away, stronger as you close in (no direction given)
      signal = d < 10 ? 5 : d < 16 ? 4 : d < 25 ? 3 : d < 38 ? 2 : d < 55 ? 1 : 0;
      const L = [['신호 없음', '여기저기 걸어 다녀 봐요'], ['약한 신호…', '뭔가 있는 것 같아'], ['신호가 잡혀요', '이쪽 근처인가?'],
        ['신호가 강해요!', '🔍 찾기를 눌러 봐요'], ['신호가 아주 강해요!', '🔍 찾기를 눌러요!'], ['삐삐삐! 바로 근처!', '🔍 찾기를 눌러요!']][signal];
      word.textContent = L[0];
      sub.textContent = !g.online ? '📶 연결 중…' : here.acc > 25 ? `📡 위치가 흐려요 (오차 ${Math.round(here.acc)}m)` : L[1];
      if (shown) { word.textContent = '상자가 나타났어요!'; sub.textContent = shown.d <= OPEN_M + Math.min(15, here.acc || 0) ? '상자를 톡! 눌러 열어요' : `가까이 가서 눌러요 · ${Math.round(shown.d)}m`; }
      if (signal > 0 && soundOn) {
        const every = [0, 6500, 4500, 3000, 2000, 1300][signal];
        if (performance.now() - lastWhistle > every) {
          lastWhistle = performance.now();
          Sound.whistle([0, 0.12, 0.25, 0.45, 0.7, 1][signal], Math.sin(wrap180(near.b - head) * toR) * 0.6);
        }
      }
    } else { signal = 0; word.textContent = g.ended ? '끝!' : '다 열었어요!'; sub.textContent = '당첨자를 확인해요'; }
    drawSignal(signal);
  }
  let lastSig = -1;
  function drawSignal(n) {
    if (n === lastSig) return;
    lastSig = n;
    ar.querySelectorAll('.bars i').forEach((b, i) => b.classList.toggle('on', i < n));
    ar.querySelector('.signal').dataset.level = n;
    document.getElementById('sigtxt').textContent = n ? `신호 ${n}` : '신호 없음';
    ar.querySelector('#scan').classList.toggle('ready', n >= 3);
  }
  raf = requestAnimationFrame(frame);

  cleanup.push(() => {
    cancelAnimationFrame(raf);
    g.listeners.delete(onState);
    window.removeEventListener('deviceorientationabsolute', onOri);
    window.removeEventListener('deviceorientation', onOri);
    if (gpsW != null) navigator.geolocation.clearWatch(gpsW);
    stream?.getTracks().forEach((t) => t.stop());
    ar.remove();
  });
}

route();
