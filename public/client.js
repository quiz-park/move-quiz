'use strict';
/* ====== 접속 · 대기실 · 결과 화면 ====== */
const $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => [...r.querySelectorAll(s)];
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const store = { get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } }, set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} } };
const showScreen = id => $$('.screen').forEach(s => s.classList.toggle('active', s.id === id));
let toastTO = 0;
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toastTO); toastTO = setTimeout(() => t.classList.remove('show'), 2800); }
function copyText(txt) {
  const fb = () => { const ta = document.createElement('textarea'); ta.value = txt; ta.style.position = 'fixed'; ta.style.opacity = '0'; document.body.appendChild(ta); ta.select(); try { document.execCommand('copy'); } catch (e) {} ta.remove(); };
  if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(txt).catch(fb); else fb();
}

const EMOJIS = ['🦊', '🐱', '🐶', '🐼', '🐸', '🐵', '🦁', '🐯', '🐰', '🐻', '🐧', '🐙', '🦄', '🐲', '🦉', '🐳'];
const COLORS = ['#ff7a59', '#ffb02e', '#ffd43b', '#8ce99a', '#38e1ff', '#6c8cff', '#b388ff', '#ff4f8b'];
const cfg = Object.assign({ name: '', emoji: '🦊', color: '#ff7a59', snd: true }, store.get('mq.online', {}));
const saveCfg = () => store.set('mq.online', cfg);

let ws = null, myId = 0, room = null, pending = null;
const send = o => { if (ws && ws.readyState === 1) ws.send(JSON.stringify(o)); };

function connect(then) {
  if (ws && ws.readyState === 1) return then();
  pending = then; if (ws && ws.readyState === 0) return;
  ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host);
  ws.onopen = () => { const f = pending; pending = null; if (f) f(); };
  ws.onmessage = ev => { let m; try { m = JSON.parse(ev.data); } catch (e) { return; } onMsg(m); };
  ws.onclose = () => {
    const was = room; ws = null; room = null; myId = 0;
    if (typeof stopGame === 'function') stopGame();
    showScreen('join'); toast(was ? '서버와 연결이 끊어졌어요. 다시 입장해 주세요.' : '서버에 연결할 수 없어요. 잠시 후 다시 시도해 주세요.');
  };
}
const profile = () => ({ name: cfg.name, emoji: cfg.emoji, color: cfg.color });

/* ---------- 입장 화면 ---------- */
function renderJoin() {
  $('#nameIn').value = cfg.name; $('#pvAv').textContent = cfg.emoji; $('#pvAv').style.background = cfg.color;
  $('#emojiGrid').innerHTML = EMOJIS.map(e => `<button class="eb ${e === cfg.emoji ? 'on' : ''}" data-e="${e}">${e}</button>`).join('');
  $('#colorRow').innerHTML = COLORS.map(c => `<button class="cb ${c === cfg.color ? 'on' : ''}" data-c="${c}" style="background:${c}"></button>`).join('');
}
$('#nameIn').addEventListener('input', e => { cfg.name = e.target.value.trim(); saveCfg(); });
$('#emojiGrid').addEventListener('click', e => { const b = e.target.closest('[data-e]'); if (!b) return; cfg.emoji = b.dataset.e; saveCfg(); renderJoin(); });
$('#colorRow').addEventListener('click', e => { const b = e.target.closest('[data-c]'); if (!b) return; cfg.color = b.dataset.c; saveCfg(); renderJoin(); });
$('#codeIn').addEventListener('input', e => { e.target.value = e.target.value.replace(/\D/g, '').slice(0, 4); });
$('#codeIn').addEventListener('keydown', e => { if (e.key === 'Enter') $('#joinBtn').click(); });
function prepSound() { Snd.on = cfg.snd; Snd.init(); }
$('#createBtn').addEventListener('click', () => { prepSound(); connect(() => send({ t: 'create', ...profile() })); });
$('#joinBtn').addEventListener('click', () => {
  const code = $('#codeIn').value.trim(); if (code.length !== 4) return toast('숫자 4자리 방 코드를 입력해 주세요');
  prepSound(); connect(() => send({ t: 'join', code, ...profile() }));
});

/* ---------- 대기실 ---------- */
const MODE_HINT = { survival: '오답이거나 구역 밖에 있으면 탈락! 끝까지 살아남으세요. (전원 오답이면 무효 처리)', points: '아무도 탈락하지 않아요. 빠르고 정확하게 자리 잡을수록 높은 점수!' };
function renderLobby() {
  if (!room) return; const host = room.host === myId, s = room.settings;
  $('#roomCode').textContent = room.code; $('#pcount').textContent = room.players.length + '명';
  $('#plist').innerHTML = room.players.map(p => `<div class="pc ${p.id === myId ? 'me' : ''} ${p.id === room.host ? 'host' : ''}"><i style="background:${p.color}">${p.emoji}</i>${esc(p.name)}</div>`).join('');
  $('#hostBox').hidden = !host; $('#waitBox').hidden = host;
  const q = room.quizzes.find(x => x.id === s.quizId);
  $('#waitInfo').textContent = q ? `${q.emoji} ${q.title} · ${q.n}문제 · ${s.mode === 'survival' ? '서바이벌' : '포인트전'}` : '';
  $('#quizGrid').innerHTML = room.quizzes.map(x => `<button class="qz ${x.id === s.quizId ? 'on' : ''}" data-id="${x.id}"><div>${x.emoji}</div><div class="qt">${esc(x.title)}</div><div class="qm">${x.n}문제</div></button>`).join('');
  $$('#modeSeg button').forEach(b => b.classList.toggle('on', b.dataset.v === s.mode));
  $('#modeHint').textContent = MODE_HINT[s.mode]; $('#shuffleChk').checked = s.shuffle;
  $('#startBtn').textContent = room.state === 'end' ? '🚀 다시 시작' : '🚀 게임 시작';
}
$('#quizGrid').addEventListener('click', e => { const b = e.target.closest('[data-id]'); if (b) send({ t: 'set', quizId: b.dataset.id }); });
$('#modeSeg').addEventListener('click', e => { const b = e.target.closest('button'); if (b) send({ t: 'set', mode: b.dataset.v }); });
$('#shuffleChk').addEventListener('change', e => send({ t: 'set', shuffle: e.target.checked }));
$('#jsonBtn').addEventListener('click', () => { const v = $('#jsonIn').value.trim(); if (!v) return toast('JSON을 붙여넣어 주세요'); send({ t: 'custom', json: v }); });
$('#startBtn').addEventListener('click', () => send({ t: 'start' }));
$('#copyLink').addEventListener('click', () => { if (!room) return; copyText(location.origin + location.pathname + '?code=' + room.code); toast('초대 링크를 복사했어요. 참가자에게 보내 주세요 🔗'); });
$('#leaveBtn').addEventListener('click', () => { send({ t: 'leave' }); room = null; showScreen('join'); });

/* ---------- 결과 ---------- */
function updateResultBtns() {
  if (!room) return; const host = room.host === myId;
  $('#againBtn').disabled = !host; $('#againHint').textContent = host ? '' : '사회자가 "한 판 더"를 누르면 모두 대기실로 돌아가요.';
}
function showResult(m) {
  stopGame(); showScreen('result');
  const rk = m.ranking, N = rk.length, mi = rk.findIndex(r => r.id === myId), me = mi >= 0 ? rk[mi] : null, surv = m.mode === 'survival';
  const aliveN = rk.filter(r => r.alive).length;
  $('#resTitle').textContent = surv && aliveN === 1 ? '🏆 우승자 탄생!' : '게임 종료!';
  $('#resSub').textContent = `${m.title} · ${surv ? '서바이벌' : '포인트전'} · 참가 ${N}명`;
  const top = rk.slice(0, 3), ord = top.length >= 3 ? [1, 0, 2] : top.length === 2 ? [1, 0] : [0];
  $('#podium').innerHTML = ord.map(i => { const e = top[i]; return `<div class="pd p${i + 1}"><div class="av" style="background:${e.color}">${e.emoji}</div><div class="nm">${esc(e.name)}${e.id === myId ? ' (나)' : ''}</div><div class="sc">${e.score}점</div><div class="bar">${i + 1}</div></div>`; }).join('');
  let title;
  if (!me) title = '👀 관전으로 함께했어요';
  else if (surv) title = me.alive ? (aliveN === 1 ? '👑 최후의 생존자!' : `🛡️ 생존자 (공동 생존 ${aliveN}명)`) : `💥 ${me.elimQ + 1}번 문제에서 탈락`;
  else title = mi === 0 ? '🥇 퀴즈왕!' : mi < 3 ? '🏅 시상대 입성!' : mi < Math.ceil(N / 2) ? '👍 상위권!' : '💪 다음엔 더 빠르게!';
  $('#myTitle').textContent = title;
  $('#sumBox').innerHTML = me ? `<div class="st"><b>${mi + 1}/${N}</b><span>내 순위</span></div><div class="st"><b>${me.score}</b><span>점수</span></div><div class="st"><b>${me.corr}/${me.answered}</b><span>정답</span></div><div class="st"><b>${me.best}🔥</b><span>최고 연속 정답</span></div>` : '';
  $('#rankList').innerHTML = rk.map((e, i) => `<div class="rk ${e.id === myId ? 'me' : ''}" style="font-size:14px;padding:5px 8px"><i>${i + 1}</i><span>${e.emoji} ${esc(e.name)}${surv && !e.alive ? ` <small style="color:#9aa6e6">· Q${e.elimQ + 1} 탈락</small>` : ''}</span><b>${e.score}</b></div>`).join('');
  updateResultBtns(); Snd.win();
  if (me && (mi < 3 || (surv && me.alive))) confetti();
}
function confetti() {
  const c = $('#fx'), x = c.getContext('2d'); c.width = innerWidth; c.height = innerHeight;
  const cols = ['#ffd43b', '#ff4f8b', '#38e1ff', '#b8ff4a', '#b388ff', '#ff8a3d'], t0 = performance.now();
  const ps = Array.from({ length: 150 }, () => ({ x: Math.random() * c.width, y: -Math.random() * c.height * .6, vx: Math.random() * 80 - 40, vy: 140 + Math.random() * 200, s: 6 + Math.random() * 5, r: Math.random() * 6, vr: Math.random() * 12 - 6, col: cols[Math.floor(Math.random() * cols.length)] }));
  (function f(now) {
    x.clearRect(0, 0, c.width, c.height);
    ps.forEach(p => { p.x += p.vx * .016; p.y += p.vy * .016; p.r += p.vr * .016; x.save(); x.translate(p.x, p.y); x.rotate(p.r); x.fillStyle = p.col; x.fillRect(-p.s / 2, -p.s / 3, p.s, p.s * .66); x.restore(); });
    if ((now - t0) / 1000 < 5 && $('#result').classList.contains('active')) requestAnimationFrame(f); else x.clearRect(0, 0, c.width, c.height);
  })(t0);
}
$('#againBtn').addEventListener('click', () => send({ t: 'again' }));
$('#lobbyBtn').addEventListener('click', () => { showScreen('lobby'); renderLobby(); });

/* ---------- 서버 메시지 ---------- */
function onMsg(m) {
  switch (m.t) {
    case 'me': myId = m.id; break;
    case 'room': {
      room = m; const cur = $('.screen.active').id;
      if (cur === 'join' && m.state !== 'play') showScreen('lobby');
      if (cur === 'result' && m.state === 'lobby') showScreen('lobby');
      renderLobby(); if (cur === 'result') updateResultBtns(); break;
    }
    case 'start': gameStart(m); break;
    case 'phase': onPhase(m); break;
    case 'snap': onSnap(m); break;
    case 'react': onReact(m); break;
    case 'left': onLeft(m); break;
    case 'end': showResult(m); break;
    case 'ok': case 'err': toast(m.msg); break;
  }
}

/* ---------- 시작 ---------- */
renderJoin();
const urlCode = new URLSearchParams(location.search).get('code');
if (urlCode) { $('#codeIn').value = urlCode.replace(/\D/g, '').slice(0, 4); }
