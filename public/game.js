'use strict';
/* ====== 게임 화면 (캔버스) — 좌표는 1000x600 가상 공간 ====== */
const WW = 1000, WH = 600, BAND = 130, R = 16, SPEED = 300;
const OXC = ['#3b82f6', '#ef4444'], MCC = ['#ff5d73', '#3d8bff', '#ffc53d', '#2dd4a3'];
const EMO = '"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif';
const CONF = ['#ffd43b', '#ff4f8b', '#38e1ff', '#b8ff4a', '#b388ff', '#ff8a3d'];
const cv = $('#cv'), ctx = cv.getContext('2d');
const G = { running: false, ents: new Map(), me: null, keys: {}, phase: '', q: null, zs: [], counts: [], P: [], F: [], target: null, t: 0, qi: 0, total: 0, mode: 'survival', endAt: 0, top: [], answer: -1, myScore: 0, sc: 1, ox: 0, oy: 0, dpr: 1, lastSend: 0, lastX: -1, lastY: -1, lastTick: 99, sideT: 0, raf: 0, last: 0 };
const rnd = (a, b) => a + Math.random() * (b - a);
const pick = a => a[Math.floor(Math.random() * a.length)];
const hexA = (h, a) => { const n = parseInt(h.slice(1), 16); return `rgba(${n >> 16 & 255},${n >> 8 & 255},${n & 255},${a})`; };

/* ---------- 효과음 ---------- */
const Snd = {
  ctx: null, on: true,
  init() { if (!this.ctx) { try { this.ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) {} } if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume(); },
  tone(f, d = .12, type = 'sine', vol = .07, when = 0, slide = 0) {
    if (!this.on || !this.ctx) return; const t = this.ctx.currentTime + when, o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(f, t); if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, f + slide), t + d);
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(.0001, t + d); o.connect(g); g.connect(this.ctx.destination); o.start(t); o.stop(t + d + .03);
  },
  tick() { this.tone(880, .05, 'square', .035); }, urgent() { this.tone(1320, .09, 'square', .055); },
  start() { [523, 659, 784].forEach((f, i) => this.tone(f, .14, 'triangle', .08, i * .09)); },
  right() { [659, 880, 1175].forEach((f, i) => this.tone(f, .16, 'triangle', .09, i * .08)); },
  wrong() { this.tone(240, .4, 'sawtooth', .06, 0, -130); }, lock() { this.tone(160, .2, 'square', .06); },
  win() { [523, 659, 784, 1047, 784, 1047, 1319].forEach((f, i) => this.tone(f, .18, 'triangle', .09, i * .1)); },
  pop() { this.tone(600, .07, 'sine', .05, 0, 300); }, go() { this.tone(1046, .25, 'triangle', .09); }
};

/* ---------- 구역 ---------- */
function zonesFor(q) {
  const n = q.choices.length, pad = 10, gap = 10, top = BAND + pad, cw = (WW - pad * 2 - gap * (n - 1)) / n;
  return Array.from({ length: n }, (_, i) => ({ i, x: pad + i * (cw + gap), y: top, w: cw, h: WH - pad - top, c: q.type === 'ox' ? OXC[i] : MCC[i], label: q.type === 'ox' ? (i ? 'X' : 'O') : 'ABCD'[i], text: q.type === 'ox' ? '' : q.choices[i] }));
}
const zoneAt = (x, y) => G.zs.findIndex(z => x >= z.x && x <= z.x + z.w && y >= z.y && y <= z.y + z.h);

/* ---------- 배너 ---------- */
let bannerTO = 0;
function banner(main, sub = '', dur = 1.4, cls = '') {
  const b = $('#banner'); b.className = 'banner show ' + cls; b.innerHTML = `<div class="bm">${main}</div>${sub ? `<div class="bs">${sub}</div>` : ''}`;
  b.style.animation = 'none'; void b.offsetWidth; b.style.animation = '';
  clearTimeout(bannerTO); if (dur > 0) bannerTO = setTimeout(() => b.classList.remove('show'), dur * 1000);
}
const hideBanner = () => { clearTimeout(bannerTO); $('#banner').classList.remove('show'); };

/* ---------- 엔티티 ---------- */
function getEnt(id) {
  let e = G.ents.get(id); if (e) return e;
  const p = room && room.players.find(x => x.id === id); if (!p) return null;
  e = { id, name: p.name, emoji: p.emoji, color: p.color, x: WW / 2, y: 60, tx: WW / 2, ty: 60, alive: true, bubble: '', bubT: 0, isMe: id === myId };
  G.ents.set(id, e); return e;
}
function gameStart(m) {
  G.ents.clear(); G.P = []; G.F = []; G.top = []; G.myScore = 0; G.q = null; G.zs = []; G.counts = []; G.phase = ''; G.mode = m.mode; G.total = m.total; G.qi = 0; G.target = null;
  room.players.forEach(p => { if (!p.spec) { const e = getEnt(p.id); e.x = e.tx = rnd(60, WW - 60); e.y = e.ty = rnd(40, BAND - 30); } });
  G.me = G.ents.get(myId) || null;
  $('#modeChip').textContent = m.mode === 'survival' ? '💀 서바이벌' : '⭐ 포인트전';
  $('#qno').textContent = 'Q-'; $('#qtext').textContent = m.title; $('#expl').textContent = G.me ? '정답 구역으로 달려가세요! 시간이 끝났을 때 구역 안에 있어야 해요.' : '👀 관전 중이에요. 다음 판부터 참여할 수 있어요.';
  $('#sndBtn').textContent = Snd.on ? '🔊' : '🔇';
  showScreen('game'); layout(); G.running = true; G.last = performance.now(); cancelAnimationFrame(G.raf); G.raf = requestAnimationFrame(loop);
}
function onSnap(m) {
  m.p.forEach(([id, x, y]) => {
    const e = getEnt(id); if (!e) return;
    if (m.reset) { e.x = e.tx = x; e.y = e.ty = y; if (e.isMe) { G.target = null; G.lastX = x; G.lastY = y; } }
    else if (!e.isMe) { e.tx = x; e.ty = y; }
  });
}
function say(e, t) { e.bubble = t; e.bubT = 2; }
function onReact(m) { const e = getEnt(m.id); if (e) say(e, m.e); }
function onLeft(m) { G.ents.delete(m.id); }

/* ---------- 단계 처리 ---------- */
function onPhase(m) {
  G.phase = m.phase; G.endAt = Date.now() + (m.endAt - m.now); G.lastTick = 99; G.qi = m.qi;
  if (m.q) { G.q = m.q; G.zs = zonesFor(m.q); }
  if (m.phase === 'start') banner('곧 시작해요!', '준비하세요 🏃', 0);
  else if (m.phase === 'intro') {
    G.counts = []; G.answer = -1; $('#qno').textContent = `Q${m.qi + 1}/${m.total}`; $('#qtext').textContent = m.q.q;
    $('#expl').textContent = m.q.type === 'ox' ? 'O 또는 X 구역으로 이동하세요!' : '정답이라고 생각하는 구역으로 이동하세요!';
    banner(`문제 ${m.qi + 1}`, m.q.type === 'ox' ? 'O / X 퀴즈' : `${m.q.choices.length}지선다`, 1.8); Snd.go();
  } else if (m.phase === 'think') { hideBanner(); Snd.start(); }
  else if (m.phase === 'lock') { G.counts = m.counts; banner('⏰ 시간 종료!', '', 1.2, 'bad'); Snd.lock(); }
  else if (m.phase === 'reveal') onReveal(m);
}
function onReveal(m) {
  G.answer = m.answer; G.counts = m.counts; G.top = m.top;
  let mine = null;
  m.results.forEach(([id, ok, gain, alive]) => {
    const e = G.ents.get(id); if (!e) return; e.alive = !!alive; e.ok = !!ok;
    if (ok) burst(e.x, e.y, e.isMe ? 16 : 3); else if (!alive) poof(e.x, e.y, e.color);
    if (e.isMe) { mine = { ok, gain, alive }; G.myScore += gain; if (ok) G.F.push({ x: e.x, y: e.y - 36, text: '+' + gain, age: 0, life: 1.6 }); }
  });
  const q = G.q, lbl = q.type === 'ox' ? q.choices[m.answer] : `${'ABCD'[m.answer]}. ${q.choices[m.answer]}`;
  $('#expl').innerHTML = `<b>정답 ${esc(lbl)}</b>${esc(m.exp)}`;
  const ans = `정답은 ${q.type === 'ox' ? q.choices[m.answer] : 'ABCD'[m.answer]}`;
  if (m.voided) banner('🤯 전원 오답!', '이번 문제는 무효 처리 — 모두 생존!', 3);
  else if (mine) {
    if (mine.ok) { banner(`🎉 정답! +${mine.gain}`, ans, 3, 'good'); Snd.right(); }
    else if (G.mode === 'survival') { banner('💥 탈락!', ans + ' · 관전 모드로 전환', 3.4, 'bad'); Snd.wrong(); }
    else { banner('😢 아쉬워요', ans, 3, 'bad'); Snd.wrong(); }
  } else banner(ans, '', 3);
}
function burst(x, y, n) { for (let i = 0; i < n; i++) G.P.push({ t: 'c', x, y, vx: rnd(-170, 170), vy: rnd(-340, -90), life: rnd(1, 1.8), age: 0, s: rnd(5, 9), col: pick(CONF), rot: rnd(0, 6), vr: rnd(-8, 8) }); }
function poof(x, y, col) { for (let i = 0; i < 14; i++) { const a = rnd(0, 6.28), s = rnd(80, 240); G.P.push({ t: 'p', x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: rnd(.4, .8), age: 0, s: rnd(3, 7), col: i % 3 ? col : '#fff' }); } }

/* ---------- 갱신 ---------- */
function update(dt) {
  G.t += dt; const now = Date.now(), me = G.me, ph = G.phase;
  if (me && me.alive && (ph === 'start' || ph === 'intro' || ph === 'think')) {
    const k = G.keys; let vx = 0, vy = 0;
    if (k.ArrowLeft || k.KeyA) vx--; if (k.ArrowRight || k.KeyD) vx++; if (k.ArrowUp || k.KeyW) vy--; if (k.ArrowDown || k.KeyS) vy++;
    if (vx || vy) { G.target = null; const l = Math.hypot(vx, vy); me.x += vx / l * SPEED * dt; me.y += vy / l * SPEED * dt; }
    else if (G.target) { const dx = G.target.x - me.x, dy = G.target.y - me.y, d = Math.hypot(dx, dy); if (d < 3) G.target = null; else { const s = Math.min(d, SPEED * dt); me.x += dx / d * s; me.y += dy / d * s; } }
    me.x = clamp(me.x, R, WW - R); me.y = clamp(me.y, R, WH - R);
    if (now - G.lastSend > 100 && (me.x !== G.lastX || me.y !== G.lastY)) { send({ t: 'pos', x: Math.round(me.x), y: Math.round(me.y) }); G.lastSend = now; G.lastX = me.x; G.lastY = me.y; }
  }
  G.ents.forEach(e => { if (e.isMe && e.alive) return; if (e.alive) { const k = Math.min(1, dt * 9); e.x += (e.tx - e.x) * k; e.y += (e.ty - e.y) * k; } if (e.bubT > 0) e.bubT -= dt; });
  if (me && me.bubT > 0) me.bubT -= dt;
  const rem = Math.max(0, (G.endAt - now) / 1000);
  if (ph === 'start') { const c = Math.ceil(rem - .3); if (c !== G.lastTick && c >= 1 && c <= 3) { G.lastTick = c; banner(String(c), '', 1); Snd.tick(); } }
  if (ph === 'think') {
    const c = Math.ceil(rem); if (c !== G.lastTick && c <= 5 && c >= 1) { G.lastTick = c; c <= 3 ? Snd.urgent() : Snd.tick(); }
    G.counts = G.zs.map(() => 0); G.ents.forEach(e => { if (e.alive) { const z = zoneAt(e.x, e.y); if (z >= 0) G.counts[z]++; } });
  }
  for (let i = G.P.length - 1; i >= 0; i--) { const p = G.P[i]; p.age += dt; if (p.age >= p.life) { G.P.splice(i, 1); continue; } if (p.t === 'c') { p.vy += 520 * dt; p.rot += p.vr * dt; } else { p.vx *= 1 - 3 * dt; p.vy *= 1 - 3 * dt; } p.x += p.vx * dt; p.y += p.vy * dt; }
  for (let i = G.F.length - 1; i >= 0; i--) { const f = G.F[i]; f.age += dt; f.y -= 36 * dt; if (f.age >= f.life) G.F.splice(i, 1); }
  updateHUD(rem); G.sideT -= dt; if (G.sideT <= 0) { G.sideT = .4; renderSide(); }
}
function updateHUD(rem) {
  const q = G.q, ph = G.phase, tot = q ? q.time : 1, r = ph === 'think' ? rem : ph === 'intro' ? tot : 0;
  const ring = $('#ring'); ring.style.setProperty('--p', q ? (r / tot * 100).toFixed(1) : 100);
  $('#timer').textContent = !q ? '-' : (ph === 'lock' || ph === 'reveal') ? '✓' : Math.ceil(r);
  const hot = ph === 'think' && rem <= 5; ring.classList.toggle('hot', hot);
  const bar = $('#tbar'); bar.classList.toggle('hot', hot); bar.firstElementChild.style.transform = `scaleX(${q ? (r / tot).toFixed(4) : 1})`;
  let a = 0; G.ents.forEach(e => { if (e.alive) a++; });
  $('#alive').textContent = G.mode === 'survival' ? `👥 ${a}/${G.ents.size}` : `⭐ ${G.myScore}`;
}
function renderSide() {
  if (getComputedStyle($('#side')).display === 'none') return;
  const row = (e, i) => `<div class="rk ${e.id === myId ? 'me' : ''} ${G.mode === 'survival' && !e.alive ? 'dead' : ''}"><i>${i + 1}</i><span>${e.emoji} ${esc(e.name)}</span><b>${e.score}</b></div>`;
  let h = '<h4>🏆 순위 (문제 후 갱신)</h4>';
  h += G.top.length ? G.top.slice(0, 9).map(row).join('') : `<div class="hint">참가자 ${G.ents.size}명</div>`;
  $('#rankBox').innerHTML = h;
  if (G.q && G.counts.length) { const tot = Math.max(1, G.counts.reduce((a, b) => a + b, 0)); $('#distBox').innerHTML = '<h4>📊 선택 현황</h4>' + G.zs.map((z, i) => `<div class="dist"><em style="color:${z.c}">${z.label}</em><div><i style="width:${(G.counts[i] / tot * 100).toFixed(0)}%;background:${z.c}"></i></div><b>${G.counts[i] || 0}</b></div>`).join(''); }
}

/* ---------- 그리기 ---------- */
function layout() {
  const st = $('#stage'), w = st.clientWidth, h = st.clientHeight; if (!w || !h) return;
  G.dpr = Math.min(window.devicePixelRatio || 1, 2); cv.width = Math.round(w * G.dpr); cv.height = Math.round(h * G.dpr);
  G.sc = Math.min(w / WW, h / WH); G.ox = (w - WW * G.sc) / 2; G.oy = (h - WH * G.sc) / 2; G.cw = w; G.ch = h;
}
function rr(x, y, w, h, r) { r = Math.min(r, w / 2, h / 2); ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }
function wrapText(text, maxW) { const out = []; let cur = ''; for (const ch of text) { if (ctx.measureText(cur + ch).width > maxW && cur) { out.push(cur.trim()); cur = ch.trim() ? ch : ''; } else cur += ch; } if (cur.trim()) out.push(cur.trim()); return out; }
function draw() {
  ctx.setTransform(G.dpr, 0, 0, G.dpr, 0, 0); ctx.fillStyle = '#0a0f2b'; ctx.fillRect(0, 0, G.cw, G.ch);
  ctx.save(); ctx.translate(G.ox, G.oy); ctx.scale(G.sc, G.sc); ctx.beginPath(); ctx.rect(0, 0, WW, WH); ctx.clip();
  const g = ctx.createLinearGradient(0, 0, 0, WH); g.addColorStop(0, '#141a45'); g.addColorStop(1, '#0a0f2b'); ctx.fillStyle = g; ctx.fillRect(0, 0, WW, WH);
  ctx.strokeStyle = 'rgba(120,140,255,.08)'; ctx.lineWidth = 1; ctx.beginPath(); for (let x = 0; x < WW; x += 40) { ctx.moveTo(x, 0); ctx.lineTo(x, WH); } for (let y = 0; y < WH; y += 40) { ctx.moveTo(0, y); ctx.lineTo(WW, y); } ctx.stroke();
  ctx.fillStyle = 'rgba(255,255,255,.04)'; ctx.fillRect(0, 0, WW, BAND);
  ctx.save(); ctx.setLineDash([14, 10]); ctx.strokeStyle = 'rgba(255,212,59,.55)'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(0, BAND + 1); ctx.lineTo(WW, BAND + 1); ctx.stroke(); ctx.restore();
  ctx.fillStyle = 'rgba(255,255,255,.28)'; ctx.font = '700 12px "Noto Sans KR",sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic'; ctx.fillText('대기구역 — 정답 구역으로 이동!', 12, BAND - 8);
  drawZones();
  if (G.target && G.me && G.me.alive && G.phase !== 'lock' && G.phase !== 'reveal') { const k = (G.t * 2) % 1; ctx.strokeStyle = `rgba(255,212,59,${1 - k})`; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(G.target.x, G.target.y, 8 + k * 14, 0, 6.283); ctx.stroke(); }
  [...G.ents.values()].sort((a, b) => (a.alive - b.alive) || (a.y - b.y)).forEach(drawEnt);
  G.P.forEach(p => { ctx.globalAlpha = Math.max(0, 1 - p.age / p.life); ctx.fillStyle = p.col; if (p.t === 'c') { ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot); ctx.fillRect(-p.s / 2, -p.s / 3, p.s, p.s * .66); ctx.restore(); } else { ctx.beginPath(); ctx.arc(p.x, p.y, p.s * (1 - p.age / p.life) + 1, 0, 6.283); ctx.fill(); } }); ctx.globalAlpha = 1;
  G.F.forEach(f => { ctx.globalAlpha = Math.max(0, 1 - f.age / f.life); ctx.font = '900 24px Jua,"Noto Sans KR",sans-serif'; ctx.textAlign = 'center'; ctx.lineWidth = 5; ctx.strokeStyle = 'rgba(0,0,0,.6)'; ctx.strokeText(f.text, f.x, f.y); ctx.fillStyle = '#b8ff4a'; ctx.fillText(f.text, f.x, f.y); }); ctx.globalAlpha = 1;
  if (G.phase === 'think') { const rem = (G.endAt - Date.now()) / 1000; if (rem <= 5 && rem > 0) { const c = Math.ceil(rem); ctx.save(); ctx.globalAlpha = .28 + .3 * (rem % 1); ctx.translate(WW / 2, BAND * .52); ctx.scale(1 + (rem % 1) * .25, 1 + (rem % 1) * .25); ctx.font = '900 110px Jua,sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = c <= 3 ? '#ff4f6d' : '#ffd43b'; ctx.fillText(c, 0, 0); ctx.restore(); } }
  ctx.restore();
}
function drawZones() {
  const q = G.q, ph = G.phase;
  if (!q || ph === 'start' || ph === 'intro') {
    ctx.save(); ctx.setLineDash([12, 10]); ctx.strokeStyle = 'rgba(255,255,255,.2)'; ctx.lineWidth = 3; rr(10, BAND + 10, WW - 20, WH - BAND - 20, 22); ctx.stroke(); ctx.restore();
    ctx.fillStyle = 'rgba(255,255,255,.35)'; ctx.font = '900 30px Jua,sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(q ? '🎲 문제를 읽어보세요!' : '🎲 곧 첫 문제가 공개돼요', WW / 2, (BAND + WH) / 2); return;
  }
  const rev = ph === 'reveal', tot = Math.max(1, G.counts.reduce((a, b) => a + b, 0));
  G.zs.forEach((z, i) => {
    const isAns = rev && i === G.answer, dim = rev && !isAns; ctx.save(); ctx.globalAlpha = dim ? .32 : 1;
    const g = ctx.createLinearGradient(0, z.y, 0, z.y + z.h); g.addColorStop(0, hexA(z.c, isAns ? .55 : .34)); g.addColorStop(1, hexA(z.c, isAns ? .3 : .12));
    rr(z.x, z.y, z.w, z.h, 22); ctx.fillStyle = g; ctx.fill();
    ctx.lineWidth = isAns ? 6 : 3 + (ph === 'think' ? Math.sin(G.t * 4) * .8 : 0); ctx.strokeStyle = isAns ? '#fff' : hexA(z.c, .9); if (isAns) { ctx.shadowColor = '#fff'; ctx.shadowBlur = 28; } ctx.stroke(); ctx.shadowBlur = 0;
    const cx = z.x + z.w / 2, cy = z.y + z.h / 2; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    if (q.type === 'ox') { const s = Math.min(z.w * .8, z.h * .7, 230); ctx.font = `900 ${s}px Jua,sans-serif`; ctx.lineWidth = Math.max(4, s * .05); ctx.strokeStyle = hexA(z.c, .9); ctx.fillStyle = 'rgba(255,255,255,.95)'; ctx.strokeText(z.label, cx, cy); ctx.fillText(z.label, cx, cy); }
    else {
      const ls = Math.min(z.w * .34, z.h * .3, 100), ly = z.y + z.h * .3; ctx.font = `900 ${ls}px Jua,sans-serif`; ctx.lineWidth = Math.max(4, ls * .06); ctx.strokeStyle = hexA(z.c, .95); ctx.fillStyle = '#fff'; ctx.strokeText(z.label, cx, ly); ctx.fillText(z.label, cx, ly);
      let fs = clamp(z.w / 9.5, 13, 28), lines, lh;
      for (; ;) { ctx.font = `700 ${fs}px "Noto Sans KR",sans-serif`; lines = wrapText(z.text, z.w - 26); lh = fs * 1.3; if (lines.length * lh < z.h * .4 || fs <= 12) break; fs -= 1.5; }
      ctx.fillStyle = '#fff'; ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(0,0,0,.45)'; const sy = ly + ls * .62 + fs * .9; lines.forEach((ln, k) => { ctx.strokeText(ln, cx, sy + k * lh); ctx.fillText(ln, cx, sy + k * lh); });
    }
    const label = rev ? `${G.counts[i] || 0}명 (${Math.round((G.counts[i] || 0) / tot * 100)}%)` : `👥 ${G.counts[i] || 0}`; ctx.font = '700 13px "Noto Sans KR",sans-serif'; const tw = ctx.measureText(label).width + 16;
    rr(z.x + z.w - tw - 8, z.y + 8, tw, 24, 12); ctx.fillStyle = 'rgba(0,0,0,.45)'; ctx.fill(); ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.fillText(label, z.x + z.w - tw / 2 - 8, z.y + 20);
    if (isAns) { ctx.font = '900 18px Jua,sans-serif'; const t = '✔ 정답!', tw2 = ctx.measureText(t).width + 22; rr(cx - tw2 / 2, z.y + 10, tw2, 30, 15); ctx.fillStyle = '#b8ff4a'; ctx.fill(); ctx.fillStyle = '#10200a'; ctx.fillText(t, cx, z.y + 25); }
    ctx.restore();
  });
}
function drawEnt(e) {
  let y = e.y, a = 1; if (!e.alive) { a = .35; y += Math.sin(G.t * 2 + e.id) * 3 - 4; }
  ctx.save(); ctx.globalAlpha = a;
  ctx.fillStyle = 'rgba(0,0,0,.35)'; ctx.beginPath(); ctx.ellipse(e.x, y + R * .88, R * .9, R * .34, 0, 0, 6.283); ctx.fill();
  ctx.beginPath(); ctx.arc(e.x, y, R, 0, 6.283); ctx.fillStyle = e.color; ctx.fill(); ctx.lineWidth = e.isMe ? 3.5 : 2; ctx.strokeStyle = e.isMe ? '#ffd43b' : 'rgba(255,255,255,.85)'; ctx.stroke();
  ctx.font = `${R * 1.15}px ${EMO}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = '#000'; ctx.fillText(e.emoji, e.x, y + 1);
  ctx.font = `${e.isMe ? 800 : 600} ${e.isMe ? 12 : 10}px "Noto Sans KR",sans-serif`; const tw = ctx.measureText(e.name).width + 10;
  rr(e.x - tw / 2, y + R + 3, tw, e.isMe ? 16 : 14, 7); ctx.fillStyle = e.isMe ? '#ffd43b' : 'rgba(0,0,0,.55)'; ctx.fill(); ctx.fillStyle = e.isMe ? '#2a1f00' : '#fff'; ctx.fillText(e.name, e.x, y + R + 3 + (e.isMe ? 8 : 7));
  if (e.isMe && e.alive) { const b = Math.sin(G.t * 6) * 3; ctx.fillStyle = '#ffd43b'; ctx.beginPath(); ctx.moveTo(e.x - 7, y - R - 12 + b); ctx.lineTo(e.x + 7, y - R - 12 + b); ctx.lineTo(e.x, y - R - 3 + b); ctx.closePath(); ctx.fill(); }
  if (e.bubT > 0) { ctx.globalAlpha = a * Math.min(1, e.bubT * 2); const by = y - R - (e.isMe ? 32 : 24); rr(e.x - 16, by - 14, 32, 26, 10); ctx.fillStyle = '#fff'; ctx.fill(); ctx.beginPath(); ctx.moveTo(e.x - 4, by + 11); ctx.lineTo(e.x + 4, by + 11); ctx.lineTo(e.x, by + 17); ctx.fill(); ctx.font = `16px ${EMO}`; ctx.fillStyle = '#000'; ctx.fillText(e.bubble, e.x, by); }
  ctx.restore();
}
function loop(now) {
  if (!G.running) return; const dt = Math.min(.05, (now - G.last) / 1000); G.last = now;
  update(dt); draw(); G.raf = requestAnimationFrame(loop);
}
function stopGame() { G.running = false; cancelAnimationFrame(G.raf); hideBanner(); }

/* ---------- 입력 ---------- */
const MOVE = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'KeyA', 'KeyD', 'KeyW', 'KeyS'];
addEventListener('keydown', e => {
  if (!G.running || !$('#game').classList.contains('active')) return;
  if (MOVE.includes(e.code)) { G.keys[e.code] = true; e.preventDefault(); }
  else if (/^Digit[1-5]$/.test(e.code)) react(['👍', '😂', '😱', '🤔', '🔥'][+e.code.slice(5) - 1]);
});
addEventListener('keyup', e => { delete G.keys[e.code]; });
addEventListener('blur', () => { G.keys = {}; });
function setTarget(ev) {
  if (!G.running || !G.me || !G.me.alive) return; const rc = cv.getBoundingClientRect();
  G.target = { x: clamp((ev.clientX - rc.left - G.ox) / G.sc, 0, WW), y: clamp((ev.clientY - rc.top - G.oy) / G.sc, 0, WH) };
}
let pdown = false;
cv.addEventListener('pointerdown', e => { pdown = true; try { cv.setPointerCapture(e.pointerId); } catch (_) {} Snd.init(); setTarget(e); });
cv.addEventListener('pointermove', e => { if (pdown) setTarget(e); });
cv.addEventListener('pointerup', () => { pdown = false; }); cv.addEventListener('pointercancel', () => { pdown = false; });
let lastReact = 0;
function react(t) { const n = performance.now(); if (n - lastReact < 350) return; lastReact = n; send({ t: 'react', e: t }); Snd.pop(); }
$('.tools').addEventListener('click', e => { const b = e.target.closest('[data-r]'); if (b) react(b.dataset.r); });
$('#sndBtn').addEventListener('click', () => { Snd.on = !Snd.on; cfg.snd = Snd.on; saveCfg(); $('#sndBtn').textContent = Snd.on ? '🔊' : '🔇'; if (Snd.on) Snd.init(); });
addEventListener('resize', () => { if (G.running) layout(); });
