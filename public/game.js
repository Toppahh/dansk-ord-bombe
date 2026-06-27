const socket = io();

let myId = null, isHost = false, currentRoomCode = null;
let currentPlayers = [], maxTime = 12;
let soundEnabled = true, chatOpen = false;
let tickTimeoutId = null, tickDelay = 1000;
let currentActivePlayerId = null, currentSyllable = '', currentMode = 'normal';

// ══════ SOUND ENGINE ══════
let audioCtx = null;
function initAudio() {
  if (audioCtx) return;
  try { audioCtx = new (window.AudioContext || window.webkitAudioContext)(); } catch(e) {}
}
function osc(freq, type, dur, vol, delay = 0) {
  if (!audioCtx || !soundEnabled) return;
  try {
    const o = audioCtx.createOscillator(), g = audioCtx.createGain();
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
    const f = audioCtx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 450;
    src.connect(f); f.connect(g); g.connect(audioCtx.destination);
    src.start();
  } catch(e) {}
}

const KEY_FREQS = [180,195,210,225,240,260,280,300,320,340,360,380];
function sfxKey() {
  const f = KEY_FREQS[Math.floor(Math.random()*KEY_FREQS.length)];
  osc(f, 'square', 0.038, 0.055);
  osc(f*1.5, 'square', 0.025, 0.02);
}
function sfxKeyDelete() { osc(120, 'sawtooth', 0.04, 0.045); }
function sfxTick(t) {
  const freq = t <= 3 ? 1500 : t <= 5 ? 1200 : 900;
  const vol  = t <= 3 ? 0.3  : 0.18;
  osc(freq, 'square', 0.04, vol);
}
function sfxExplosion() { noise(0.85, 2.8); osc(50, 'sine', 0.8, 1); osc(80, 'sine', 0.5, 0.7, 0.07); }
function sfxSuccess() { [[523,0],[659,.1],[784,.2],[1047,.32]].forEach(([f,d])=>osc(f,'sine',.26,.22,d)); }
function sfxFail() { osc(280,'sawtooth',.13,.25); osc(170,'sawtooth',.13,.2,.09); }
function sfxNewTurn() { osc(440,'sine',.07,.12); osc(550,'sine',.07,.1,.06); }
function sfxChat() { osc(900,'sine',.08,.09); osc(1100,'sine',.06,.07,.05); }
function sfxElim() { [[370,0],[290,.14],[210,.3],[130,.5]].forEach(([f,d])=>osc(f,'sawtooth',.18,.18,d)); }

function startTicking(timeLeft) {
  stopTicking();
  const baseDelay = timeLeft <= 2 ? 140 : timeLeft <= 4 ? 260 : timeLeft <= 7 ? 450 : 900;
  tickDelay = baseDelay;
  function tick() {
    sfxTick(timeLeft);
    tickDelay = Math.max(90, tickDelay * 0.91);
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
function escRx(s) { return s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'); }

const FUN_OK   = ['🔥 Fedt ord!','💪 Godt klaret!','😎 Nice!','🎯 Spot on!','✨ Smart!','🚀 Woop!','👏 Klart!','💥 Bingo!','🥳 Ja!','⚡ Hurtig!'];
const FUN_BOOM = ['💥 BOOM!','🧨 Pang!','😬 Åh nej!','🙈 Au!','💣 Kaboom!'];

const MODE_INFO = {
  normal:  { desc: 'Skriv et dansk ord der indeholder stavelsen',              badge: '💣 Normal'  },
  names:   { desc: 'Skriv et dansk navn (fornavn/bynavn) der starter med bogstavet', badge: '📛 Navne'   },
  letters: { desc: 'Skriv et dansk ord der indeholder BEGGE bogstaver (i vilkårlig rækkefølge)', badge: '🔤 2 Bog.' },
};

// ══════ MODE SELECTOR ══════
function setMode(mode) {
  if (!isHost) return;
  socket.emit('set-mode', { roomCode: currentRoomCode, mode });
}
function applyMode(mode) {
  currentMode = mode;
  document.querySelectorAll('.mode-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.mode === mode);
  });
  const desc = document.getElementById('modeDesc');
  if (desc) desc.textContent = MODE_INFO[mode]?.desc || '';
  const badge = document.getElementById('modeBadge');
  if (badge) badge.textContent = MODE_INFO[mode]?.badge || '';
}
function setModeBtnsEnabled(enabled) {
  document.querySelectorAll('.mode-btn').forEach(b => b.disabled = !enabled);
}

// ══════ CENTER DISPLAY ══════
function sylDisplay(syllable, mode, extraClass) {
  const display = document.getElementById('sylText');
  const hint    = document.getElementById('sylHint');
  if (hint) {
    if (mode === 'names')   hint.textContent = 'Skriv et navn der starter med:';
    else if (mode==='letters') hint.textContent = 'Brug begge bogstaver:';
    else                    hint.textContent = 'Skriv et ord med:';
  }
  if (mode === 'letters') {
    const parts = syllable.split('+');
    const l1 = (parts[0]||'?').toUpperCase();
    const l2 = (parts[1]||'?').toUpperCase();
    display.innerHTML = `<span class="letter-chips"><span class="letter-chip">${l1}</span><span class="plus-sep">+</span><span class="letter-chip">${l2}</span></span>`;
  } else {
    display.innerHTML = '';
    display.textContent = syllable.toUpperCase ? syllable.toUpperCase() : syllable;
  }
  display.className = 'syl-big' + (extraClass ? ' '+extraClass : '');
}

function updateCenterDisplay(text, syllable, mode) {
  const display = document.getElementById('sylText');
  const hint    = document.getElementById('sylHint');
  if (!text) { sylDisplay(syllable, mode); return; }
  const lower = text.toLowerCase();

  if (mode === 'letters') {
    const parts = syllable.split('+');
    const l1 = parts[0], l2 = parts[1];
    const hasL1 = lower.includes(l1), hasL2 = lower.includes(l2);
    if (hint) hint.textContent = (hasL1 && hasL2) ? '✓ Begge bogstaver!' : 'Skriver:';
    let html = '';
    for (const ch of lower) {
      if (ch === l1 || ch === l2) html += `<span class="syl-match">${ch}</span>`;
      else html += ch;
    }
    display.innerHTML = html + '<span class="type-cursor">|</span>';
    display.className = 'syl-big typing-mode';

  } else if (mode === 'names') {
    const startLetter = syllable.toLowerCase();
    if (hint) hint.textContent = lower.startsWith(startLetter) ? '✓ Godt start!' : 'Skriver:';
    const first = lower[0] || '';
    display.innerHTML = `<span class="syl-match">${first}</span>${lower.slice(1)}<span class="type-cursor">|</span>`;
    display.className = 'syl-big typing-mode';

  } else {
    const syl = syllable.toLowerCase();
    if (hint) hint.textContent = lower.includes(syl) ? '✓ Godt!' : 'Skriver:';
    const highlighted = lower.replace(new RegExp('('+escRx(syl)+')', 'g'), '<span class="syl-match">$1</span>');
    display.innerHTML = highlighted + '<span class="type-cursor">|</span>';
    display.className = 'syl-big typing-mode';
  }
}

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
  el.textContent = msg; clearTimeout(el._t);
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
  const c = document.getElementById('lobbySeats'); c.innerHTML = '';
  room.players.forEach((p, i) => {
    const d = document.createElement('div'); d.className = 'lobby-seat';
    d.innerHTML = `<div class="seat-avatar c${i%8}">${initials(p.name)}</div>
      <div class="seat-lname">${esc(p.name)}</div>
      ${p.id===myId?'<div class="seat-you">← dig</div>':''}
      ${p.isHost?'<div class="seat-host">Vært 👑</div>':''}`;
    c.appendChild(d);
  });
  const btn=document.getElementById('startBtn'), wt=document.getElementById('waitingMsg');
  if (isHost) { btn.style.display='block'; wt.style.display='none'; }
  else        { btn.style.display='none';  wt.style.display='block'; }
  setModeBtnsEnabled(isHost);
  applyMode(room.mode || currentMode || 'normal');
}
function startGame() { socket.emit('start-game', { roomCode: currentRoomCode }); }

// ══════ ROUND TABLE ══════
function buildSeats(players) {
  document.querySelectorAll('.player-seat').forEach(el => el.remove());
  const scene = document.getElementById('tableScene');
  players.forEach((p, i) => {
    const d = document.createElement('div');
    d.className = 'player-seat' + (p.eliminated ? ' eliminated' : '');
    d.id = 'seat-' + p.id; d.style.position = 'absolute';
    const hearts = p.eliminated ? '💀' : '❤️'.repeat(Math.max(0, p.lives));
    d.innerHTML = `
      <div class="your-turn-arrow" style="display:none">👇</div>
      <div class="seat-chip bc${i%8}">
        <div class="seat-ico c${i%8}">${initials(p.name)}</div>
        <div class="seat-nm">${esc(p.name)}</div>
        <div class="seat-pts">⭐ ${p.points||0}</div>
        <div class="seat-hp">${hearts}</div>
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
  const rx = fr.width/2  + 62;
  const ry = fr.height/2 + 56;
  players.forEach((p, i) => {
    const angle = (i/players.length)*2*Math.PI - Math.PI/2;
    const x = cx + rx * Math.cos(angle);
    const y = cy + ry * Math.sin(angle);
    const el = document.getElementById('seat-' + p.id);
    if (!el) return;
    el.style.left = x + 'px'; el.style.top = y + 'px';
    el.style.transform = 'translate(-50%,-50%)';
  });
}
function updateSeats(players, activeId) {
  currentPlayers = players;
  players.forEach(p => {
    const el = document.getElementById('seat-' + p.id);
    if (!el) return;
    el.classList.toggle('active', p.id === activeId);
    el.classList.toggle('eliminated', !!p.eliminated);
    const hp  = el.querySelector('.seat-hp');
    const pts = el.querySelector('.seat-pts');
    if (hp)  hp.textContent  = p.eliminated ? '💀' : '❤️'.repeat(Math.max(0, p.lives));
    if (pts) pts.textContent = '⭐ ' + (p.points||0);
    const arrow = el.querySelector('.your-turn-arrow');
    if (arrow) arrow.style.display = (p.id===myId && p.id===activeId) ? 'block' : 'none';
  });
}
function showPointsPopup(playerId, pts) {
  const el = document.getElementById('seat-'+playerId);
  if (!el) return;
  const d = document.createElement('div'); d.className = 'points-popup';
  d.textContent = '+'+pts+'pt'; el.style.position='relative'; el.appendChild(d);
  setTimeout(()=>d.remove(), 1400);
}
function playerColorIdx(id) { return currentPlayers.findIndex(p=>p.id===id)%8; }

// ══════ BOMB ══════
function updateBomb(t, max) {
  const pct = t/max;
  const bar = document.getElementById('fuseBar');
  if (bar) bar.style.width = (pct*100)+'%';
  const num = document.getElementById('timerNum');
  if (num) { num.textContent = t; num.classList.toggle('urgent', t<=3); }
  const bv = document.getElementById('bombVisual');
  if (bv) bv.classList.toggle('shaking', t<=5);
  const felt = document.getElementById('tableFelt');
  if (felt) felt.classList.toggle('urgent', t<=4);
  const emoji = document.getElementById('bombEmoji');
  if (emoji) emoji.style.filter = t<=3 ? 'drop-shadow(0 0 14px #FF4757) brightness(1.3)' : '';
}
function triggerExplosion() {
  stopTicking();
  sfxExplosion();
  const bv=document.getElementById('bombVisual'), emoji=document.getElementById('bombEmoji');
  if (emoji) emoji.textContent='💥';
  if (bv) bv.classList.add('exploding');
  const flash=document.getElementById('screenFlash');
  if (flash) { flash.classList.add('active'); setTimeout(()=>flash.classList.remove('active'),500); }
  setTimeout(()=>{
    if (emoji) emoji.textContent='💣';
    if (bv) { bv.classList.remove('exploding'); bv.classList.remove('shaking'); }
    const num=document.getElementById('timerNum');
    if (num) num.classList.remove('urgent');
    const felt=document.getElementById('tableFelt');
    if (felt) felt.classList.remove('urgent');
  }, 1700);
}

// ══════ WORD INPUT ══════
let lastInputLen = 0;
function setInputActive(active) {
  document.getElementById('wordInputWrap').style.display = active ? 'flex' : 'none';
  document.getElementById('notYourTurn').style.display   = active ? 'none' : 'block';
  if (active) {
    const inp=document.getElementById('wordInput');
    inp.value=''; lastInputLen=0;
    inp.placeholder = currentMode==='names' ? 'Skriv et dansk navn...' : 'Skriv et dansk ord...';
    setTimeout(()=>inp.focus(),80);
  }
}
function submitWord() {
  const word = document.getElementById('wordInput').value.trim().toLowerCase();
  if (!word) return;
  socket.emit('submit-word', { roomCode: currentRoomCode, word });
  document.getElementById('wordInput').value = '';
  updateCenterDisplay('', currentSyllable, currentMode);
}
document.getElementById('wordInput').addEventListener('keydown', e => { if (e.key==='Enter') submitWord(); });
document.getElementById('wordInput').addEventListener('input', e => {
  const text = e.target.value;
  const len = text.length;
  if (len > lastInputLen) sfxKey();
  else if (len < lastInputLen) sfxKeyDelete();
  lastInputLen = len;
  updateCenterDisplay(text, currentSyllable, currentMode);
  socket.emit('typing-preview', { roomCode: currentRoomCode, text });
});

function showFeedback(msg, isOk) {
  const el = document.getElementById('feedback');
  el.textContent = msg; el.className = 'feedback-toast '+(isOk?'ok':'bad');
  clearTimeout(el._t);
  el._t = setTimeout(()=>{el.textContent='';el.className='feedback-toast';}, 2800);
}
function addHistory(word, syllable, mode) {
  const c = document.getElementById('wordHistory');
  const s = document.createElement('span'); s.className='hw';
  if (mode === 'letters') {
    const parts = syllable.split('+');
    const l1 = parts[0], l2 = parts[1];
    const rx = new RegExp(`(${escRx(l1)}|${escRx(l2)})`,'gi');
    s.innerHTML = word.replace(rx,'<b>$1</b>');
  } else if (mode === 'names') {
    s.innerHTML = `<b>${word[0]||''}</b>${word.slice(1)}`;
  } else {
    const rx = new RegExp('('+escRx(syllable)+')','gi');
    s.innerHTML = word.replace(rx,'<b>$1</b>');
  }
  c.prepend(s);
  while (c.children.length > 22) c.removeChild(c.lastChild);
}

// ══════ CHAT ══════
function toggleChat() {
  chatOpen = !chatOpen;
  document.getElementById('chatPanel').classList.toggle('open', chatOpen);
  const btn = document.getElementById('chatToggle');
  btn.style.background = chatOpen ? 'rgba(255,255,255,.2)' : '';
  if (chatOpen) setTimeout(()=>document.getElementById('chatInput').focus(), 240);
}
function sendChat() {
  const inp = document.getElementById('chatInput');
  const msg = inp.value.trim();
  if (!msg) return;
  socket.emit('chat', { roomCode: currentRoomCode, message: msg });
  inp.value='';
}
document.getElementById('chatInput').addEventListener('keydown', e=>{ if (e.key==='Enter') sendChat(); });
function addChatMsg(name, message, colorClass, isSystem=false) {
  const c = document.getElementById('chatMessages');
  const d = document.createElement('div'); d.className='chat-msg'+(isSystem?' system':'');
  if (isSystem) d.textContent = message;
  else d.innerHTML = `<span class="cn ${colorClass}">${esc(name)}:</span><span class="ct"> ${esc(message)}</span>`;
  c.appendChild(d); c.scrollTop = c.scrollHeight;
  while (c.children.length > 60) c.removeChild(c.firstChild);
  if (!chatOpen && !isSystem) sfxChat();
}

// ══════ CONFETTI ══════
function confetti() {
  const layer = document.getElementById('confettiLayer');
  const colors = ['#FFD700','#FF4757','#2ED573','#4fa3ff','#FFA502','#b39dff','#FF6B81'];
  for (let i=0;i<44;i++) {
    const el = document.createElement('div'); el.className='cf';
    el.style.left = Math.random()*100+'vw';
    el.style.backgroundColor = rand(colors);
    el.style.width  = (7+Math.random()*8)+'px';
    el.style.height = (7+Math.random()*8)+'px';
    el.style.borderRadius = Math.random()>.5?'50%':'2px';
    el.style.setProperty('--dur',(0.7+Math.random()*.7)+'s');
    el.style.setProperty('--dx',(Math.random()*130-65)+'px');
    el.style.animationDelay = Math.random()*.35+'s';
    layer.appendChild(el);
    setTimeout(()=>el.remove(), 2200);
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
  } else { wb.innerHTML='<div class="no-winner">Ingen vinder! 😬</div>'; }
  const fl = document.getElementById('finalList'); fl.innerHTML='';
  [...players].sort((a,b)=>b.points-a.points).forEach((p,i)=>{
    const d=document.createElement('div');
    d.className='final-row'+(winner&&p.id===winner.id?' winner-row':'');
    const medal=['🥇','🥈','🥉'][i]||(i+1+'. ');
    d.innerHTML=`<span class="final-rank">${medal}</span>
      <span class="final-name">${esc(p.name)}</span>
      <span class="final-pts">${p.points||0} pt</span>
      <span class="final-hp">${p.eliminated?'💀':'❤️'.repeat(Math.max(0,p.lives))}</span>`;
    fl.appendChild(d);
  });
  const btn=document.getElementById('playAgainBtn'), wa=document.getElementById('waitAgain');
  if (isHost){btn.style.display='inline-block';wa.textContent='';}
  else{btn.style.display='none';wa.textContent='Venter på at vært starter igen...';}
}
function playAgain() { socket.emit('play-again', { roomCode: currentRoomCode }); }
window.addEventListener('resize', ()=>{
  if (currentPlayers.length && document.getElementById('screen-game').classList.contains('active'))
    positionSeats(currentPlayers);
});

// ══════ SOCKET EVENTS ══════
socket.on('room-joined', ({ room, yourId, isHost: h }) => {
  myId=yourId; isHost=h; currentRoomCode=room.code;
  renderLobby(room); showScreen('screen-lobby');
});
socket.on('player-joined', ({ room }) => { renderLobby(room); });
socket.on('player-left',   ({ players, playerName }) => {
  if (document.getElementById('screen-lobby').classList.contains('active'))
    renderLobby({ code: currentRoomCode, players, mode: currentMode });
  addChatMsg('',playerName+' forlod spillet.','',true);
});
socket.on('new-host', ({ hostId }) => {
  if (hostId===myId) {
    isHost=true;
    document.getElementById('startBtn').style.display='block';
    document.getElementById('waitingMsg').style.display='none';
    setModeBtnsEnabled(true);
  }
});
socket.on('mode-changed', ({ mode }) => { applyMode(mode); });
socket.on('error-msg', ({ message }) => { showErr(message); showFeedback(message,false); });

socket.on('game-started', ({ players, mode }) => {
  currentPlayers=players; currentMode=mode||'normal'; stopTicking();
  applyMode(currentMode);
  document.getElementById('wordHistory').innerHTML='';
  document.getElementById('chatMessages').innerHTML='';
  showScreen('screen-game');
  requestAnimationFrame(()=>requestAnimationFrame(()=>{
    buildSeats(players);
    currentSyllable='—'; sylDisplay('—', currentMode);
    document.getElementById('currentLabel').textContent='🎲 Starter...';
    setInputActive(false); updateBomb(12,12);
  }));
  addChatMsg('','Spillet er startet! God fornøjelse 💣','',true);
});

socket.on('new-turn', ({ currentPlayerId, currentPlayerName, syllable, timeLeft, maxTime: mt, players, keptSyllable, round, mode }) => {
  currentPlayers=players; currentActivePlayerId=currentPlayerId; currentSyllable=syllable;
  if (mode) currentMode = mode;
  maxTime = mt || timeLeft;
  stopTicking();
  updateSeats(players, currentPlayerId);
  setInputActive(currentPlayerId===myId);
  updateBomb(timeLeft, maxTime);
  sfxNewTurn();
  startTicking(timeLeft);

  const lbl = currentPlayerId===myId ? '🎯 DIN TUR!' : `🎮 ${esc(currentPlayerName)}s tur`;
  document.getElementById('currentLabel').textContent = lbl;

  sylDisplay(syllable, currentMode, keptSyllable ? 'same-syl' : '');

  const speedTag = document.getElementById('speedTag');
  if (speedTag) {
    const rounds = round || 0;
    speedTag.textContent = rounds >= 5 ? `⚡×${Math.floor(rounds/5)}` : '';
  }

  if (keptSyllable) {
    const label = currentMode==='letters' ? syllable.replace('+',' + ').toUpperCase() : syllable.toUpperCase();
    showFeedback(`⚠️ Samme udfordring videre til ${esc(currentPlayerName)}!`, false);
    addChatMsg('',`Ingen klaret "${label}" — videre til ${esc(currentPlayerName)}!`,'',true);
  }
  document.getElementById('feedback').textContent='';
});

socket.on('timer-tick', ({ timeLeft }) => updateBomb(timeLeft, maxTime));

socket.on('word-accepted', ({ playerId, playerName, word, syllable, pointsEarned, players, mode }) => {
  stopTicking();
  const m = mode || currentMode;
  updateSeats(players,null);
  addHistory(word, syllable, m);
  confetti(); sfxSuccess();
  showFeedback(rand(FUN_OK)+` +${pointsEarned}pt ⭐`, true);
  showPointsPopup(playerId, pointsEarned);
  const isMe = playerId===myId;
  addChatMsg('',`${esc(playerName)} → "${word}" ${isMe?'🎯':''} +${pointsEarned}pt`,`tc${playerColorIdx(playerId)}`,true);
  sylDisplay(syllable, currentMode);
});

socket.on('word-rejected', ({ message }) => {
  sfxFail(); showFeedback('❌ '+message, false);
  const inp=document.getElementById('wordInput');
  if (inp) { inp.value=''; inp.focus(); updateCenterDisplay('',currentSyllable,currentMode); }
});

socket.on('player-typing', ({ playerId, text }) => {
  if (playerId === currentActivePlayerId && playerId !== myId) {
    updateCenterDisplay(text, currentSyllable, currentMode);
  }
});

socket.on('bomb-exploded', () => triggerExplosion());

socket.on('player-lost-life', ({ playerId, playerName, livesLeft, players }) => {
  updateSeats(players,null);
  const isMe = playerId===myId;
  showFeedback(isMe?`${rand(FUN_BOOM)} Du har ${livesLeft} ❤️ tilbage!`:`${rand(FUN_BOOM)} ${esc(playerName)} mister et liv!`, false);
  addChatMsg('',`${esc(playerName)} mistede et liv! ${livesLeft} ❤️ tilbage`,'',true);
});

socket.on('player-eliminated', ({ playerId, playerName, players }) => {
  updateSeats(players,null); sfxElim();
  const isMe = playerId===myId;
  showFeedback(isMe?'💀 Du er ude! Dine point tæller!':'💀 '+esc(playerName)+' er ude!', false);
  addChatMsg('','💀 '+esc(playerName)+' er ude!','',true);
});

socket.on('chat-message', ({ playerId, name, message }) => {
  addChatMsg(name, message, `tc${playerColorIdx(playerId)}`, false);
});

socket.on('game-over', ({ winner, players }) => {
  stopTicking();
  document.getElementById('tableFelt')?.classList.remove('urgent');
  const bv=document.getElementById('bombVisual');
  if (bv){bv.classList.remove('shaking');bv.classList.remove('exploding');}
  renderGameOver(winner,players); showScreen('screen-gameover');
});

socket.on('game-reset', ({ room }) => {
  stopTicking();
  isHost = room.players.find(p=>p.id===myId)?.isHost || isHost;
  renderLobby(room); showScreen('screen-lobby');
});
