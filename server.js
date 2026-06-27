const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const danishWords = require('./words/danish-words');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });
app.use(express.static(path.join(__dirname, 'public')));

// Filter out common English-only words
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

const EASY   = ['er','en','de','re','te','ne','et','an','ge','le','or','el','se','ke','ar','ve','ig','be','me','he','at','il','am','om','ed','nd','ng','sk'];
const MEDIUM = ['st','ud','ag','tr','ind','sp','kr','ul','ner','ler','br','dr','pr','ser','rd','eg','od'];
const HARD   = ['bl','kl','fl','pl','gr','fr','ent','ord','und'];

const rooms = {};

function randomSyllable() {
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
  const sorted = [...room.players].sort((a, b) => b.points - a.points);
  const winner = sorted[0];
  io.to(roomCode).emit('game-over', { winner: { id: winner.id, name: winner.name, points: winner.points }, players: room.players });
}

function nextTurn(roomCode, keepSyllable = false) {
  const room = rooms[roomCode];
  if (!room || room.state !== 'playing') return;
  clearInterval(room.timer);

  const alive = activePlayers(room);
  if (alive.length <= 1) { endGame(roomCode); return; }

  room.currentPlayerIndex = (room.currentPlayerIndex + 1) % alive.length;

  if (!keepSyllable) {
    room.currentSyllable = randomSyllable();
    room.syllableFailCount = 0;
  }

  room.timeLeft = 12;
  const current = alive[room.currentPlayerIndex];

  io.to(roomCode).emit('new-turn', {
    currentPlayerId: current.id,
    currentPlayerName: current.name,
    syllable: room.currentSyllable,
    timeLeft: room.timeLeft,
    players: room.players,
    keptSyllable: keepSyllable,
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
      const keep = room.syllableFailCount < stillAlive.length; // change syllable once all alive players have failed
      room.currentPlayerIndex = (room.currentPlayerIndex - 1 + stillAlive.length) % stillAlive.length;
      setTimeout(() => nextTurn(roomCode, keep), 2200);
    }
  }, 1000);
}

io.on('connection', socket => {
  socket.on('join-room', ({ roomCode, playerName }) => {
    const code = roomCode.toUpperCase().trim().slice(0, 6);
    const name = (playerName || '').trim().slice(0, 20) || 'Spiller';
    if (!rooms[code]) {
      rooms[code] = {
        code, state: 'lobby',
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

  socket.on('start-game', ({ roomCode }) => {
    const room = rooms[roomCode];
    if (!room || !room.players.find(p => p.id === socket.id && p.isHost)) return;
    if (room.players.length < 2) { socket.emit('error-msg', { message: 'Mindst 2 spillere!' }); return; }
    room.state = 'playing';
    room.usedWords = new Set();
    room.currentPlayerIndex = -1;
    room.syllableFailCount = 0;
    room.players.forEach(p => { p.lives = 3; p.points = 0; p.eliminated = false; });
    io.to(roomCode).emit('game-started', { players: room.players });
    setTimeout(() => nextTurn(roomCode, false), 1200);
  });

  socket.on('submit-word', ({ roomCode, word }) => {
    const room = rooms[roomCode];
    if (!room || room.state !== 'playing') return;
    const alive = activePlayers(room);
    const current = alive[room.currentPlayerIndex];
    if (!current || current.id !== socket.id) { socket.emit('word-rejected', { message: 'Det er ikke din tur!' }); return; }
    const clean = (word || '').toLowerCase().trim();
    if (!clean) return;
    if (room.usedWords.has(clean)) { socket.emit('word-rejected', { message: `"${clean}" er allerede brugt!` }); return; }
    if (!wordSet.has(clean)) { socket.emit('word-rejected', { message: `"${clean}" er ikke et gyldigt dansk ord!` }); return; }
    if (!clean.includes(room.currentSyllable)) { socket.emit('word-rejected', { message: `"${clean}" indeholder ikke "${room.currentSyllable}"!` }); return; }

    room.usedWords.add(clean);
    const player = room.players.find(p => p.id === socket.id);
    const earned = clean.length;
    if (player) player.points += earned;
    clearInterval(room.timer);

    io.to(roomCode).emit('word-accepted', {
      playerId: socket.id, playerName: current.name,
      word: clean, syllable: room.currentSyllable,
      pointsEarned: earned, players: room.players,
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
