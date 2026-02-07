const path = require('path');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');
const cors = require('cors');
const rooms = require('./rooms');
const game = require('./game');

const app = express();
app.use(cors());
app.use(express.json());

// API routes before static so /api/* is never served as files
app.get('/api/payouts', (req, res) => {
  const payouts = [];
  for (let n = 2; n <= 12; n++) {
    const { ways, pct } = game.getProbability(n);
    payouts.push({ number: n, multiplier: game.getMultiplier(n), ways, probability: pct });
  }
  res.json(payouts);
});

app.get('/api/side-bets', (req, res) => {
  try {
    res.json(game.getSideBetInfo());
  } catch (err) {
    console.error('getSideBetInfo error', err);
    res.status(500).json([]);
  }
});

const PUBLIC = path.join(__dirname, '..', 'public');
app.use(express.static(PUBLIC));

app.post('/api/room/create', (req, res) => {
  const body = req.body || {};
  const name = (body.playerName || 'Host').trim() || 'Host';
  const room = rooms.createRoom(name, {
    startingPoints: body.startingPoints,
    roundTimerSec: body.roundTimerSec,
    useTimer: body.useTimer,
    betMin: body.betMin,
    betMax: body.betMax,
    winCondition: body.winCondition,
    targetPoints: body.targetPoints
  });
  res.json({
    code: room.code,
    hostName: room.hostName,
    settings: room.settings
  });
});

app.post('/api/room/join', (req, res) => {
  const { code, playerName, playerId, color } = req.body || {};
  const result = rooms.joinRoom(code, playerName, null, { playerId, color });
  if (!result.ok) return res.status(400).json({ error: result.error });
  const room = result.room;
  res.json({
    code: room.code,
    playerId: result.playerId,
    reconnected: result.reconnected || false,
    players: Array.from(room.players.values()).map(p => ({
      id: p.id,
      name: p.name,
      points: p.points,
      color: p.color
    })),
    ready: Array.from(room.ready.entries()).filter(([pid]) => room.players.has(pid)),
    settings: room.settings
  });
});

app.post('/api/room/reconnect', (req, res) => {
  const { code, playerId } = req.body || {};
  const room = rooms.getRoom((code || '').toUpperCase());
  if (!room) return res.status(400).json({ error: 'Room not found' });
  const player = room.players.get(playerId);
  if (!player) return res.status(400).json({ error: 'Player not in this room' });
  res.json({
    code: room.code,
    playerId,
    ...rooms.serializeRoom(room)
  });
});

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

const roomTimers = new Map();

function clearRoomTimer(code) {
  if (roomTimers.has(code)) {
    clearTimeout(roomTimers.get(code));
    roomTimers.delete(code);
  }
}

function scheduleAutoRoll(code) {
  clearRoomTimer(code);
  const room = rooms.getRoom(code);
  if (!room || room.phase !== 'betting' || !room.settings.useTimer) return;
  const ms = room.settings.roundTimerSec * 1000;
  room.roundEndsAt = Date.now() + ms;
  const t = setTimeout(() => {
    roomTimers.delete(code);
    const r = rooms.getRoom(code);
    if (!r || r.phase !== 'betting') return;
    const result = rooms.roll(code);
    if (result.ok) {
      io.to(code).emit('dice-rolled', {
        d1: result.roll.d1,
        d2: result.roll.d2,
        sum: result.roll.sum,
        isDouble: result.roll.isDouble,
        results: result.results,
        summary: result.summary,
        winner: result.winner,
        players: Array.from(result.room.players.values()).map(p => ({ id: p.id, name: p.name, points: p.points, color: p.color }))
      });
    }
  }, ms);
  roomTimers.set(code, t);
}

io.on('connection', (socket) => {
  socket.on('join-room', (payload) => {
    const { code, playerId, playerName, color } = payload || {};
    const room = rooms.getRoom(code);
    if (!room) return socket.emit('error', { message: 'Room not found' });
    socket.join(code);
    socket.roomCode = code;
    socket.playerId = playerId;

    let player = room.players.get(playerId);
    if (!player && room.phase === 'lobby') {
      const result = rooms.joinRoom(code, playerName, socket.id, { playerId, color });
      if (result.ok) player = result.room.players.get(playerId);
    }
    if (player) {
      player.socketId = socket.id;
      if (color != null) player.color = color;
    }

    const serialized = rooms.serializeRoom(room);
    socket.emit('room-state', serialized);
    io.to(code).emit('players-update', {
      players: serialized.players,
      ready: serialized.ready
    });
  });

  socket.on('set-ready', ({ code, playerId, ready }) => {
    const result = rooms.setReady(code, playerId, ready);
    if (!result.ok) return socket.emit('error', { message: result.error });
    const room = rooms.getRoom(code);
    const readyList = Array.from(room.ready.entries()).filter(([pid]) => room.players.has(pid));
    io.to(code).emit('players-update', {
      players: Array.from(room.players.values()).map(p => ({ id: p.id, name: p.name, points: p.points, color: p.color })),
      ready: readyList
    });
  });

  socket.on('set-color', ({ code, playerId, color }) => {
    const result = rooms.setPlayerColor(code, playerId, color);
    if (!result.ok) return socket.emit('error', { message: result.error });
    const room = rooms.getRoom(code);
    io.to(code).emit('players-update', {
      players: Array.from(room.players.values()).map(p => ({ id: p.id, name: p.name, points: p.points, color: p.color })),
      ready: Array.from(room.ready.entries()).filter(([pid]) => room.players.has(pid))
    });
  });

  socket.on('start-game', (code) => {
    const room = rooms.getRoom(code);
    if (!room || room.hostId !== socket.playerId) return socket.emit('error', { message: 'Only host can start' });
    const result = rooms.startGame(code);
    if (!result.ok) return socket.emit('error', { message: result.error });
    const room = result.room;
    room.roundEndsAt = room.settings.useTimer ? Date.now() + room.settings.roundTimerSec * 1000 : null;
    io.to(code).emit('game-started', {
      phase: 'betting',
      roundNumber: room.roundNumber,
      roundEndsAt: room.roundEndsAt,
      settings: room.settings,
      players: Array.from(room.players.values()).map(p => ({ id: p.id, name: p.name, points: p.points, color: p.color }))
    });
    scheduleAutoRoll(code);
  });

  socket.on('place-bet', ({ code, playerId, number, amount }) => {
    const result = rooms.placeBet(code, playerId, number, amount);
    if (!result.ok) return socket.emit('error', { message: result.error });
    const room = rooms.getRoom(code);
    io.to(code).emit('bet-placed', {
      playerId,
      number,
      amount,
      players: Array.from(room.players.values()).map(p => ({ id: p.id, name: p.name, points: p.points, color: p.color }))
    });
  });

  socket.on('place-side-bet', ({ code, playerId, type, amount }) => {
    const result = rooms.placeSideBet(code, playerId, type, amount);
    if (!result.ok) return socket.emit('error', { message: result.error });
    const room = rooms.getRoom(code);
    io.to(code).emit('side-bet-placed', {
      playerId,
      type,
      amount,
      players: Array.from(room.players.values()).map(p => ({ id: p.id, name: p.name, points: p.points, color: p.color }))
    });
  });

  socket.on('roll', (code) => {
    clearRoomTimer(code);
    const result = rooms.roll(code);
    if (!result.ok) return socket.emit('error', { message: result.error });
    io.to(code).emit('dice-rolled', {
      d1: result.roll.d1,
      d2: result.roll.d2,
      sum: result.roll.sum,
      isDouble: result.roll.isDouble,
      results: result.results,
      summary: result.summary,
      winner: result.winner,
      players: Array.from(result.room.players.values()).map(p => ({ id: p.id, name: p.name, points: p.points, color: p.color }))
    });
  });

  socket.on('next-round', (code) => {
    const result = rooms.nextRound(code);
    if (!result.ok) return socket.emit('error', { message: result.error });
    scheduleAutoRoll(code);
    io.to(code).emit('next-round', {
      phase: 'betting',
      roundNumber: result.room.roundNumber,
      roundEndsAt: result.room.roundEndsAt,
      players: Array.from(result.room.players.values()).map(p => ({ id: p.id, name: p.name, points: p.points, color: p.color }))
    });
  });

  socket.on('chat', ({ code, playerId, message }) => {
    const result = rooms.chat(code, playerId, message);
    if (!result.ok) return socket.emit('error', { message: result.error });
    io.to(code).emit('chat-message', result.message);
  });

  socket.on('reaction', ({ code, playerId, emoji }) => {
    const result = rooms.reaction(code, playerId, emoji);
    if (!result.ok) return;
    io.to(code).emit('reaction', result.reaction);
  });

  socket.on('kick', ({ code, targetPlayerId }) => {
    const roomBefore = rooms.getRoom(code);
    const targetSocketId = roomBefore?.players.get(targetPlayerId)?.socketId;
    const result = rooms.kickPlayer(code, socket.playerId, targetPlayerId);
    if (!result.ok) return socket.emit('error', { message: result.error });
    const room = rooms.getRoom(code);
    io.to(code).emit('players-update', {
      players: room ? Array.from(room.players.values()).map(p => ({ id: p.id, name: p.name, points: p.points, color: p.color })) : [],
      ready: room ? Array.from(room.ready.entries()).filter(([pid]) => room.players.has(pid)) : [],
      kickedId: result.kickedId
    });
    if (targetSocketId) io.to(targetSocketId).emit('kicked', {});
  });

  socket.on('leave-game', (code) => {
    const room = rooms.leaveRoom(code, socket.playerId);
    socket.roomCode = null;
    socket.playerId = null;
    socket.leave(code);
    if (room) {
      io.to(code).emit('players-update', {
        players: Array.from(room.players.values()).map(p => ({ id: p.id, name: p.name, points: p.points, color: p.color })),
        ready: Array.from(room.ready.entries()).filter(([pid]) => room.players.has(pid))
      });
    }
  });

  socket.on('disconnect', () => {
    const code = socket.roomCode;
    const playerId = socket.playerId;
    if (code && playerId) {
      const room = rooms.getRoom(code);
      if (room) {
        const p = room.players.get(playerId);
        if (p) p.socketId = null;
        io.to(code).emit('players-update', {
          players: Array.from(room.players.values()).map(p => ({ id: p.id, name: p.name, points: p.points, color: p.color })),
          ready: Array.from(room.ready.entries()).filter(([pid]) => room.players.has(pid))
        });
      }
    }
  });
});

const PORT = process.env.PORT || 8000; // Koyeb likes 8000 or 3000

server.listen(PORT, () => {
    console.log(`DiceEdge running on port ${PORT}`);
});

module.exports = server;