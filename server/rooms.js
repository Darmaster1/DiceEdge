/**
 * In-memory game rooms: settings, ready-up, bets, side bets, timer, win condition, chat, history.
 */

const { rollDice, getPayout, getSideBetPayout } = require('./game');

const DEFAULT_START_POINTS = 1000;
const ROOM_CODE_LENGTH = 6;
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const MAX_BETS_PER_PLAYER = 3;
const MAX_CHAT_MESSAGES = 100;
const MAX_HISTORY = 30;
const DEFAULT_BET_MIN = 10;
const DEFAULT_BET_MAX = 500;
const DEFAULT_ROUND_TIMER_SEC = 30;

function generateRoomCode() {
  let code = '';
  for (let i = 0; i < ROOM_CODE_LENGTH; i++) {
    code += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  }
  return code;
}

const rooms = new Map();

function createRoom(hostName, options = {}) {
  const code = (() => {
    let c;
    do c = generateRoomCode();
    while (rooms.has(c));
    return c;
  })();
  const useTimer = options.useTimer === true || options.useTimer === 'true';
  const settings = {
    startingPoints: Number(options.startingPoints) || DEFAULT_START_POINTS,
    roundTimerSec: Math.max(10, Math.min(120, Number(options.roundTimerSec) || DEFAULT_ROUND_TIMER_SEC)),
    useTimer,
    betMin: Math.max(1, Number(options.betMin) || DEFAULT_BET_MIN),
    betMax: Math.max(10, Number(options.betMax) || DEFAULT_BET_MAX),
    winCondition: options.winCondition || 'first_to_target',
    targetPoints: Math.max(500, Number(options.targetPoints) || 2000)
  };
  const room = {
    code,
    hostId: null,
    hostName,
    players: new Map(),
    ready: new Map(),
    bets: new Map(),
    sideBets: new Map(),
    phase: 'lobby',
    lastRoll: null,
    roundNumber: 0,
    roundEndsAt: null,
    settings,
    chat: [],
    history: [],
    winner: null
  };
  rooms.set(code, room);
  return room;
}

function joinRoom(code, playerName, socketId, options = {}) {
  const room = rooms.get((code || '').toUpperCase());
  if (!room) return { ok: false, error: 'Room not found' };
  if (room.phase !== 'lobby') return { ok: false, error: 'Game already started' };
  const name = (playerName || 'Player').trim().slice(0, 20) || 'Player';
  const id = options.playerId || socketId || `p-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  if (room.players.has(id)) {
    const p = room.players.get(id);
    p.socketId = socketId || p.socketId;
    p.name = name;
    if (options.color != null) p.color = options.color;
    return { ok: true, room, playerId: id, reconnected: true };
  }
  const color = options.color || null;
  room.players.set(id, {
    id,
    name,
    points: room.settings.startingPoints,
    socketId: id,
    color
  });
  room.ready.set(id, false);
  if (!room.hostId) room.hostId = id;
  return { ok: true, room, playerId: id };
}

function setReady(code, playerId, ready) {
  const room = rooms.get(code);
  if (!room) return { ok: false, error: 'Room not found' };
  if (room.phase !== 'lobby') return { ok: false, error: 'Not in lobby' };
  if (!room.players.has(playerId)) return { ok: false, error: 'Not in room' };
  room.ready.set(playerId, !!ready);
  return { ok: true, room };
}

function setPlayerColor(code, playerId, color) {
  const room = rooms.get(code);
  if (!room) return { ok: false, error: 'Room not found' };
  const p = room.players.get(playerId);
  if (!p) return { ok: false, error: 'Not in room' };
  p.color = color;
  return { ok: true, room };
}

function allReady(room) {
  if (room.players.size < 1) return false;
  for (const [pid, r] of room.ready) {
    if (room.players.has(pid) && !r) return false;
  }
  return true;
}

function startGame(code) {
  const room = rooms.get(code);
  if (!room) return { ok: false, error: 'Room not found' };
  if (room.phase !== 'lobby') return { ok: false, error: 'Already started' };
  if (room.players.size < 1) return { ok: false, error: 'Need at least one player' };
  room.phase = 'betting';
  room.roundNumber = 1;
  room.bets.clear();
  room.sideBets.clear();
  room.roundEndsAt = null;
  room.winner = null;
  return { ok: true, room };
}

function startBettingPhase(room) {
  room.phase = 'betting';
  room.bets.clear();
  room.sideBets.clear();
  room.lastRoll = null;
  room.roundEndsAt = room.settings.useTimer ? Date.now() + room.settings.roundTimerSec * 1000 : null;
  return room;
}

function placeBet(code, playerId, number, amount) {
  const room = rooms.get(code);
  if (!room) return { ok: false, error: 'Room not found' };
  if (room.phase !== 'betting') return { ok: false, error: 'Not in betting phase' };
  const num = parseInt(number, 10);
  if (num < 2 || num > 12 || !Number.isInteger(num)) return { ok: false, error: 'Pick a number 2–12' };
  const amt = Math.floor(Number(amount)) || 0;
  if (amt <= 0) return { ok: false, error: 'Bet must be positive' };
  const { betMin, betMax } = room.settings;
  if (amt < betMin) return { ok: false, error: `Minimum bet is ${betMin}` };
  if (amt > betMax) return { ok: false, error: `Maximum bet is ${betMax}` };
  const player = room.players.get(playerId);
  if (!player) return { ok: false, error: 'Player not in room' };
  const existing = room.bets.get(playerId) || [];
  const totalBet = existing.reduce((s, b) => s + b.amount, 0) + amt;
  if (player.points < totalBet) return { ok: false, error: 'Not enough points' };
  if (existing.length >= MAX_BETS_PER_PLAYER) return { ok: false, error: `Max ${MAX_BETS_PER_PLAYER} number bets per round` };
  const alreadyOn = existing.some(b => b.number === num);
  if (alreadyOn) return { ok: false, error: 'Already bet on that number' };
  existing.push({ number: num, amount: amt });
  room.bets.set(playerId, existing);
  player.points -= amt;
  return { ok: true, room, bet: { number: num, amount: amt } };
}

function placeSideBet(code, playerId, type, amount) {
  const room = rooms.get(code);
  if (!room) return { ok: false, error: 'Room not found' };
  if (room.phase !== 'betting') return { ok: false, error: 'Not in betting phase' };
  const validTypes = ['doubles', 'over7', 'under7', 'exactly7', 'any_craps', 'hard_6', 'hard_8', 'hard_10', 'snake_eyes', 'boxcars'];
  if (!validTypes.includes(type)) return { ok: false, error: 'Invalid side bet type' };
  const amt = Math.floor(Number(amount)) || 0;
  if (amt <= 0) return { ok: false, error: 'Bet must be positive' };
  const { betMin, betMax } = room.settings;
  if (amt < betMin) return { ok: false, error: `Minimum bet is ${betMin}` };
  if (amt > betMax) return { ok: false, error: `Maximum bet is ${betMax}` };
  const player = room.players.get(playerId);
  if (!player) return { ok: false, error: 'Player not in room' };
  const existing = room.sideBets.get(playerId) || {};
  if (existing[type]) return { ok: false, error: 'Already placed that side bet' };
  if (player.points < amt) return { ok: false, error: 'Not enough points' };
  existing[type] = amt;
  room.sideBets.set(playerId, existing);
  player.points -= amt;
  return { ok: true, room, sideBet: { type, amount: amt } };
}

function roll(code, opts) {
  const room = rooms.get(code);
  if (!room) return { ok: false, error: 'Room not found' };
  if (room.phase !== 'betting') return { ok: false, error: 'Not in betting phase' };
  const rollResult = rollDice();
  room.lastRoll = rollResult;
  room.phase = 'rolled';
  room.roundEndsAt = null;

  const results = [];
  for (const [pid, bets] of room.bets) {
    const player = room.players.get(pid);
    if (!player) continue;
    for (const bet of bets) {
      const win = getPayout(bet.amount, bet.number, rollResult.sum);
      player.points += win;
      results.push({ playerId: pid, playerName: player.name, number: bet.number, amount: bet.amount, won: win > 0, payout: win });
    }
  }
  room.bets.clear();

  for (const [pid, sideBets] of room.sideBets) {
    const player = room.players.get(pid);
    if (!player) continue;
    for (const [type, amt] of Object.entries(sideBets)) {
      const win = getSideBetPayout(type, amt, rollResult);
      player.points += win;
      results.push({ playerId: pid, playerName: player.name, sideBet: type, amount: amt, won: win > 0, payout: win });
    }
  }
  room.sideBets.clear();

  room.history.unshift({
    roundNumber: room.roundNumber,
    d1: rollResult.d1,
    d2: rollResult.d2,
    sum: rollResult.sum,
    isDouble: rollResult.isDouble,
    results: results.slice()
  });
  if (room.history.length > MAX_HISTORY) room.history.pop();

  const playersList = Array.from(room.players.values());
  const winner = checkWinCondition(room);
  if (winner) {
    room.phase = 'game-over';
    room.winner = winner;
  }

  return {
    ok: true,
    room,
    roll: room.lastRoll,
    results,
    summary: buildRoundSummary(room.roundNumber, rollResult, results),
    winner: room.winner
  };
}

function buildRoundSummary(roundNum, roll, results) {
  const lines = results.map(r => {
    const name = r.playerName;
    if (r.won) return `${name} +${r.payout}`;
    return `${name} -${r.amount || r.amount}`;
  });
  return `Round ${roundNum}: ${roll.d1}+${roll.d2}=${roll.sum}. ${lines.join(', ')}`;
}

function checkWinCondition(room) {
  const { winCondition, targetPoints } = room.settings;
  const playersList = Array.from(room.players.values());
  if (winCondition === 'first_to_target') {
    const over = playersList.filter(p => p.points >= targetPoints);
    if (over.length >= 1) return over[0];
  }
  if (winCondition === 'elimination') {
    const withPoints = playersList.filter(p => p.points > 0);
    if (withPoints.length === 1) return withPoints[0];
    if (withPoints.length === 0 && playersList.length > 0) return playersList[0];
  }
  return null;
}

function nextRound(code) {
  const room = rooms.get(code);
  if (!room) return { ok: false, error: 'Room not found' };
  if (room.phase !== 'rolled' && room.phase !== 'game-over') return { ok: false, error: 'Roll first' };
  if (room.phase === 'game-over') return { ok: false, error: 'Game over' };
  room.roundNumber += 1;
  startBettingPhase(room);
  return { ok: true, room };
}

function chat(code, playerId, message) {
  const room = rooms.get(code);
  if (!room) return { ok: false, error: 'Room not found' };
  const player = room.players.get(playerId);
  if (!player) return { ok: false, error: 'Not in room' };
  const text = (message || '').trim().slice(0, 300);
  if (!text) return { ok: false, error: 'Empty message' };
  const entry = { playerId, playerName: player.name, color: player.color, text, at: Date.now() };
  room.chat.push(entry);
  if (room.chat.length > MAX_CHAT_MESSAGES) room.chat.shift();
  return { ok: true, room, message: entry };
}

function reaction(code, playerId, emoji) {
  const room = rooms.get(code);
  if (!room) return { ok: false, error: 'Room not found' };
  const player = room.players.get(playerId);
  if (!player) return { ok: false, error: 'Not in room' };
  const e = (emoji || '👍').slice(0, 4);
  return { ok: true, room, reaction: { playerId, playerName: player.name, emoji: e } };
}

function kickPlayer(code, byPlayerId, targetPlayerId) {
  const room = rooms.get(code);
  if (!room) return { ok: false, error: 'Room not found' };
  if (room.hostId !== byPlayerId) return { ok: false, error: 'Only host can kick' };
  if (!room.players.has(targetPlayerId)) return { ok: false, error: 'Player not in room' };
  room.players.delete(targetPlayerId);
  room.ready.delete(targetPlayerId);
  room.bets.delete(targetPlayerId);
  room.sideBets.delete(targetPlayerId);
  if (room.hostId === targetPlayerId) {
    const next = Array.from(room.players.keys())[0];
    room.hostId = next || null;
  }
  if (room.players.size === 0) rooms.delete(code);
  return { ok: true, room, kickedId: targetPlayerId };
}

function leaveRoom(code, playerId) {
  const room = rooms.get(code);
  if (!room) return null;
  const wasHost = room.hostId === playerId;
  room.players.delete(playerId);
  room.ready.delete(playerId);
  room.bets.delete(playerId);
  room.sideBets.delete(playerId);
  if (wasHost) {
    const next = Array.from(room.players.keys())[0];
    room.hostId = next || null;
  }
  if (room.players.size === 0) {
    rooms.delete(code);
    return null;
  }
  return room;
}

function getRoom(code) {
  return rooms.get(code);
}

function serializeRoom(room) {
  if (!room) return null;
  return {
    code: room.code,
    hostId: room.hostId,
    phase: room.phase,
    roundNumber: room.roundNumber,
    lastRoll: room.lastRoll,
    roundEndsAt: room.roundEndsAt,
    settings: room.settings,
    winner: room.winner,
    players: Array.from(room.players.values()).map(p => ({
      id: p.id,
      name: p.name,
      points: p.points,
      color: p.color
    })),
    ready: Array.from(room.ready.entries()).filter(([pid]) => room.players.has(pid)),
    bets: room.phase === 'betting' ? Array.from(room.bets.entries()).map(([pid, list]) => ({ playerId: pid, bets: list })) : [],
    sideBets: room.phase === 'betting' ? Array.from(room.sideBets.entries()).map(([pid, obj]) => ({ playerId: pid, sideBets: obj })) : [],
    chat: room.chat.slice(-50),
    history: room.history.slice(0, 20)
  };
}

module.exports = {
  DEFAULT_START_POINTS,
  createRoom,
  joinRoom,
  setReady,
  setPlayerColor,
  allReady,
  startGame,
  startBettingPhase,
  placeBet,
  placeSideBet,
  roll,
  nextRound,
  chat,
  reaction,
  kickPlayer,
  leaveRoom,
  getRoom,
  serializeRoom
};
