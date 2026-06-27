const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const danishWords = require('./words/danish-words');
const danishNames = require('./words/danish-names');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });
app.use(express.static(path.join(__dirname, 'public')));

const ENGLISH_ONLY = new Set([
  'the','this','that','with','from','have','been','will','would','could','should',
  'their','there','these','those','them','then','than','about','into','over',
  'some','when','what','which','were','while','also','each','only','just',
  'both','very','much','well','even','back','same','such','give','most',
  'come','know','because','before','after','being','doing','having','going',
  'coming','said','make','take','look','want','need','think','feel','call',
  'keep','start','show','hear','play','run','move','live','believe','hold',
  'bring','happen','write','stand','let','mean','set','put','seem','end',
  'ask','turn','leave','try','tell','find','use','work','seem','look',
  'can','your','our','has','not','you','are','was','for','but','all','one',
  'his','her','its','out','had','him','how','who','did','get','see','way',
  'say','she','may','new','old','up','no','in','of','do','go','me','my',
  'if','he','we','it','at','as','be','by','an','or','so','to','us','on',
  'per','low','hot','big','bit','buy','cut','eat','fit','fix','fun','got',
  'hit','hop','lot','map','mix','pop','put','raw','red','rid','rip','rob',
  'rod','rot','rub','rug','run','sat','set','sew','ski','sky','sly','sow',
  'spa','spy','tax','tip','ton','top','toy','tug','use','van','via','vow',
  'wax','web','wed','wet','win','wow','yep','yes','yet','zoo'
]);

const wordSet = new Set(
  danishWords.map(w => w.toLowerCase().trim()).filter(w => w.length >= 2 && !ENGLISH_ONLY.has(w))
);
const nameSet = new Set(danishNames.map(w => w.toLowerCase().trim()));
const wordArray = [...wordSet].sort((a, b) => b.length - a.length);
const nameArray = [...nameSet].sort((a, b) => b.length - a.length);

// Normal mode syllables
const EASY   = ['er','en','de','re','te','ne','et','an','ge','le','or','el','se','ke','ar','ve','ig','be','me','he','at','il','am','om','ed','nd','ng','sk'];
const MEDIUM = ['st','ud','ag','tr','ind','sp','kr','ul','ner','ler','br','dr','pr','ser','rd','eg','od'];
const HARD   = ['bl','kl','fl','pl','gr','fr','ent','ord','und'];

// Letters for names mode (letters with many Danish names starting with them)
const NAME_LETTERS = ['A','B','C','D','E','F','G','H','I','J','K','L','M','N','O','P','R','S','T','U','V','W','Y','Æ','Ø','Å'];
// Weighted common Danish letters for 2-letters mode
const COMMON_LETTERS = 'aaaabbcdddeeeeeeffgghhiiijkklllmmnnnooopprrrsssstttuuuvæøå'.split('');

const rooms = {};

// Cache ordnet.dk lookups to avoid repeated HTTP requests
const ordnetCache = new Map();

async function checkWordInOrdnet(word) {
  if (ordnetCache.has(word)) return ordnetCache.get(word);
  try {
    const res = await fetch(
      `https://ordnet.dk/ddo/ordbog?query=${encodeURIComponent(word)}`,
      {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; OrdBombe/1.0)' },
        signal: AbortSignal.timeout(6000),
      }
    );
    const html = await res.text();
    const found = res.ok && !html.toLowerCase().includes('gav ikke resultat');
    ordnetCache.set(word, found);
    if (ordnetCache.size > 3000) ordnetCache.delete(ordnetCache.keys().next().value);
    return found;
  } catch {
    return wordSet.has(word);
  }
}

function randomChallenge(mode) {
  if (mode === 'names') {
    return NAME_LETTERS[Math.floor(Math.random() * NAME_LETTERS.length)];
  }
  if (mode === 'letters') {
    const l1 = COMMON_LETTERS[Math.floor(Math.random() * COMMON_LETTERS.length)];
    let l2;
    do { l2 = COMMON_LETTERS[Math.floor(Math.random() * COMMON_LETTERS.length)]; } while (l2 === l1);
    return l1 + '+' + l2;
  }
  const r = Math.random();
  const pool = r < 0.65 ? EASY : r < 0.90 ? MEDIUM : HARD;
  return pool[Math.floor(Math.random() * pool.length)];
}

function activePlayers(room) {
  return room.players.filter(p => !p.eliminated);
}

function endGame(roomCode) {
  const room = rooms[roomCode];
  if (!room) return;
  clearInterval(room.timer);
  room.state = 'game-over';
  const alive = activePlayers(room);
  let winner;
  if (alive.length >= 1) {
    // Last survivor wins — if somehow multiple survive, highest points among alive
    winner = [...alive].sort((a, b) => b.points - a.points)[0];
  } else {
    // Everyone eliminated — highest points overall
    winner = [...room.players].sort((a, b) => b.points - a.points)[0];
  }
  io.to(roomCode).emit('game-over', {
    winner: { id: winner.id, name: winner.name, points: winner.points },
    players: room.players,
  });
}

function nextTurn(roomCode, keepSyllable = false) {
  const room = rooms[roomCode];
  if (!room || room.state !== 'playing') return;
  clearInterval(room.timer);

  const alive = activePlayers(room);
  if (alive.length <= 1) { endGame(roomCode); return; }

  room.currentPlayerIndex = (room.currentPlayerIndex + 1) % alive.length;

  if (!keepSyllable) {
    room.currentSyllable = randomChallenge(room.mode || 'normal');
    room.syllableFailCount = 0;
    room.syllableChanges = (room.syllableChanges || 0) + 1;
  }

  const speedBonus = Math.floor((room.syllableChanges || 0) / 5);
  room.timeLeft = Math.max(6, 12 - speedBonus);
  const current = alive[room.currentPlayerIndex];

  io.to(roomCode).emit('new-turn', {
    currentPlayerId: current.id,
    currentPlayerName: current.name,
    syllable: room.currentSyllable,
    timeLeft: room.timeLeft,
    maxTime: room.timeLeft,
    players: room.players,
    keptSyllable: keepSyllable,
    round: room.syllableChanges || 0,
    mode: room.mode || 'normal',
  });

  room.timer = setInterval(() => {
    room.timeLeft--;
    io.to(roomCode).emit('timer-tick', { timeLeft: room.timeLeft });

    if (room.timeLeft <= 0) {
      clearInterval(room.timer);
      const player = room.players.find(p => p.id === current.id);
      if (player) {
        player.lives--;
        if (player.lives <= 0) {
          player.eliminated = true;
          io.to(roomCode).emit('player-eliminated', { playerId: player.id, playerName: player.name, players: room.players });
        } else {
          io.to(roomCode).emit('player-lost-life', { playerId: player.id, playerName: player.name, livesLeft: player.lives, players: room.players });
        }
      }
      io.to(roomCode).emit('bomb-exploded', { playerId: current.id });

      const stillAlive = activePlayers(room);
      if (stillAlive.length <= 1) { endGame(roomCode); return; }

      room.syllableFailCount = (room.syllableFailCount || 0) + 1;
      const keep = room.syllableFailCount < stillAlive.length;
      room.currentPlayerIndex = (room.currentPlayerIndex - 1 + stillAlive.length) % stillAlive.length;
      setTimeout(() => nextTurn(roomCode, keep), 2200);
    }
  }, 1000);
}

async function validateWord(room, word) {
  const clean = (word || '').toLowerCase().trim();
  if (!clean) return { ok: false, msg: 'Tomt ord!', passTurn: false };
  if (room.usedWords.has(clean)) return { ok: false, msg: `"${clean}" er allerede brugt!`, passTurn: false };

  const mode = room.mode || 'normal';
  const syl  = room.currentSyllable;

  if (mode === 'names') {
    if (!clean.startsWith(syl.toLowerCase()))
      return { ok: false, msg: `Navnet skal starte med "${syl}"!`, passTurn: true };
    if (!nameSet.has(clean))
      return { ok: false, msg: `"${clean}" kendes ikke som et dansk navn!`, passTurn: true };
  } else if (mode === 'letters') {
    const [l1, l2] = syl.split('+');
    if (!clean.includes(l1) || !clean.includes(l2))
      return { ok: false, msg: `Ordet skal indeholde både "${l1.toUpperCase()}" og "${l2.toUpperCase()}"!`, passTurn: true };
    if (!await checkWordInOrdnet(clean))
      return { ok: false, msg: `"${clean}" er ikke et gyldigt dansk ord!`, passTurn: true };
  } else {
    if (!clean.includes(syl))
      return { ok: false, msg: `"${clean}" indeholder ikke "${syl}"!`, passTurn: true };
    if (!await checkWordInOrdnet(clean))
      return { ok: false, msg: `"${clean}" er ikke et gyldigt dansk ord!`, passTurn: true };
  }
  return { ok: true };
}

io.on('connection', socket => {
  socket.on('join-room', ({ roomCode, playerName }) => {
    const code = roomCode.toUpperCase().trim().slice(0, 6);
    const name = (playerName || '').trim().slice(0, 20) || 'Spiller';
    if (!rooms[code]) {
      rooms[code] = {
        code, state: 'lobby', mode: 'normal',
        players: [{ id: socket.id, name, lives: 3, points: 0, isHost: true, eliminated: false }],
        currentPlayerIndex: -1, currentSyllable: '', syllableFailCount: 0,
        usedWords: new Set(), timer: null, timeLeft: 12,
      };
      socket.join(code);
      socket.emit('room-joined', { room: sanitize(rooms[code]), yourId: socket.id, isHost: true });
    } else {
      const room = rooms[code];
      if (room.state !== 'lobby') { socket.emit('error-msg', { message: 'Spillet er allerede i gang!' }); return; }
      if (room.players.length >= 8) { socket.emit('error-msg', { message: 'Rummet er fuldt!' }); return; }
      room.players.push({ id: socket.id, name, lives: 3, points: 0, isHost: false, eliminated: false });
      socket.join(code);
      io.to(code).emit('player-joined', { room: sanitize(room) });
      socket.emit('room-joined', { room: sanitize(room), yourId: socket.id, isHost: false });
    }
  });

  socket.on('set-mode', ({ roomCode, mode }) => {
    const room = rooms[roomCode];
    if (!room || !room.players.find(p => p.id === socket.id && p.isHost)) return;
    if (['normal','names','letters'].includes(mode)) {
      room.mode = mode;
      io.to(roomCode).emit('mode-changed', { mode });
    }
  });

  socket.on('start-game', ({ roomCode }) => {
    const room = rooms[roomCode];
    if (!room || !room.players.find(p => p.id === socket.id && p.isHost)) return;
    if (room.players.length < 2) { socket.emit('error-msg', { message: 'Mindst 2 spillere!' }); return; }
    room.state = 'playing';
    room.usedWords = new Set();
    room.currentPlayerIndex = -1;
    room.syllableFailCount = 0;
    room.syllableChanges = 0;
    room.players.forEach(p => { p.lives = 3; p.points = 0; p.eliminated = false; });
    io.to(roomCode).emit('game-started', { players: room.players, mode: room.mode || 'normal' });
    setTimeout(() => nextTurn(roomCode, false), 1200);
  });

  socket.on('submit-word', async ({ roomCode, word }) => {
    const room = rooms[roomCode];
    if (!room || room.state !== 'playing') return;
    const alive = activePlayers(room);
    const current = alive[room.currentPlayerIndex];
    if (!current || current.id !== socket.id) {
      socket.emit('word-rejected', { message: 'Det er ikke din tur!' }); return;
    }
    const clean = (word || '').toLowerCase().trim();
    const result = await validateWord(room, clean);
    if (!result.ok) {
      socket.emit('word-rejected', { message: result.msg });
      if (result.passTurn && room.state === 'playing') {
        clearInterval(room.timer);
        setTimeout(() => nextTurn(roomCode, true), 1200);
      }
      return;
    }

    // Re-check after async ordnet.dk lookup — timer may have fired in the meantime
    if (!room || room.state !== 'playing') return;
    const aliveNow = activePlayers(room);
    const currentNow = aliveNow[room.currentPlayerIndex];
    if (!currentNow || currentNow.id !== socket.id) {
      socket.emit('word-rejected', { message: 'Tiden løb ud!' }); return;
    }

    room.usedWords.add(clean);
    const player = room.players.find(p => p.id === socket.id);
    const earned = clean.length;
    if (player) player.points += earned;
    clearInterval(room.timer);

    io.to(roomCode).emit('word-accepted', {
      playerId: socket.id, playerName: current.name,
      word: clean, syllable: room.currentSyllable,
      pointsEarned: earned, players: room.players,
      mode: room.mode || 'normal',
    });
    setTimeout(() => nextTurn(roomCode, false), 900);
  });

  socket.on('typing-preview', ({ roomCode, text }) => {
    socket.to(roomCode).emit('player-typing', { playerId: socket.id, text: (text || '').slice(0, 25) });
  });

  socket.on('chat', ({ roomCode, message }) => {
    const room = rooms[roomCode];
    const player = room?.players.find(p => p.id === socket.id);
    if (!player || !message?.trim()) return;
    io.to(roomCode).emit('chat-message', { playerId: socket.id, name: player.name, message: message.trim().slice(0, 150) });
  });

  socket.on('play-again', ({ roomCode }) => {
    const room = rooms[roomCode];
    if (!room || !room.players.find(p => p.id === socket.id && p.isHost)) return;
    clearInterval(room.timer);
    room.state = 'lobby'; room.usedWords = new Set();
    room.currentPlayerIndex = -1; room.syllableFailCount = 0;
    room.players.forEach(p => { p.lives = 3; p.points = 0; p.eliminated = false; });
    io.to(roomCode).emit('game-reset', { room: sanitize(room) });
  });

  socket.on('cheat-word', ({ roomCode }) => {
    const room = rooms[roomCode];
    if (!room || room.state !== 'playing') return;
    const alive = activePlayers(room);
    const current = alive[room.currentPlayerIndex];
    if (!current || current.id !== socket.id) return;
    const mode = room.mode || 'normal';
    const syl = room.currentSyllable;
    let word = null;
    if (mode === 'names') {
      word = nameArray.find(w => w.startsWith(syl.toLowerCase()) && !room.usedWords.has(w)) ?? null;
    } else if (mode === 'letters') {
      const [l1, l2] = syl.split('+');
      word = wordArray.find(w => w.includes(l1) && w.includes(l2) && !room.usedWords.has(w)) ?? null;
    } else {
      word = wordArray.find(w => w.includes(syl) && !room.usedWords.has(w)) ?? null;
    }
    if (word) ordnetCache.set(word, true);
    socket.emit('cheat-suggestion', { word });
  });

  socket.on('disconnect', () => {
    for (const [code, room] of Object.entries(rooms)) {
      const idx = room.players.findIndex(p => p.id === socket.id);
      if (idx === -1) continue;
      const [player] = room.players.splice(idx, 1);
      io.to(code).emit('player-left', { playerId: socket.id, playerName: player.name, players: room.players });
      if (room.players.length === 0) { clearInterval(room.timer); delete rooms[code]; break; }
      if (player.isHost) { room.players[0].isHost = true; io.to(code).emit('new-host', { hostId: room.players[0].id }); }
      if (room.state === 'playing') {
        const alive = activePlayers(room);
        if (alive.length <= 1) endGame(code);
        else room.currentPlayerIndex = room.currentPlayerIndex % alive.length;
      }
      break;
    }
  });
});

function sanitize(room) { return { ...room, usedWords: [...room.usedWords] }; }

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Ord Bombe kører på http://localhost:${PORT}`));
