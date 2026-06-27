const socket = io();

let myId = null;
let isHost = false;
let currentRoomCode = null;
let currentPlayers = [];
let maxTime = 12;

const COLORS = ['c0','c1','c2','c3','c4','c5','c6','c7'];
const BG_COLORS = ['#FF4757','#1E90FF','#2ED573','#FFA502','#A29BFE','#FF6B81','#2BCBBA','#ECCC68'];

const FUN_OK = [
  '🔥 Fedt ord!', '💪 Godt klaret!', '😎 Nice!', '🎯 Spot on!',
  '✨ Smart!', '🚀 Woop!', '👏 Klart!', '💥 Bingo!', '🥳 Ja!', '⚡ Hurtig!'
];
const FUN_BOOM = ['💥 BOOM!', '🧨 Pang!', '😬 Åh nej!', '🙈 Au!', '💣 Kaboom!'];

function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
  window.scrollTo(0, 0);
}

function esc(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
function initials(name) { return name.trim().charAt(0).toUpperCase(); }
function colorIdx(i) { return i % 8; }
function rand(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

/* ── JOIN ── */
function joinRoom() {
  const name = document.getElementById('playerName').value.trim();
  const code = document.getElementById('roomCode').value.trim().toUpperCase();
  if (!name) { showErr('Skriv dit navn! 😅'); return; }
  if (code.length < 2) { showErr('Skriv en rumkode! 🔑'); return; }
  socket.emit('join-room', { playerName: name, roomCode: code });
}
function showErr(msg) {
  const el = document.getElementById('join-error');
  if (!el) return;
  el.textContent = msg;
  clearTimeout(el._t);
  el._t = setTimeout(() => el.textContent = '', 4000);
}
document.getElementById('playerName').addEventListener('keydown', e => { if (e.key === 'Enter') document.getElementById('roomCode').focus(); });
document.getElementById('roomCode').addEventListener('keydown', e => { if (e.key === 'Enter') joinRoom(); });

/* ── COPY CODE ── */
function copyCode() {
  navigator.clipboard.writeText(currentRoomCode).then(() => {
    const b = document.querySelector('.copy-btn');
    if (b) { b.textContent = '✅'; setTimeout(() => b.textContent = '📋', 1500); }
  });
}

/* ── LOBBY ── */
function renderLobby(room) {
  currentPlayers = room.players;
  document.getElementById('displayRoomCode').textContent = room.code;
  document.getElementById('gameRoomCode').textContent = room.code;

  const container = document.getElementById('lobbySeats');
  container.innerHTML = '';
  room.players.forEach((p, i) => {
    const ci = colorIdx(i);
    const div = document.createElement('div');
    div.className = 'lobby-seat';
    div.innerHTML = `
      <div class="seat-avatar c${ci}">${initials(p.name)}</div>
      <div class="seat-name">${esc(p.name)}</div>
      ${p.id === myId ? '<div class="seat-you">← Det er dig</div>' : ''}
      ${p.isHost ? '<div class="seat-host">Vært 👑</div>' : ''}
    `;
    container.appendChild(div);
  });

  const startBtn = document.getElementById('startBtn');
  const waitMsg  = document.getElementById('waitingMsg');
  if (isHost) { startBtn.style.display = 'block'; waitMsg.style.display = 'none'; }
  else        { startBtn.style.display = 'none';  waitMsg.style.display = 'block'; }
}

function startGame() { socket.emit('start-game', { roomCode: currentRoomCode }); }

/* ═══════════════════════════════════
   ROUND TABLE LAYOUT
═══════════════════════════════════ */
function buildSeats(players) {
  // Remove old seats
  document.querySelectorAll('.player-seat').forEach(el => el.remove());

  const scene = document.getElementById('tableScene');
  players.forEach((p, i) => {
    const ci = colorIdx(i);
    const div = document.createElement('div');
    div.className = 'player-seat' + (p.eliminated ? ' eliminated' : '');
    div.id = 'seat-' + p.id;
    const hearts = p.eliminated ? '💀' : '❤️'.repeat(Math.max(0, p.lives));
    div.innerHTML = `
      ${p.id === myId ? '<div class="your-arrow">👇</div>' : ''}
      <div class="seat-chip bc${ci}">
        <div class="seat-ico c${ci}">${initials(p.name)}</div>
        <div class="seat-nm">${esc(p.name)}</div>
        <div class="seat-hp">${hearts}</div>
      </div>
    `;
    scene.appendChild(div);
  });

  positionSeats(players);
}

function positionSeats(players) {
  const scene = document.getElementById('tableScene');
  const felt  = document.querySelector('.table-felt');
  if (!felt) return;

  const sr = scene.getBoundingClientRect();
  const fr = felt.getBoundingClientRect();
  const cx = fr.left - sr.left + fr.width / 2;
  const cy = fr.top  - sr.top  + fr.height / 2;

  // orbit just outside the felt
  const rx = fr.width  / 2 + 52;
  const ry = fr.height / 2 + 52;

  const n = players.length;
  players.forEach((p, i) => {
    const angle = (i / n) * 2 * Math.PI - Math.PI / 2;
    const x = cx + rx * Math.cos(angle);
    const y = cy + ry * Math.sin(angle);
    const el = document.getElementById('seat-' + p.id);
    if (!el) return;
    el.style.left = x + 'px';
    el.style.top  = y + 'px';
    el.style.transform = 'translate(-50%, -50%)';
  });
}

function updateSeats(players, activeId) {
  currentPlayers = players;
  players.forEach((p, i) => {
    const el = document.getElementById('seat-' + p.id);
    if (!el) return;
    el.classList.toggle('active', p.id === activeId);
    el.classList.toggle('eliminated', !!p.eliminated);
    const hp = el.querySelector('.seat-hp');
    if (hp) hp.textContent = p.eliminated ? '💀' : '❤️'.repeat(Math.max(0, p.lives));
    // show/hide arrow
    const arrow = el.querySelector('.your-arrow');
    if (arrow) arrow.style.display = (p.id === myId && p.id === activeId) ? 'block' : 'none';
  });
}

/* ── TIMER ── */
let urgentClass = false;
function updateTimer(t, max) {
  const circ = 213.6;
  const offset = circ * (1 - t / max);
  const arc = document.getElementById('tArc');
  if (arc) {
    arc.style.strokeDashoffset = offset;
    arc.style.stroke = t <= 3 ? '#FF4757' : t <= 6 ? '#FFA502' : '#2ED573';
  }
  const num = document.getElementById('tNum');
  if (num) num.textContent = t;

  const felt = document.querySelector('.table-felt');
  if (t <= 3 && !urgentClass) { felt?.classList.add('urgent');  urgentClass = true; }
  if (t > 3 && urgentClass)  { felt?.classList.remove('urgent'); urgentClass = false; }
}

/* ── WORD INPUT ── */
function setInputActive(active) {
  document.getElementById('wordInputWrap').style.display = active ? 'flex' : 'none';
  document.getElementById('notYourTurn').style.display   = active ? 'none' : 'block';
  if (active) {
    const inp = document.getElementById('wordInput');
    inp.value = '';
    setTimeout(() => inp.focus(), 80);
  }
}

function submitWord() {
  const word = document.getElementById('wordInput').value.trim().toLowerCase();
  if (!word) return;
  socket.emit('submit-word', { roomCode: currentRoomCode, word });
  document.getElementById('wordInput').value = '';
}
document.getElementById('wordInput').addEventListener('keydown', e => { if (e.key === 'Enter') submitWord(); });

/* ── FEEDBACK ── */
function showFeedback(msg, isOk) {
  const el = document.getElementById('feedback');
  el.textContent = msg;
  el.className = 'feedback-toast ' + (isOk ? 'ok' : 'bad');
  clearTimeout(el._t);
  el._t = setTimeout(() => { el.textContent = ''; el.className = 'feedback-toast'; }, 2800);
}

/* ── WORD HISTORY ── */
function addHistory(word, syllable) {
  const c = document.getElementById('wordHistory');
  const span = document.createElement('span');
  span.className = 'hw';
  const rx = new RegExp('(' + syllable.replace(/[.*+?^${}()|[\]\\]/g,'\\$&') + ')', 'gi');
  span.innerHTML = word.replace(rx, '<b>$1</b>');
  c.prepend(span);
  while (c.children.length > 25) c.removeChild(c.lastChild);
}

/* ── CONFETTI ── */
function confetti() {
  const layer = document.getElementById('confettiLayer');
  const colors = ['#FFD700','#FF4757','#2ED573','#1E90FF','#FFA502','#A29BFE','#FF6B81'];
  for (let i = 0; i < 40; i++) {
    const el = document.createElement('div');
    el.className = 'cf';
    el.style.left = Math.random() * 100 + 'vw';
    el.style.backgroundColor = rand(colors);
    el.style.width  = (8 + Math.random() * 8) + 'px';
    el.style.height = (8 + Math.random() * 8) + 'px';
    el.style.borderRadius = Math.random() > 0.5 ? '50%' : '2px';
    el.style.setProperty('--dur', (0.7 + Math.random() * 0.6) + 's');
    el.style.setProperty('--dx', (Math.random() * 120 - 60) + 'px');
    el.style.animationDelay = Math.random() * 0.3 + 's';
    layer.appendChild(el);
    setTimeout(() => el.remove(), 2000);
  }
}

/* ── GAME OVER ── */
function renderGameOver(winner, players) {
  const wb = document.getElementById('winnerBox');
  if (winner) {
    wb.innerHTML = `
      <span class="trophy-big">🏆</span>
      <h3>Vinderen er</h3>
      <div class="winner-name">${esc(winner.name)}</div>
    `;
    if (winner.id === myId) confetti();
  } else {
    wb.innerHTML = '<div class="no-winner">Ingen vinder! 😬</div>';
  }
  const fl = document.getElementById('finalList');
  fl.innerHTML = '';
  [...players].sort((a,b) => b.lives - a.lives).forEach((p, i) => {
    const div = document.createElement('div');
    div.className = 'final-row' + (winner && p.id === winner.id ? ' winner-row' : '');
    const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i+1}.`;
    div.innerHTML = `
      <span class="final-rank">${medal}</span>
      <span class="final-name">${esc(p.name)}</span>
      <span class="final-hp">${p.eliminated ? '💀' : '❤️'.repeat(Math.max(0,p.lives))}</span>
    `;
    fl.appendChild(div);
  });
  const btn  = document.getElementById('playAgainBtn');
  const wait = document.getElementById('waitAgain');
  if (isHost) { btn.style.display = 'inline-block'; wait.textContent = ''; }
  else        { btn.style.display = 'none'; wait.textContent = 'Venter på at vært starter igen...'; }
}

function playAgain() { socket.emit('play-again', { roomCode: currentRoomCode }); }

/* ── REPOSITION ON RESIZE ── */
window.addEventListener('resize', () => {
  if (currentPlayers.length > 0 && document.getElementById('screen-game').classList.contains('active')) {
    positionSeats(currentPlayers);
  }
});

/* ═══════════════════════════════════
   SOCKET EVENTS
═══════════════════════════════════ */
socket.on('room-joined', ({ room, yourId, isHost: h }) => {
  myId = yourId; isHost = h;
  currentRoomCode = room.code;
  renderLobby(room);
  showScreen('screen-lobby');
});

socket.on('player-joined', ({ room }) => { renderLobby(room); });
socket.on('player-left',   ({ players }) => {
  if (document.getElementById('screen-lobby').classList.contains('active')) {
    renderLobby({ code: currentRoomCode, players });
  }
});

socket.on('new-host', ({ hostId }) => {
  if (hostId === myId) {
    isHost = true;
    document.getElementById('startBtn').style.display = 'block';
    document.getElementById('waitingMsg').style.display = 'none';
  }
});

socket.on('error-msg', ({ message }) => {
  showErr(message);
  showFeedback(message, false);
});

socket.on('game-started', ({ players }) => {
  currentPlayers = players;
  urgentClass = false;
  document.getElementById('wordHistory').innerHTML = '';
  showScreen('screen-game');

  // wait a tick for DOM to render, then build seats
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      buildSeats(players);
      document.getElementById('sylText').textContent = '—';
      document.getElementById('currentLabel').textContent = '🎲 Spillet starter...';
      setInputActive(false);
      updateTimer(12, 12);
    });
  });
});

socket.on('new-turn', ({ currentPlayerId, currentPlayerName, syllable, timeLeft, players }) => {
  currentPlayers = players;
  maxTime = timeLeft;
  const felt = document.querySelector('.table-felt');
  felt?.classList.remove('urgent');
  urgentClass = false;

  updateSeats(players, currentPlayerId);
  setInputActive(currentPlayerId === myId);
  updateTimer(timeLeft, maxTime);

  document.getElementById('currentLabel').textContent =
    currentPlayerId === myId ? '🎯 DIN TUR!' : `🎮 ${esc(currentPlayerName)}s tur`;

  const st = document.getElementById('sylText');
  st.style.animation = 'none';
  requestAnimationFrame(() => { st.style.animation = ''; st.textContent = syllable.toUpperCase(); });

  document.getElementById('feedback').textContent = '';
});

socket.on('timer-tick', ({ timeLeft }) => updateTimer(timeLeft, maxTime));

socket.on('word-accepted', ({ word, syllable }) => {
  addHistory(word, syllable);
  confetti();
  showFeedback(rand(FUN_OK), true);
});

socket.on('word-rejected', ({ message }) => {
  showFeedback('❌ ' + message, false);
  const inp = document.getElementById('wordInput');
  if (inp) { inp.value = ''; inp.focus(); }
});

socket.on('player-lost-life', ({ playerId, playerName, livesLeft, players }) => {
  updateSeats(players, null);
  const isMe = playerId === myId;
  showFeedback(
    isMe ? `${rand(FUN_BOOM)} Du har ${livesLeft} ❤️ tilbage!`
         : `${rand(FUN_BOOM)} ${esc(playerName)} mister et liv!`,
    false
  );
});

socket.on('player-eliminated', ({ playerId, playerName, players }) => {
  updateSeats(players, null);
  const isMe = playerId === myId;
  showFeedback(isMe ? '💀 Du er ude! Beklager...' : `💀 ${esc(playerName)} er ude!`, false);
});

socket.on('game-over', ({ winner, players }) => {
  document.querySelector('.table-felt')?.classList.remove('urgent');
  renderGameOver(winner, players);
  showScreen('screen-gameover');
});

socket.on('game-reset', ({ room }) => {
  renderLobby(room);
  showScreen('screen-lobby');
});
