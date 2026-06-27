const socket = io();

let myId = null;
let isHost = false;
let currentRoomCode = null;
let currentGameRoom = null;
let maxTime = 12;
let currentTime = 12;
let timerArc = null;

// ── UTILS ──
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
  // scroll to top
  window.scrollTo(0, 0);
}

function showError(elId, msg) {
  const el = document.getElementById(elId);
  if (el) { el.textContent = msg; setTimeout(() => { el.textContent = ''; }, 4000); }
}

function avatarColor(idx) { return 'av' + (idx % 8); }
function initials(name) { return name.trim().charAt(0).toUpperCase(); }

// ── JOIN ──
function joinRoom() {
  const name = document.getElementById('playerName').value.trim();
  const code = document.getElementById('roomCode').value.trim().toUpperCase();
  if (!name) { showError('join-error', 'Skriv dit navn!'); return; }
  if (!code || code.length < 2) { showError('join-error', 'Skriv en rumkode (mindst 2 tegn)!'); return; }
  socket.emit('join-room', { playerName: name, roomCode: code });
}

document.getElementById('playerName').addEventListener('keydown', e => { if (e.key === 'Enter') document.getElementById('roomCode').focus(); });
document.getElementById('roomCode').addEventListener('keydown', e => { if (e.key === 'Enter') joinRoom(); });

// ── COPY ──
function copyCode() {
  navigator.clipboard.writeText(currentRoomCode).then(() => {
    const btn = document.querySelector('.copy-btn');
    btn.textContent = '✅'; setTimeout(() => btn.textContent = '📋', 1500);
  });
}

// ── LOBBY ──
function renderLobby(room) {
  currentGameRoom = room;
  document.getElementById('displayRoomCode').textContent = room.code;
  document.getElementById('gameRoomCode').textContent = room.code;

  const list = document.getElementById('playerList');
  list.innerHTML = '';
  room.players.forEach((p, i) => {
    const div = document.createElement('div');
    div.className = 'player-item';
    div.innerHTML = `
      <div class="player-avatar ${avatarColor(i)}">${initials(p.name)}</div>
      <div class="player-name">${escHtml(p.name)}${p.id === myId ? ' (dig)' : ''}</div>
      ${p.isHost ? '<div class="host-badge">Vært</div>' : ''}
    `;
    list.appendChild(div);
  });

  const startBtn = document.getElementById('startBtn');
  const waitMsg  = document.getElementById('waitingMsg');
  if (isHost) {
    startBtn.style.display = 'block';
    waitMsg.style.display  = 'none';
  } else {
    startBtn.style.display = 'none';
    waitMsg.style.display  = 'block';
  }
}

function startGame() { socket.emit('start-game', { roomCode: currentRoomCode }); }

// ── GAME RENDER ──
function renderGamePlayers(players, activeId) {
  const container = document.getElementById('gamePlayers');
  container.innerHTML = '';
  players.forEach((p, i) => {
    const div = document.createElement('div');
    div.className = 'game-player' + (p.id === activeId ? ' active' : '') + (p.eliminated ? ' eliminated' : '');
    div.id = 'gp-' + p.id;
    const hearts = p.eliminated ? '💀' : '❤️'.repeat(Math.max(0, p.lives));
    div.innerHTML = `
      <div class="player-avatar ${avatarColor(i)}" style="width:28px;height:28px;font-size:0.8rem;">${initials(p.name)}</div>
      <div class="game-player-name">${escHtml(p.name)}</div>
      <div class="game-player-lives">${hearts}</div>
    `;
    container.appendChild(div);
  });
}

// ── TIMER ──
function initTimer() {
  timerArc = document.getElementById('timerArc');
}

function updateTimer(timeLeft, max) {
  const circumference = 264;
  const progress = timeLeft / max;
  const offset = circumference * (1 - progress);
  if (timerArc) timerArc.style.strokeDashoffset = offset;
  document.getElementById('timerNumber').textContent = timeLeft;

  const bomb = document.getElementById('bombDisplay');
  if (timeLeft <= 3) {
    bomb.classList.add('urgent');
    if (timerArc) timerArc.style.stroke = '#e94560';
  } else if (timeLeft <= 6) {
    bomb.classList.remove('urgent');
    if (timerArc) timerArc.style.stroke = '#f5a623';
  } else {
    bomb.classList.remove('urgent');
    if (timerArc) timerArc.style.stroke = '#2ecc71';
  }
}

// ── WORD INPUT ──
function setInputActive(active) {
  document.getElementById('wordInputArea').style.display = active ? 'flex' : 'none';
  document.getElementById('notYourTurn').style.display   = active ? 'none' : 'block';
  if (active) {
    const inp = document.getElementById('wordInput');
    inp.value = '';
    inp.focus();
  }
}

function submitWord() {
  const word = document.getElementById('wordInput').value.trim().toLowerCase();
  if (!word) return;
  socket.emit('submit-word', { roomCode: currentRoomCode, word });
  document.getElementById('wordInput').value = '';
}

document.getElementById('wordInput').addEventListener('keydown', e => {
  if (e.key === 'Enter') submitWord();
});

// ── WORD HISTORY ──
function addWordToHistory(word, syllable) {
  const container = document.getElementById('wordHistory');
  const span = document.createElement('span');
  span.className = 'history-word';
  const hi = word.replace(new RegExp('(' + escapeRegex(syllable) + ')', 'gi'), '<span class="hl">$1</span>');
  span.innerHTML = hi;
  container.prepend(span);
  // keep at most 30 words visible
  while (container.children.length > 30) container.removeChild(container.lastChild);
}

function showFeedback(msg, isOk) {
  const el = document.getElementById('wordFeedback');
  el.textContent = msg;
  el.className = 'word-feedback' + (isOk ? ' ok' : '');
  clearTimeout(el._t);
  el._t = setTimeout(() => { el.textContent = ''; el.className = 'word-feedback'; }, 2500);
}

// ── GAME OVER ──
function renderGameOver(winner, players) {
  const winnerDiv = document.getElementById('winnerDisplay');
  if (winner) {
    winnerDiv.innerHTML = `
      <span class="trophy">🏆</span>
      <h2>Vinderen er</h2>
      <div class="winner-name">${escHtml(winner.name)}</div>
    `;
  } else {
    winnerDiv.innerHTML = `<div class="no-winner">Ingen vinder!</div>`;
  }

  const scores = document.getElementById('finalScores');
  scores.innerHTML = '';
  [...players].sort((a,b) => b.lives - a.lives).forEach((p, i) => {
    const div = document.createElement('div');
    div.className = 'final-player' + (winner && p.id === winner.id ? ' winner-row' : '');
    const hearts = p.eliminated ? '💀' : '❤️'.repeat(Math.max(0, p.lives));
    div.innerHTML = `
      <span>${i+1}.</span>
      <div class="final-player-name">${escHtml(p.name)}</div>
      <div class="final-player-lives">${hearts}</div>
    `;
    scores.appendChild(div);
  });

  const btn = document.getElementById('playAgainBtn');
  const wait = document.getElementById('waitingPlayAgain');
  if (isHost) {
    btn.style.display = 'block';
    wait.textContent = '';
  } else {
    btn.style.display = 'none';
    wait.textContent = 'Venter på at vært starter igen...';
  }
}

function playAgain() { socket.emit('play-again', { roomCode: currentRoomCode }); }

// ── HELPERS ──
function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function escapeRegex(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

// ── SOCKET EVENTS ──
socket.on('room-joined', ({ room, yourId, isHost: h }) => {
  myId = yourId;
  isHost = h;
  currentRoomCode = room.code;
  renderLobby(room);
  showScreen('screen-lobby');
});

socket.on('player-joined', ({ room }) => {
  if (document.getElementById('screen-lobby').classList.contains('active')) {
    renderLobby(room);
  }
});

socket.on('player-left', ({ players }) => {
  if (currentGameRoom) currentGameRoom.players = players;
  if (document.getElementById('screen-lobby').classList.contains('active')) {
    renderLobby({ ...currentGameRoom, players });
  }
});

socket.on('new-host', ({ hostId }) => {
  if (hostId === myId) {
    isHost = true;
    const startBtn = document.getElementById('startBtn');
    const waitMsg  = document.getElementById('waitingMsg');
    if (startBtn) { startBtn.style.display = 'block'; }
    if (waitMsg)  { waitMsg.style.display  = 'none'; }
  }
});

socket.on('error-msg', ({ message }) => {
  showError('join-error', message);
  // also show in game if active
  showFeedback(message, false);
});

socket.on('game-started', ({ players }) => {
  if (currentGameRoom) currentGameRoom.players = players;
  maxTime = 12;
  document.getElementById('wordHistory').innerHTML = '';
  showScreen('screen-game');
  initTimer();
  renderGamePlayers(players, null);
  document.getElementById('currentPlayerLabel').textContent = 'Spillet starter...';
  document.getElementById('syllableText').textContent = '—';
  setInputActive(false);
});

socket.on('new-turn', ({ currentPlayerId, currentPlayerName, syllable, timeLeft, players }) => {
  if (currentGameRoom) currentGameRoom.players = players;
  currentTime = timeLeft;
  maxTime = timeLeft;

  renderGamePlayers(players, currentPlayerId);

  const isMe = currentPlayerId === myId;
  document.getElementById('currentPlayerLabel').textContent =
    isMe ? '🎯 Din tur!' : `⏳ ${escHtml(currentPlayerName)}s tur`;
  document.getElementById('syllableText').textContent = syllable.toUpperCase();
  document.getElementById('syllableText').style.animation = 'none';
  requestAnimationFrame(() => {
    document.getElementById('syllableText').style.animation = '';
  });

  setInputActive(isMe);
  updateTimer(timeLeft, maxTime);
  document.getElementById('wordFeedback').textContent = '';
});

socket.on('timer-tick', ({ timeLeft }) => {
  currentTime = timeLeft;
  updateTimer(timeLeft, maxTime);
});

socket.on('word-accepted', ({ playerName, word, syllable }) => {
  addWordToHistory(word, syllable);
  const isMe = playerName === (currentGameRoom?.players.find(p=>p.id===myId)?.name);
  showFeedback(`✅ "${word}"`, true);
});

socket.on('word-rejected', ({ message }) => {
  showFeedback('❌ ' + message, false);
  const inp = document.getElementById('wordInput');
  if (inp) { inp.value = ''; inp.focus(); }
});

socket.on('player-lost-life', ({ playerId, playerName, livesLeft, players }) => {
  if (currentGameRoom) currentGameRoom.players = players;
  renderGamePlayers(players, null);
  const isMe = playerId === myId;
  showFeedback(isMe ? `💥 Du mistede et liv! ${livesLeft} ❤️ tilbage` : `💥 ${escHtml(playerName)} mistede et liv!`, false);
});

socket.on('player-eliminated', ({ playerId, playerName, players }) => {
  if (currentGameRoom) currentGameRoom.players = players;
  renderGamePlayers(players, null);
  const isMe = playerId === myId;
  showFeedback(isMe ? '💀 Du er ude!' : `💀 ${escHtml(playerName)} er ude!`, false);
});

socket.on('game-over', ({ winner, players }) => {
  document.getElementById('bombDisplay').classList.remove('urgent');
  renderGameOver(winner, players);
  showScreen('screen-gameover');
});

socket.on('game-reset', ({ room }) => {
  currentGameRoom = room;
  renderLobby(room);
  showScreen('screen-lobby');
});

socket.on('connect_error', () => {
  showError('join-error', 'Kunne ikke forbinde til server. Prøv igen.');
});
