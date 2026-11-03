'use strict';
const http = require('http'), fs = require('fs'), path = require('path');
const { WebSocketServer } = require('ws');
const { BUILTIN } = require('./quizzes');

const PORT = process.env.PORT || 3000;
const W = 1000, H = 600, BAND = 130, MAX_PLAYERS = 60;
const PUB = path.join(__dirname, 'public');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };

/* ---------- static files ---------- */
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/index.html';
  if (p === '/favicon.ico') { res.writeHead(204); return res.end(); }
  const f = path.join(PUB, path.normalize(p));
  if (!f.startsWith(PUB)) { res.writeHead(403); return res.end(); }
  fs.readFile(f, (e, d) => {
    if (e) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
    res.end(d);
  });
});
const wss = new WebSocketServer({ server, maxPayload: 64 * 1024 });

/* ---------- helpers ---------- */
const rnd = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const shuffle = a => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const send = (ws, o) => { if (ws.readyState === 1) ws.send(JSON.stringify(o)); };
const bcast = (room, o) => { const s = JSON.stringify(o); room.players.forEach(p => { if (p.ws.readyState === 1) p.ws.send(s); }); };
const clean = (s, n) => String(s || '').replace(/[<>]/g, '').trim().slice(0, n);

function zones(n) {
  const pad = 10, gap = 10, top = BAND + pad, cw = (W - pad * 2 - gap * (n - 1)) / n;
  return Array.from({ length: n }, (_, i) => ({ x: pad + i * (cw + gap), y: top, w: cw, h: H - pad - top }));
}
const zoneAt = (zs, x, y) => zs.findIndex(z => x >= z.x && x <= z.x + z.w && y >= z.y && y <= z.y + z.h);

function normalize(o) {
  if (Array.isArray(o)) o = { questions: o };
  if (!o || !Array.isArray(o.questions) || !o.questions.length) throw new Error('questions 배열이 필요해요');
  const qs = o.questions.slice(0, 100).map((x, i) => {
    const q = clean(x.q ?? x.question, 200); if (!q) throw new Error(`Q${i + 1}: 문제 내용이 비었어요`);
    let ch = Array.isArray(x.choices) ? x.choices.map(c => clean(c, 40)).filter(Boolean) : null;
    const type = (x.type === 'mc' || (ch && ch.length >= 2 && x.type !== 'ox')) ? 'mc' : 'ox';
    const time = clamp(parseInt(x.time) || (type === 'ox' ? 12 : 15), 5, 60), exp = clean(x.exp ?? x.explanation, 160);
    if (type === 'ox') {
      const a = x.answer; let ai = null;
      if (typeof a === 'boolean') ai = a ? 0 : 1; else if (typeof a === 'number') ai = a === 0 ? 0 : 1;
      else { const s = String(a).trim().toUpperCase(); if (s === 'O' || s === 'TRUE') ai = 0; else if (s === 'X' || s === 'FALSE') ai = 1; }
      if (ai === null) throw new Error(`Q${i + 1}: ox 정답은 "O" 또는 "X"여야 해요`);
      return { q, type, choices: ['O', 'X'], answer: ai, time, exp };
    }
    ch = ch.slice(0, 4); if (ch.length < 2) throw new Error(`Q${i + 1}: 보기는 2개 이상 필요해요`);
    let ai = x.answer; if (typeof ai === 'string' && ch.includes(ai.trim())) ai = ch.indexOf(ai.trim()); ai = parseInt(ai);
    if (!(ai >= 0 && ai < ch.length)) throw new Error(`Q${i + 1}: 정답 번호(0부터)가 올바르지 않아요`);
    return { q, type, choices: ch, answer: ai, time, exp };
  });
  return { title: clean(o.title, 30) || '내 퀴즈', questions: qs };
}

/* ---------- rooms ---------- */
const rooms = new Map();
let nextId = 1;
const quizList = room => BUILTIN.concat(room.customs).map(q => ({ id: q.id, emoji: q.emoji || '✏️', title: q.title, n: q.questions.length }));
const pub = p => ({ id: p.id, name: p.name, emoji: p.emoji, color: p.color, spec: p.spec });

function roomInfo(room) {
  return { t: 'room', code: room.code, host: room.host, state: room.state, players: [...room.players.values()].map(pub), quizzes: quizList(room), settings: room.settings };
}
const pushRoom = room => bcast(room, roomInfo(room));

function newCode() { let c; do { c = String(Math.floor(1000 + Math.random() * 9000)); } while (rooms.has(c)); return c; }

function resetPlayer(p) {
  Object.assign(p, { alive: true, spec: false, score: 0, streak: 0, best: 0, corr: 0, answered: 0, elimQ: Infinity, ans: -1, zone: -1, enterAt: 0, x: rnd(40, W - 40), y: rnd(30, BAND - 30), dirty: true });
}

function destroyRoom(room) { clearTimeout(room.timer); clearInterval(room.snapTimer); rooms.delete(room.code); }

function leave(p) {
  const room = p.room; if (!room) return;
  room.players.delete(p.id); p.room = null;
  if (!room.players.size) return destroyRoom(room);
  if (room.host === p.id) room.host = room.players.keys().next().value;
  if (room.state === 'play') bcast(room, { t: 'left', id: p.id });
  pushRoom(room);
}

/* ---------- game flow ---------- */
function startGame(room) {
  const quiz = BUILTIN.concat(room.customs).find(q => q.id === room.settings.quizId) || BUILTIN[0];
  let qs = JSON.parse(JSON.stringify(quiz.questions));
  if (room.settings.shuffle) {
    qs = shuffle(qs);
    qs.forEach(q => { if (q.type === 'mc') { const o = shuffle(q.choices.map((_, i) => i)); q.choices = o.map(i => q.choices[i]); q.answer = o.indexOf(q.answer); } });
  }
  room.game = { title: quiz.title, qs, qi: -1, mode: room.settings.mode, zs: [] };
  room.state = 'play';
  room.players.forEach(resetPlayer);
  pushRoom(room);
  bcast(room, { t: 'start', title: quiz.title, total: qs.length, mode: room.game.mode });
  phase(room, { phase: 'start' }, 5000);
  room.timer = setTimeout(() => nextQ(room), 5000);
  clearInterval(room.snapTimer);
  room.snapTimer = setInterval(() => snap(room, false), 100);
}

function phase(room, msg, ms) {
  const g = room.game;
  const q = g.qs[g.qi];
  room.lastPhase = { t: 'phase', ...msg, qi: g.qi, total: g.qs.length, mode: g.mode, now: Date.now(), endAt: Date.now() + ms,
    q: q ? { q: q.q, type: q.type, choices: q.choices, time: q.time } : null };
  bcast(room, room.lastPhase);
}

function snap(room, reset) {
  const list = [];
  room.players.forEach(p => { if (p.alive && !p.spec && (reset || p.dirty)) { list.push([p.id, Math.round(p.x), Math.round(p.y)]); p.dirty = false; } });
  if (list.length || reset) bcast(room, { t: 'snap', p: list, reset: !!reset });
}

function nextQ(room) {
  const g = room.game; g.qi++;
  if (g.qi >= g.qs.length) return endGame(room);
  const q = g.qs[g.qi]; g.zs = zones(q.choices.length); g.state = 'intro';
  room.players.forEach(p => { if (p.alive) { p.x = rnd(40, W - 40); p.y = rnd(30, BAND - 30); p.zone = -1; p.ans = -1; p.enterAt = 0; } });
  phase(room, { phase: 'intro' }, 2000);
  snap(room, true);
  room.timer = setTimeout(() => think(room), 2000);
}

function think(room) {
  const g = room.game, q = g.qs[g.qi]; g.state = 'think'; g.thinkStart = Date.now();
  phase(room, { phase: 'think' }, q.time * 1000);
  room.timer = setTimeout(() => lock(room), q.time * 1000);
}

function lock(room) {
  const g = room.game; g.state = 'lock';
  const counts = g.zs.map(() => 0);
  room.players.forEach(p => { if (p.alive) { p.ans = zoneAt(g.zs, p.x, p.y); if (p.ans >= 0) counts[p.ans]++; } });
  g.counts = counts;
  phase(room, { phase: 'lock', counts }, 1200);
  room.timer = setTimeout(() => reveal(room), 1200);
}

function ranking(room) {
  const a = [...room.players.values()].filter(p => !p.spec || p.score > 0);
  const surv = room.game && room.game.mode === 'survival';
  const key = p => (p.elimQ === Infinity ? 1e9 : p.elimQ);
  a.sort((x, y) => surv ? ((y.alive - x.alive) || (key(y) - key(x)) || (y.score - x.score)) : (y.score - x.score));
  return a;
}
const rankRow = p => ({ id: p.id, name: p.name, emoji: p.emoji, color: p.color, score: p.score, alive: p.alive, elimQ: p.elimQ === Infinity ? -1 : p.elimQ, corr: p.corr, answered: p.answered, best: p.best });

function reveal(room) {
  const g = room.game, q = g.qs[g.qi]; g.state = 'reveal';
  const alive = [...room.players.values()].filter(p => p.alive);
  const rights = alive.filter(p => p.ans === q.answer);
  const voided = g.mode === 'survival' && rights.length === 0;
  const results = [];
  alive.forEach(p => {
    const ok = p.ans === q.answer; let gain = 0;
    if (!voided) {
      p.answered++;
      if (ok) {
        p.streak++; p.best = Math.max(p.best, p.streak); p.corr++;
        const used = clamp(((p.enterAt || g.thinkStart) - g.thinkStart) / (q.time * 1000), 0, 1);
        gain = 100 + Math.floor(50 * (1 - used)) + Math.min(p.streak - 1, 4) * 10; p.score += gain;
      } else { p.streak = 0; if (g.mode === 'survival') { p.alive = false; p.elimQ = g.qi; } }
    }
    results.push([p.id, ok ? 1 : 0, gain, p.alive ? 1 : 0, p.ans]);
  });
  const ms = 4000 + clamp((q.exp || '').length / 18, 0, 2.2) * 1000;
  const top = ranking(room).slice(0, 10).map(rankRow);
  phase(room, { phase: 'reveal', answer: q.answer, exp: q.exp || '', voided, results, counts: g.counts, top }, ms);
  room.timer = setTimeout(() => {
    const aliveN = [...room.players.values()].filter(p => p.alive).length;
    if (g.qi >= g.qs.length - 1) endGame(room);
    else if (g.mode === 'survival' && room.players.size > 1 && aliveN <= 1) endGame(room, true);
    else nextQ(room);
  }, ms);
}

function endGame(room, early) {
  clearTimeout(room.timer); clearInterval(room.snapTimer);
  room.state = 'end';
  bcast(room, { t: 'end', early: !!early, title: room.game.title, mode: room.game.mode, total: room.game.qs.length, ranking: ranking(room).map(rankRow) });
  pushRoom(room);
}

/* ---------- connections ---------- */
wss.on('connection', ws => {
  const p = { id: nextId++, ws, room: null, name: '', emoji: '🦊', color: '#ff7a59', alive: false, spec: true, score: 0, streak: 0, best: 0, corr: 0, answered: 0, elimQ: Infinity, ans: -1, zone: -1, enterAt: 0, x: 500, y: 60, last: 0 };
  ws.isAlive = true; ws.on('pong', () => { ws.isAlive = true; });
  const err = msg => send(ws, { t: 'err', msg });

  const setProfile = m => { p.name = clean(m.name, 10) || ('플레이어' + Math.floor(rnd(100, 999))); p.emoji = clean(m.emoji, 4) || '🦊'; p.color = /^#[0-9a-f]{6}$/i.test(m.color) ? m.color : '#ff7a59'; };

  ws.on('message', raw => {
    let m; try { m = JSON.parse(raw); } catch (e) { return; }
    const room = p.room;
    switch (m.t) {
      case 'create': {
        if (room) return; setProfile(m);
        const r = { code: newCode(), host: p.id, state: 'lobby', players: new Map(), customs: [], settings: { quizId: BUILTIN[0].id, mode: 'survival', shuffle: true }, game: null, timer: 0, snapTimer: 0 };
        rooms.set(r.code, r); r.players.set(p.id, p); p.room = r; resetPlayer(p); send(ws, { t: 'me', id: p.id }); pushRoom(r); break;
      }
      case 'join': {
        if (room) return; const r = rooms.get(String(m.code || '').trim());
        if (!r) return err('없는 방 코드예요. 숫자 4자리를 다시 확인해 주세요.');
        if (r.players.size >= MAX_PLAYERS) return err('방이 가득 찼어요.');
        setProfile(m);
        const dup = [...r.players.values()].some(x => x.name === p.name); if (dup) p.name = p.name.slice(0, 8) + Math.floor(rnd(10, 99));
        r.players.set(p.id, p); p.room = r;
        if (r.state === 'play') { p.spec = true; p.alive = false; } else resetPlayer(p);
        send(ws, { t: 'me', id: p.id }); pushRoom(r);
        if (r.state === 'play') { send(ws, { t: 'start', title: r.game.title, total: r.game.qs.length, mode: r.game.mode }); if (r.lastPhase) send(ws, r.lastPhase); }
        break;
      }
      case 'set': {
        if (!room || room.host !== p.id || room.state === 'play') return;
        const s = room.settings;
        if (typeof m.quizId === 'string' && quizList(room).some(q => q.id === m.quizId)) s.quizId = m.quizId;
        if (m.mode === 'survival' || m.mode === 'points') s.mode = m.mode;
        if (typeof m.shuffle === 'boolean') s.shuffle = m.shuffle;
        pushRoom(room); break;
      }
      case 'custom': {
        if (!room || room.host !== p.id || room.state === 'play') return;
        try {
          const n = normalize(JSON.parse(m.json)); if (room.customs.length >= 5) room.customs.shift();
          const q = { id: 'c' + Date.now(), emoji: '✏️', title: n.title, questions: n.questions };
          room.customs.push(q); room.settings.quizId = q.id; pushRoom(room); send(ws, { t: 'ok', msg: `${n.questions.length}문제를 불러왔어요` });
        } catch (e) { err('퀴즈 불러오기 실패: ' + e.message); }
        break;
      }
      case 'start': if (room && room.host === p.id && room.state !== 'play') startGame(room); break;
      case 'again': if (room && room.host === p.id && room.state === 'end') { room.state = 'lobby'; room.players.forEach(resetPlayer); pushRoom(room); } break;
      case 'pos': {
        if (!room || room.state !== 'play' || !p.alive) return;
        const g = room.game; if (g.state === 'lock' || g.state === 'reveal') return;
        const x = clamp(+m.x || 0, 0, W), y = clamp(+m.y || 0, 0, H);
        p.x = x; p.y = y; p.dirty = true;
        if (g.state === 'think') { const z = zoneAt(g.zs, x, y); if (z !== p.zone) { p.zone = z; p.enterAt = z >= 0 ? Date.now() : 0; } }
        break;
      }
      case 'react': {
        if (!room || !['👍', '😂', '😱', '🤔', '🔥'].includes(m.e)) return;
        const n = Date.now(); if (n - p.last < 300) return; p.last = n; bcast(room, { t: 'react', id: p.id, e: m.e }); break;
      }
      case 'leave': leave(p); break;
    }
  });
  ws.on('close', () => leave(p));
});

setInterval(() => wss.clients.forEach(ws => { if (!ws.isAlive) return ws.terminate(); ws.isAlive = false; ws.ping(); }), 25000);
server.listen(PORT, () => console.log('MOVE QUIZ server on http://localhost:' + PORT));
