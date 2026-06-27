const socket = io();

let myId = null, isHost = false, currentRoomCode = null;
let currentPlayers = [], maxTime = 12;
let soundEnabled = true;
let chatOpen = false;
let tickTimeoutId = null, tickDelay = 1000;

// ══════ SOUND ENGINE ══════
let audioCtx = null;

function initAudio() {
  if (audioCtx) return;
  audioCtx = new (window.AudioContext || window.webkitAudioContext)();
}

function osc(freq, type, dur, vol, delay = 0) {
  if (!audioCtx || !soundEnabled) return;
  try {
    const o = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    o.connect(g); g.connect(audioCtx.destination);
    o.type = type; o.frequency.value = freq;
    const t = audioCtx.currentTime + delay;
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.start(t); o.stop(t + dur + 0.01);
  } catch(e) {}
}

function noise(dur, vol) {
  if (!audioCtx || !soundEnabled) return;
  try {
    const sz = Math.floor(audioCtx.sampleRate * dur);
    const buf = audioCtx.createBuffer(1, sz, audioCtx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < sz; i++) d[i] = (Math.random()*2-1) * Math.pow(1 - i/sz, 1.5);
    const src = audioCtx.createBufferSource();
    src.buffer = buf;
    const g = audioCtx.createGain(); g.gain.value = vol;
    const f = audioCtx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 500;
    src.connect(f); f.connect(g); g.connect(audioCtx.destination);
    src.start();
  } catch(e) {}
}

function sfxTick(t) {
  const freq = t <= 3 ? 1400 : t <= 6 ? 1100 : 850;
  const vol  = t <= 3 ? 0.28 : 0.18;
  osc(freq, 'square', 0.04, vol);
}
function sfxExplosion() { noise(0.8, 2.5); osc(55, 'sine', 0.7, 0.9); osc(80, 'sine', 0.5, 0.6, 0.06); }
function sfxSuccess()   { [[523,0],[659,.1],[784,.2],[1047,.3]].forEach(([f,d]) => osc(f,'sine',.25,.22,d)); }
function sfxFail()      { osc(300,'sawtooth',.14,.25); osc(180,'sawtooth',.14,.2,.09); }
function sfxNewTurn()   { osc(440,'sine',.08,.12); osc(550,'sine',.08,.1,.07); }
function sfxChat()      { osc(900,'sine',.09,.1); osc(1100,'sine',.07,.08,.05); }
function sfxElim()      { [[380,0],[300,.15],[220,.3],[140,.5]].forEach(([f,d]) => osc(f,'sawtooth',.18,.18,d)); }

// Ticking speeds up as time runs low
function startTicking(timeLeft) {
  stopTicking();
  const rate = timeLeft <= 2 ? 6 : timeLeft <= 4 ? 3 : timeLeft <= 7 ? 2 : 1;
  tickDelay = Math.round(1000 / rate);
  function tick() {
    sfxTick(timeLeft);
    // Speed up gradually
    tickDelay = Math.max(100, Math.round(tickDelay * 0.93));
    tickTimeoutId = setTimeout(tick, tickDelay);
  }
  tickTimeoutId = setTimeout(tick, tickDelay);
}

function stopTicking() {
  if (tickTimeoutId) { clearTimeout(tickTimeoutId); tickTimeoutId = null; }
}

function toggleSound() {
  soundEnabled = !soundEnabled;
  const btn = document.getElementById('soundBtn');
  btn.textContent = soundEnabled ? '🔊' : '🔇';
  btn.classList.toggle('muted', !soundEnabled);
}

// ══════ UTILS ══════
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
  window.scrollTo(0, 0);
}
function esc(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function initials(n) { return n.trim().charAt(0).toUpperCase(); }
function rand(arr) { return arr[Math.floor(Math.random()*arr.length)]; }

const FUN_OK   = ['🔥 Fedt ord!','💪 Godt klaret!','😎 Nice!','🎯 Spot on!','✨ Smart!','🚀 Woop!','👏 Klart!','💥 Bingo!','🥳 Ja!','⚡ Hurtig!'];
const FUN_BOOM = ['💥 BOOM!','🧨 Pang!','😬 Åh nej!','🙈 Au!','💣 Kaboom!'];

// ══════ JOIN ══════
function joinRoom() {
  initAudio();
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
document.getElementById('playerName').addEventListener('keydown', e => { if (e.key==='Enter') document.getElementById('roomCode').focus(); });
document.getElementById('roomCode').addEventListener('keydown', e => { if (e.key==='Enter') joinRoom(); });

// ══════ LOBBY ══════
function copyCode() {
  navigator.clipboard.writeText(currentRoomCode).then(() => {
    const b = document.querySelector('.copy-btn');
    if (b) { b.textContent='✅'; setTimeout(()=>b.textContent='📋',1500); }
  });
}

function renderLobby(room) {
  currentPlayers = room.players;
  document.getElementById('displayRoomCode').textContent = room.code;
  document.getElementById('gameRoomCode').textContent = room.code;
  const c = document.getElementById('lobbySeats');
  c.innerHTML = '';
  room.players.forEach((p, i) => {
    const d = document.createElement('div');
    d.className = 'lobby-seat';
    d.innerHTML = `<div class="seat-avatar c${i%8}">${initials(p.name)}</div>
      <div class="seat-lname">${esc(p.name)}</div>
      ${p.id===myId?'<div class="seat-you">← dig</div>':''}
      ${p.isHost?'<div class="seat-host">Vært 👑</div>':''}`;
    c.appendChild(d);
  });
  const btn = document.getElementById('startBtn');
  const wt  = document.getElementById('waitingMsg');
  if (isHost) { btn.style.display='block'; wt.style.display='none'; }
  else        { btn.style.display='none';  wt.style.display='block'; }
}

function startGame() { socket.emit('start-game', { roomCode: currentRoomCode }); }

// ══════ ROUND TABLE ══════
function buildSeats(players) {
  document.querySelectorAll('.player-seat').forEach(el => el.remove());
  const scene = document.getElementById('tableScene');
  players.forEach((p, i) => {
    const d = document.createElement('div');
    d.className = 'player-seat' + (p.eliminated ? ' eliminated' : '');
    d.id = 'seat-' + p.id;
    d.style.position = 'absolute';
    const hearts = p.eliminated ? '💀' : '❤️'.repeat(Math.max(0,p.lives));
    d.innerHTML = `
      <div class="your-turn-arrow" style="display:none">👇</div>
      <div class="seat-chip bc${i%8}">
        <div class="seat-ico c${i%8}">${initials(p.name)}</div>
        <div class="seat-nm">${esc(p.name)}</div>
        <div class="seat-pts">⭐ ${p.points||0}</div>
        <div class="seat-hp">${hearts}</div>
        <div class="seat-typing"></div>
      </div>`;
    scene.appendChild(d);
  });
  positionSeats(players);
}

function positionSeats(players) {
  const scene = document.getElementById('tableScene');
  const felt  = document.querySelector('.table-felt');
  if (!felt || !scene) return;
  const sr = scene.getBoundingClientRect();
  const fr = felt.getBoundingClientRect();
  const cx = fr.left - sr.left + fr.width/2;
  const cy = fr.top  - sr.top  + fr.height/2;
  const rx = fr.width/2  + 58;
  const ry = fr.height/2 + 58;
  players.forEach((p, i) => {
    const angle = (i/players.length)*2*Math.PI - Math.PI/2;
    const x = cx + rx * Math.cos(angle);
    const y = cy + ry * Math.sin(angle);
    const el = document.getElementById('seat-' + p.id);
    if (!el) return;
    el.style.left = x + 'px';
    el.style.top  = y + 'px';
    el.style.transform = 'translate(-50%,-50%)';
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
    if (hp) hp.textContent = p.eliminated ? '💀' : '❤️'.repeat(Math.max(0,p.lives));
    const pts = el.querySelector('.seat-pts');
    if (pts) pts.textContent = '⭐ ' + (p.points||0);
    const arrow = el.querySelector('.your-turn-arrow');
    if (arrow) arrow.style.display = (p.id===myId && p.id===activeId) ? 'block' : 'none';
  });
}

function showPointsPopup(playerId, pts, colorIdx) {
  const el = document.getElementById('seat-' + playerId);
  if (!el) return;
  const d = document.createElement('div');
  d.className = 'points-popup';
  d.textContent = '+' + pts + ' pt';
  el.style.position = 'relative';
  el.appendChild(d);
  setTimeout(() => d.remove(), 1400);
}

// ══════ BOMB VISUAL ══════
function updateBomb(timeLeft, max) {
  const pct = timeLeft / max;
  const bar = document.getElementById('fuseBar');
  if (bar) bar.style.width = (pct * 100) + '%';

  const num = document.getElementById('timerNum');
  if (num) {
    num.textContent = timeLeft;
    num.classList.toggle('urgent', timeLeft <= 3);
  }

  const bv = document.getElementById('bombVisual');
  if (bv) {
    bv.classList.toggle('shaking', timeLeft <= 5);
  }

  const felt = document.getElementById('tableFelt');
  if (felt) felt.classList.toggle('urgent', timeLeft <= 4);

  // Color transitions on bomb emoji
  const emoji = document.getElementById('bombEmoji');
  if (emoji && timeLeft <= 3) {
    emoji.style.filter = 'drop-shadow(0 0 12px #FF4757) brightness(1.2)';
  } else if (emoji) {
    emoji.style.filter = '';
  }
}

function triggerExplosion() {
  stopTicking();
  sfxExplosion();

  const bv = document.getElementById('bombVisual');
  const emoji = document.getElementById('bombEmoji');
  if (emoji) emoji.textContent = '💥';
  if (bv) bv.classList.add('exploding');

  const flash = document.getElementById('screenFlash');
  if (flash) { flash.classList.add('active'); setTimeout(()=>flash.classList.remove('active'),500); }

  setTimeout(() => {
    if (emoji) emoji.textContent = '💣';
    if (bv) { bv.classList.remove('exploding'); bv.classList.remove('shaking'); }
    const num = document.getElementById('timerNum');
    if (num) num.classList.remove('urgent');
    const felt = document.getElementById('tableFelt');
    if (felt) felt.classList.remove('urgent');
  }, 1600);
}

// ══════ WORD INPUT ══════
function setInputActive(active) {
  document.getElementById('wordInputWrap').style.display = active ? 'flex' : 'none';
  document.getElementById('notYourTurn').style.display   = active ? 'none' : 'block';
  if (active) { const inp = document.getElementById('wordInput'); inp.value=''; setTimeout(()=>inp.focus(),80); }
}

function submitWord() {
  const word = document.getElementById('wordInput').value.trim().toLowerCase();
  if (!word) return;
  socket.emit('submit-word', { roomCode: currentRoomCode, word });
  document.getElementById('wordInput').value = '';
}
document.getElementById('wordInput').addEventListener('keydown', e => { if (e.key==='Enter') submitWord(); });

// Live typing preview — send as user types
document.getElementById('wordInput').addEventListener('input', e => {
  socket.emit('typing-preview', { roomCode: currentRoomCode, text: e.target.value });
});

function showFeedback(msg, isOk) {
  const el = document.getElementById('feedback');
  el.textContent = msg;
  el.className = 'feedback-toast ' + (isOk?'ok':'bad');
  clearTimeout(el._t);
  el._t = setTimeout(() => { el.textContent=''; el.className='feedback-toast'; }, 2800);
}

function addHistory(word, syllable) {
  const c = document.getElementById('wordHistory');
  const s = document.createElement('span');
  s.className = 'hw';
  const rx = new RegExp('('+syllable.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+')','gi');
  s.innerHTML = word.replace(rx,'<b>$1</b>');
  c.prepend(s);
  while (c.children.length > 24) c.removeChild(c.lastChild);
}

// ══════ CHAT ══════
function toggleChat() {
  chatOpen = !chatOpen;
  document.getElementById('chatPanel').classList.toggle('open', chatOpen);
  if (chatOpen) {
    setTimeout(() => document.getElementById('chatInput').focus(), 260);
    document.getElementById('chatToggle').style.background = 'rgba(255,255,255,.2)';
  } else {
    document.getElementById('chatToggle').style.background = '';
  }
}

function sendChat() {
  const inp = document.getElementById('chatInput');
  const msg = inp.value.trim();
  if (!msg) return;
  socket.emit('chat', { roomCode: currentRoomCode, message: msg });
  inp.value = '';
}
document.getElementById('chatInput').addEventListener('keydown', e => { if (e.key==='Enter') sendChat(); });

function addChatMsg(name, message, colorClass, isSystem=false) {
  const c = document.getElementById('chatMessages');
  const d = document.createElement('div');
  d.className = 'chat-msg' + (isSystem?' system':'');
  if (isSystem) { d.textContent = message; }
  else { d.innerHTML = `<span class="cn ${colorClass}">${esc(name)}:</span><span class="ct"> ${esc(message)}</span>`; }
  c.appendChild(d);
  c.scrollTop = c.scrollHeight;
  while (c.children.length > 60) c.removeChild(c.firstChild);
  if (!chatOpen && !isSystem) sfxChat();
}

// ══════ CONFETTI ══════
function confetti() {
  const layer = document.getElementById('confettiLayer');
  const colors = ['#FFD700','#FF4757','#2ED573','#1E90FF','#FFA502','#A29BFE','#FF6B81'];
  for (let i=0;i<44;i++) {
    const el = document.createElement('div');
    el.className = 'cf';
    el.style.left = Math.random()*100 + 'vw';
    el.style.backgroundColor = rand(colors);
    el.style.width  = (7+Math.random()*8)+'px';
    el.style.height = (7+Math.random()*8)+'px';
    el.style.borderRadius = Math.random()>.5?'50%':'2px';
    el.style.setProperty('--dur',(0.7+Math.random()*.7)+'s');
    el.style.setProperty('--dx',(Math.random()*130-65)+'px');
    el.style.animationDelay = Math.random()*.35+'s';
    layer.appendChild(el);
    setTimeout(()=>el.remove(),2200);
  }
}

// ══════ GAME OVER ══════
function renderGameOver(winner, players) {
  const wb = document.getElementById('winnerBox');
  if (winner) {
    wb.innerHTML = `<span class="trophy-big">🏆</span><h3>Vinderen er</h3>
      <div class="winner-name">${esc(winner.name)}</div>
      <div class="winner-pts">${winner.points} point ⭐</div>`;
    if (winner.id===myId) confetti();
  } else {
    wb.innerHTML = '<div class="no-winner">Ingen vinder! 😬</div>';
  }
  const fl = document.getElementById('finalList');
  fl.innerHTML = '';
  [...players].sort((a,b)=>b.points-a.points).forEach((p,i) => {
    const d = document.createElement('div');
    d.className = 'final-row'+(winner&&p.id===winner.id?' winner-row':'');
    const medal = ['🥇','🥈','🥉'][i]||(i+1+'. ');
    d.innerHTML = `<span class="final-rank">${medal}</span>
      <span class="final-name">${esc(p.name)}</span>
      <span class="final-pts">${p.points||0} pt</span>
      <span class="final-hp">${p.eliminated?'💀':'❤️'.repeat(Math.max(0,p.lives))}</span>`;
    fl.appendChild(d);
  });
  const btn=document.getElementById('playAgainBtn'); const wa=document.getElementById('waitAgain');
  if (isHost){btn.style.display='inline-block';wa.textContent='';}
  else{btn.style.display='none';wa.textContent='Venter på at vært starter igen...';}
}

function playAgain() { socket.emit('play-again', { roomCode: currentRoomCode }); }

// ══════ RESIZE ══════
window.addEventListener('resize', () => {
  if (currentPlayers.length && document.getElementById('screen-game').classList.contains('active'))
    positionSeats(currentPlayers);
});

// Find player color index
function playerColorIdx(playerId) {
  return currentPlayers.findIndex(p => p.id === playerId) % 8;
}

// ══════ SOCKET EVENTS ══════
socket.on('room-joined', ({ room, yourId, isHost: h }) => {
  myId=yourId; isHost=h; currentRoomCode=room.code;
  renderLobby(room); showScreen('screen-lobby');
});
socket.on('player-joined', ({ room }) => { renderLobby(room); addChatMsg('','Ny spiller joinede!','',$true); });
socket.on('player-left',   ({ players, playerName }) => {
  if (document.getElementById('screen-lobby').classList.contains('active'))
    renderLobby({ code: currentRoomCode, players });
  addChatMsg('', playerName+' forlod spillet.', '', true);
});
socket.on('new-host', ({ hostId }) => {
  if (hostId===myId) { isHost=true; document.getElementById('startBtn').style.display='block'; document.getElementById('waitingMsg').style.display='none'; }
});
socket.on('error-msg', ({ message }) => { showErr(message); showFeedback(message, false); });

socket.on('game-started', ({ players }) => {
  currentPlayers = players;
  stopTicking();
  document.getElementById('wordHistory').innerHTML='';
  document.getElementById('chatMessages').innerHTML='';
  showScreen('screen-game');
  requestAnimationFrame(()=>requestAnimationFrame(()=>{
    buildSeats(players);
    document.getElementById('sylText').textContent='—';
    document.getElementById('currentLabel').textContent='🎲 Spillet starter...';
    setInputActive(false);
    updateBomb(12,12);
  }));
  addChatMsg('','Spillet er startet! God fornøjelse 💣','',true);
});

socket.on('new-turn', ({ currentPlayerId, currentPlayerName, syllable, timeLeft, players, keptSyllable }) => {
  currentPlayers = players;
  maxTime = timeLeft;
  stopTicking();

  updateSeats(players, currentPlayerId);
  setInputActive(currentPlayerId===myId);
  updateBomb(timeLeft, maxTime);
  sfxNewTurn();
  startTicking(timeLeft);

  const lbl = currentPlayerId===myId ? '🎯 DIN TUR!' : `🎮 ${esc(currentPlayerName)}s tur`;
  document.getElementById('currentLabel').textContent = lbl;

  const st = document.getElementById('sylText');
  st.style.animation = 'none';
  requestAnimationFrame(()=>{
    st.style.animation = '';
    st.textContent = syllable.toUpperCase();
    st.className = 'syl-big' + (keptSyllable ? ' same-syllable' : '');
  });

  if (keptSyllable) {
    showFeedback('⚠️ Samme stavelse — næste spiller prøver!', false);
    addChatMsg('', `Samme stavelse "${syllable.toUpperCase()}" videre til ${esc(currentPlayerName)}!`, '', true);
  }

  document.getElementById('feedback').textContent = '';

  // Clear all typing previews
  document.querySelectorAll('.seat-typing').forEach(el => el.textContent='');
});

socket.on('timer-tick', ({ timeLeft }) => {
  updateBomb(timeLeft, maxTime);
});

socket.on('word-accepted', ({ playerId, playerName, word, syllable, pointsEarned, players }) => {
  stopTicking();
  updateSeats(players, null);
  addHistory(word, syllable);
  confetti();
  sfxSuccess();
  showFeedback(rand(FUN_OK) + ` +${pointsEarned}pt ⭐`, true);
  showPointsPopup(playerId, pointsEarned, playerColorIdx(playerId));
  const isMe = playerId===myId;
  addChatMsg('', `${esc(playerName)} brugte "${word}" ${isMe?'🎯':''} +${pointsEarned}pt`, `tc${playerColorIdx(playerId)}`, true);
  document.querySelectorAll('.seat-typing').forEach(el=>el.textContent='');
});

socket.on('word-rejected', ({ message }) => {
  sfxFail();
  showFeedback('❌ ' + message, false);
  const inp = document.getElementById('wordInput');
  if (inp) { inp.value=''; inp.focus(); }
});

socket.on('player-typing', ({ playerId, text }) => {
  const el = document.getElementById('seat-'+playerId);
  const preview = el?.querySelector('.seat-typing');
  if (preview) preview.textContent = text ? '✏️ '+text+'...' : '';
});

socket.on('bomb-exploded', ({ playerId }) => {
  triggerExplosion();
});

socket.on('player-lost-life', ({ playerId, playerName, livesLeft, players }) => {
  updateSeats(players, null);
  sfxElim(); // dramatic but not full elim
  const isMe = playerId===myId;
  const msg = isMe ? `${rand(FUN_BOOM)} Du har ${livesLeft} ❤️ tilbage!` : `${rand(FUN_BOOM)} ${esc(playerName)} mister et liv!`;
  showFeedback(msg, false);
  addChatMsg('', `${esc(playerName)} mistede et liv! ${livesLeft} ❤️ tilbage`, '', true);
});

socket.on('player-eliminated', ({ playerId, playerName, players }) => {
  updateSeats(players, null);
  sfxElim();
  const isMe = playerId===myId;
  showFeedback(isMe ? '💀 Du er ude! Men dine point tæller!' : `💀 ${esc(playerName)} er ude!`, false);
  addChatMsg('', `💀 ${esc(playerName)} er ude af spillet!`, '', true);
});

socket.on('chat-message', ({ playerId, name, message }) => {
  const ci = playerColorIdx(playerId);
  addChatMsg(name, message, `tc${ci}`, false);
});

socket.on('game-over', ({ winner, players }) => {
  stopTicking();
  const felt=document.getElementById('tableFelt'); if(felt)felt.classList.remove('urgent');
  const bv=document.getElementById('bombVisual'); if(bv){bv.classList.remove('shaking');bv.classList.remove('exploding');}
  renderGameOver(winner, players);
  showScreen('screen-gameover');
});

socket.on('game-reset', ({ room }) => {
  stopTicking();
  renderLobby(room);
  showScreen('screen-lobby');
});
