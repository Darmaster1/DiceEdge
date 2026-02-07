(function () {
  const PLAYER_COLORS = ['#22c55e', '#eab308', '#3b82f6', '#ef4444', '#a855f7', '#ec4899', '#f97316', '#06b6d4'];
  const STORAGE_KEY = 'diceedge_reconnect';

  // Fallback if /api/side-bets fails or is slow – must match server game.js
  const DEFAULT_SIDE_BET_INFO = [
    { type: 'doubles', multiplier: 6, label: 'Doubles' },
    { type: 'over7', multiplier: 2.4, label: 'Over 7' },
    { type: 'under7', multiplier: 2.4, label: 'Under 7' },
    { type: 'exactly7', multiplier: 6, label: 'Exactly 7' },
    { type: 'any_craps', multiplier: 9, label: 'Any Craps' },
    { type: 'hard_6', multiplier: 36, label: 'Hard 6' },
    { type: 'hard_8', multiplier: 36, label: 'Hard 8' },
    { type: 'hard_10', multiplier: 36, label: 'Hard 10' },
    { type: 'snake_eyes', multiplier: 36, label: 'Snake Eyes' },
    { type: 'boxcars', multiplier: 36, label: 'Boxcars' }
  ];

  let socket = null;
  let timerInterval = null;
  let state = {
    screen: 'home',
    roomCode: null,
    playerId: null,
    playerName: null,
    playerColor: null,
    isHost: false,
    phase: 'lobby',
    roundNumber: 0,
    lastRoll: null,
    roundEndsAt: null,
    players: [],
    ready: [],
    settings: null,
    payouts: [],
    sideBetInfo: [],
    selectedBetNumber: null,
    currentBetAmount: '',
    myBets: [],
    mySideBets: {},
    lastResults: [],
    summary: '',
    history: [],
    chat: [],
    winner: null,
    soundsEnabled: true
  };

  const $ = (id) => document.getElementById(id);
  const $all = (sel) => document.querySelectorAll(sel);

  function showScreen(id) {
    $all('.screen').forEach((el) => el.classList.remove('active'));
    const el = $(id);
    if (el) el.classList.add('active');
    state.screen = id.replace('screen-', '');
  }

  function toast(message, isError = false) {
    const el = $('toast');
    if (!el) return;
    el.textContent = message;
    el.classList.toggle('error', isError);
    el.classList.add('show');
    clearTimeout(el._t);
    el._t = setTimeout(() => el.classList.remove('show'), 3000);
  }

  function saveReconnect() {
    if (state.roomCode && state.playerId) {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ roomCode: state.roomCode, playerId: state.playerId, playerName: state.playerName }));
      } catch (e) {}
    }
  }

  function clearReconnect() {
    try { localStorage.removeItem(STORAGE_KEY); } catch (e) {}
  }

  function loadPayouts() {
    fetch('/api/payouts')
      .then((r) => r.json())
      .then((list) => { state.payouts = list; renderPayoutsGrid(); })
      .catch(() => {});
    // Side bets: use fallback so grid never stays on "Loading..."
    state.sideBetInfo = DEFAULT_SIDE_BET_INFO.slice();
    if ($('side-bets-grid')) renderSideBets();
    fetch('/api/side-bets')
      .then((r) => {
        if (!r.ok) return DEFAULT_SIDE_BET_INFO;
        return r.json();
      })
      .then((list) => {
        if (Array.isArray(list) && list.length > 0) state.sideBetInfo = list;
        if ($('side-bets-grid')) renderSideBets();
      })
      .catch(() => {
        if ($('side-bets-grid')) renderSideBets();
      });
  }

  function renderPayoutsGrid() {
    const grid = $('payouts-grid');
    if (!grid || !state.payouts.length) return;
    grid.innerHTML = state.payouts
      .map((p) => `<div class="payout-cell"><span class="num">${p.number}</span><br><span class="mult">${p.multiplier}x</span><br><span class="prob">${p.probability}%</span></div>`)
      .join('');
  }

  function getMyPlayer() {
    return state.players.find((p) => p.id === state.playerId);
  }

  function isReady(playerId) {
    const r = state.ready.find(([pid]) => pid === playerId);
    return r ? r[1] : false;
  }

  function renderLobbyPlayers() {
    const list = $('lobby-players');
    if (!list) return;
    list.innerHTML = state.players
      .map((p) => {
        const ready = isReady(p.id);
        const kickBtn = state.isHost && p.id !== state.playerId
          ? `<button type="button" class="kick-btn" data-player-id="${p.id}">Kick</button>`
          : '';
        const color = (p.color && p.color !== 'null') ? p.color : PLAYER_COLORS[0];
        return `<li>
          <span class="player-color" style="background:${color}"></span>
          <span class="player-name">${escapeHtml(p.name)}</span>
          ${ready ? '<span class="ready-badge">✓ Ready</span>' : ''}
          ${kickBtn}
        </li>`;
      })
      .join('');
    list.querySelectorAll('.kick-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        socket.emit('kick', { code: state.roomCode, targetPlayerId: btn.dataset.playerId });
      });
    });
    if ($('lobby-count')) $('lobby-count').textContent = state.players.length;
  }

  function renderColorSwatches() {
    const container = $('lobby-color-swatches');
    if (!container) return;
    const current = state.playerColor || PLAYER_COLORS[0];
    container.innerHTML = PLAYER_COLORS
      .map((c) => `<button type="button" class="color-swatch ${c === current ? 'active' : ''}" style="background:${c}" data-color="${c}" title="${c}"></button>`)
      .join('');
    container.querySelectorAll('.color-swatch').forEach((btn) => {
      btn.addEventListener('click', () => {
        state.playerColor = btn.dataset.color;
        socket.emit('set-color', { code: state.roomCode, playerId: state.playerId, color: state.playerColor });
        renderColorSwatches();
      });
    });
  }

  function escapeHtml(s) {
    const div = document.createElement('div');
    div.textContent = s;
    return div.innerHTML;
  }

  function renderBetGrid() {
    const grid = $('bet-grid');
    if (!grid || !state.payouts.length) return;
    const canBet = state.phase === 'betting' && state.myBets.length < 3;
    grid.innerHTML = state.payouts
      .map((p) => {
        const already = state.myBets.some((b) => b.number === p.number);
        return `<button type="button" class="bet-num" data-num="${p.number}" ${!canBet || already ? 'disabled' : ''}>
          ${p.number}<span class="mult">${p.multiplier}x</span>
        </button>`;
      })
      .join('');
    grid.querySelectorAll('.bet-num').forEach((btn) => {
      if (btn.disabled) return;
      btn.addEventListener('click', () => selectBetNumber(parseInt(btn.dataset.num, 10)));
    });
  }

  function selectBetNumber(num) {
    if (state.phase !== 'betting') return;
    state.selectedBetNumber = state.selectedBetNumber === num ? null : num;
    $all('.bet-num').forEach((b) => b.classList.toggle('selected', parseInt(b.dataset.num, 10) === state.selectedBetNumber));
    updateBetPreview();
  }

  function updateBetPreview() {
    const el = $('bet-preview');
    const amount = parseInt(state.currentBetAmount, 10) || 0;
    if (!state.selectedBetNumber || amount <= 0) {
      if (el) el.textContent = '';
      return;
    }
    const p = state.payouts.find((x) => x.number === state.selectedBetNumber);
    if (p && el) el.textContent = `If ${state.selectedBetNumber} wins: +${Math.floor(amount * p.multiplier)} pts`;
  }

  function renderSideBets() {
    const grid = $('side-bets-grid');
    if (!grid) return;
    if (!state.sideBetInfo || !state.sideBetInfo.length) {
      grid.innerHTML = '<span class="text-muted">Loading side bets…</span>';
      return;
    }
    const canBet = state.phase === 'betting';
    grid.innerHTML = state.sideBetInfo
      .map((sb) => {
        const placed = state.mySideBets[sb.type];
        const multDisplay = Number(sb.multiplier) === Math.floor(sb.multiplier) ? sb.multiplier : sb.multiplier.toFixed(1);
        return `<button type="button" class="side-bet-btn ${placed ? 'placed' : ''}" data-type="${sb.type}" ${!canBet || placed ? 'disabled' : ''}>
          ${escapeHtml(sb.label)} ${multDisplay}x
        </button>`;
      })
      .join('');
  }

  function placeSideBet(type) {
    if (!socket || !state.roomCode || !state.playerId) return toast('Not connected', true);
    const amount = parseInt($('side-bet-amount')?.value, 10) || 0;
    if (amount <= 0) return toast('Enter amount in "Side bet amount" then click a side bet', true);
    const me = getMyPlayer();
    if (me && me.points < amount) return toast('Not enough points', true);
    if (state.settings) {
      if (amount < state.settings.betMin) return toast(`Min bet ${state.settings.betMin}`, true);
      if (amount > state.settings.betMax) return toast(`Max bet ${state.settings.betMax}`, true);
    }
    if (state.mySideBets[type]) return toast('Already placed that side bet', true);
    socket.emit('place-side-bet', { code: state.roomCode, playerId: state.playerId, type, amount });
    state.mySideBets[type] = amount;
    if ($('side-bet-amount')) $('side-bet-amount').value = '';
    renderSideBets();
    updateGameUI();
    toast('Side bet placed: ' + (state.sideBetInfo.find(s => s.type === type)?.label || type));
  }

  function startTimerCountdown() {
    if (timerInterval) clearInterval(timerInterval);
    timerInterval = null;
    const el = $('round-timer');
    if (!el) return;
    if (!state.roundEndsAt || state.phase !== 'betting') {
      el.classList.add('hidden');
      return;
    }
    function tick() {
      const left = Math.max(0, Math.ceil((state.roundEndsAt - Date.now()) / 1000));
      el.textContent = left + 's';
      el.classList.toggle('warning', left <= 10);
      el.classList.remove('hidden');
      if (left <= 0 && timerInterval) {
        clearInterval(timerInterval);
        timerInterval = null;
      }
    }
    tick();
    timerInterval = setInterval(tick, 500);
  }

  function updateGameUI() {
    const me = getMyPlayer();
    if ($('your-points')) $('your-points').innerHTML = `Balance: <strong id="your-points">${me ? me.points : 0}</strong> pts`;
    if ($('round-num')) $('round-num').textContent = state.roundNumber;
    if ($('game-code')) $('game-code').textContent = state.roomCode || '';

    if (state.settings && $('bet-limits')) {
      $('bet-limits').textContent = `Bet limits: ${state.settings.betMin}–${state.settings.betMax} pts`;
    }

    const list = $('game-players');
    if (list) {
      list.innerHTML = state.players
        .map((p) => {
          const color = (p.color && p.color !== 'null') ? p.color : PLAYER_COLORS[0];
          return `<li><span class="player-color" style="background:${color}"></span>${escapeHtml(p.name)} <span class="points">${p.points}</span></li>`;
        })
        .join('');
    }

    const placeholder = $('dice-placeholder');
    const result = $('dice-result');
    if (state.lastRoll) {
      if (placeholder) placeholder.classList.add('hidden');
      if (result) result.classList.remove('hidden');
    } else {
      if (placeholder) placeholder.classList.remove('hidden');
      if (result) result.classList.add('hidden');
    }

    const rollBtn = $('btn-roll');
    const nextBtn = $('btn-next-round');
    const gameOverBanner = $('game-over-banner');
    if (rollBtn) rollBtn.classList.toggle('hidden', state.phase !== 'betting' || !!state.winner);
    if (nextBtn) nextBtn.classList.toggle('hidden', state.phase !== 'rolled' || !!state.winner);
    if (gameOverBanner) {
      gameOverBanner.classList.toggle('hidden', !state.winner);
      if (state.winner && $('game-over-text')) {
        $('game-over-text').textContent = state.winner.id === state.playerId ? 'You win!' : state.winner.name + ' wins!';
      }
    }

    $('bet-amount').disabled = state.phase !== 'betting';
    const amount = parseInt(state.currentBetAmount, 10) || 0;
    const validAmount = state.settings ? amount >= state.settings.betMin && amount <= state.settings.betMax : amount > 0;
    $('btn-place-bet').disabled = state.phase !== 'betting' || !state.selectedBetNumber || !validAmount || state.myBets.length >= 3;

    const yourBetsEl = $('your-bets-list');
    if (yourBetsEl) {
      const parts = state.myBets.map((b) => `${b.number} (${b.amount})`);
      const sideParts = Object.entries(state.mySideBets).map(([t, a]) => `${t} (${a})`);
      yourBetsEl.textContent = parts.length || sideParts.length ? 'Your bets: ' + [...parts, ...sideParts].join(', ') : 'No bets yet';
    }

    renderBetGrid();
    renderSideBets();
    updateBetPreview();
    startTimerCountdown();
  }

  function showDiceRoll(d1, d2, sum, animate) {
    const rolling = $('dice-rolling');
    const final = $('dice-final');
    const die1 = $('die1');
    const die2 = $('die2');
    const die1Final = $('die1-final');
    const die2Final = $('die2-final');
    const sumEl = $('roll-sum');
    if (!rolling || !final) return;
    rolling.classList.remove('hidden');
    final.classList.add('hidden');
    if (die1) die1.textContent = '?';
    if (die2) die2.textContent = '?';
    if (sumEl) sumEl.textContent = '?';
    if (window.DiceSounds && state.soundsEnabled) window.DiceSounds.roll();
    function showFinal() {
      if (die1Final) die1Final.textContent = d1;
      if (die2Final) die2Final.textContent = d2;
      if (sumEl) sumEl.textContent = sum;
      rolling.classList.add('hidden');
      final.classList.remove('hidden');
    }
    if (animate) {
      setTimeout(showFinal, 700);
    } else {
      showFinal();
    }
  }

  function showRollResults(results) {
    const el = $('roll-results');
    if (!el) return;
    if (!results || !results.length) {
      el.classList.add('hidden');
      return;
    }
    el.classList.remove('hidden');
    el.innerHTML = `<ul>${results
      .map((r) => {
        const desc = r.sideBet
          ? (state.sideBetInfo.find((s) => s.type === r.sideBet)?.label || r.sideBet)
          : `#${r.number}`;
        return `<li class="${r.won ? 'won' : 'lost'}">${escapeHtml(r.playerName)}: ${r.won ? `+${r.payout} pts (${desc})` : `${desc} — lost`}</li>`;
      })
      .join('')}</ul>`;
  }

  function showRoundSummary(text) {
    const el = $('round-summary');
    if (!el) return;
    if (!text) {
      el.classList.add('hidden');
      return;
    }
    el.textContent = text;
    el.classList.remove('hidden');
  }

  function renderHistory() {
    const list = $('history-list');
    if (!list) return;
    if (!state.history || !state.history.length) {
      list.innerHTML = '<li>No rolls yet</li>';
      return;
    }
    list.innerHTML = state.history
      .slice(0, 15)
      .map((h) => `<li>R${h.roundNumber}: ${h.d1}+${h.d2}=${h.sum}${h.isDouble ? ' (doubles)' : ''}</li>`)
      .join('');
  }

  function renderChat() {
    const container = $('chat-messages');
    if (!container) return;
    container.innerHTML = (state.chat || [])
      .map((m) => {
        const color = m.color && m.color !== 'null' ? m.color : PLAYER_COLORS[0];
        return `<div class="msg"><span class="name" style="color:${color}">${escapeHtml(m.playerName)}:</span> ${escapeHtml(m.text)}</div>`;
      })
      .join('');
    container.scrollTop = container.scrollHeight;
  }

  function connectSocket() {
    if (socket) socket.disconnect();
    socket = window.io?.();
    if (!socket) return;

    socket.on('error', (data) => toast(data.message || 'Error', true));

    socket.on('room-state', (data) => {
      state.roomCode = data.code;
      state.phase = data.phase;
      state.roundNumber = data.roundNumber || 0;
      state.lastRoll = data.lastRoll || null;
      state.roundEndsAt = data.roundEndsAt || null;
      state.players = data.players || [];
      state.ready = data.ready || [];
      state.settings = data.settings || null;
      state.winner = data.winner || null;
      state.chat = data.chat || [];
      state.history = data.history || [];
      state.myBets = [];
      state.mySideBets = {};
      updateGameUI();
      renderHistory();
      renderChat();
      if (state.phase === 'rolled' && data.lastRoll) {
        state.lastResults = [];
        showRollResults([]);
        showRoundSummary(state.summary || '');
        showDiceRoll(data.lastRoll.d1, data.lastRoll.d2, data.lastRoll.sum, false);
      }
      if (state.phase === 'betting' || state.phase === 'rolled') showScreen('screen-game');
    });

    socket.on('players-update', (data) => {
      state.players = data.players || [];
      state.ready = data.ready || [];
      renderLobbyPlayers();
      updateGameUI();
      if (data.kickedId === state.playerId) {
        clearReconnect();
        showScreen('screen-home');
        toast('You were kicked from the game.');
      }
    });

    socket.on('game-started', (data) => {
      state.phase = 'betting';
      state.roundNumber = data.roundNumber || 0;
      state.lastRoll = null;
      state.players = data.players || [];
      state.settings = data.settings || state.settings;
      state.myBets = [];
      state.mySideBets = {};
      state.winner = null;
      state.roundEndsAt = (data.roundEndsAt != null) ? data.roundEndsAt : (state.settings && state.settings.useTimer ? Date.now() + state.settings.roundTimerSec * 1000 : null);
      showScreen('screen-game');
      updateGameUI();
      renderHistory();
      if (window.DiceSounds && state.soundsEnabled) window.DiceSounds.newRound();
      toast('Game started! Place your bet.');
    });

    socket.on('bet-placed', (data) => {
      state.players = data.players || [];
      if (data.playerId === state.playerId) state.myBets.push({ number: data.number, amount: data.amount });
      updateGameUI();
    });

    socket.on('side-bet-placed', (data) => {
      state.players = data.players || [];
      if (data.playerId === state.playerId) state.mySideBets[data.type] = data.amount;
      updateGameUI();
    });

    socket.on('dice-rolled', (data) => {
      state.lastRoll = { d1: data.d1, d2: data.d2, sum: data.sum, isDouble: data.isDouble };
      state.phase = 'rolled';
      state.players = data.players || [];
      state.lastResults = data.results || [];
      state.summary = data.summary || '';
      state.myBets = [];
      state.mySideBets = {};
      state.winner = data.winner || null;
      showDiceRoll(data.d1, data.d2, data.sum, true);
      updateGameUI();
      showRollResults(state.lastResults);
      showRoundSummary(state.summary);
      if (state.history && state.lastRoll) {
        state.history.unshift({
          roundNumber: state.roundNumber,
          d1: data.d1,
          d2: data.d2,
          sum: data.sum,
          isDouble: data.isDouble
        });
        state.history = state.history.slice(0, 20);
      }
      renderHistory();
      const me = getMyPlayer();
      const iWon = state.lastResults.some((r) => r.playerId === state.playerId && r.won);
      if (window.DiceSounds && state.soundsEnabled) {
        if (state.winner) window.DiceSounds.gameOver();
        else if (iWon) window.DiceSounds.win();
        else if (state.lastResults.some((r) => r.playerId === state.playerId)) window.DiceSounds.lose();
      }
      toast(state.winner ? (state.winner.id === state.playerId ? 'You win!' : state.winner.name + ' wins!') : `Roll: ${data.d1}+${data.d2}=${data.sum}`);
    });

    socket.on('next-round', (data) => {
      state.phase = 'betting';
      state.roundNumber = data.roundNumber || 0;
      state.lastRoll = null;
      state.roundEndsAt = data.roundEndsAt || null;
      state.players = data.players || [];
      state.lastResults = [];
      state.summary = '';
      state.myBets = [];
      state.mySideBets = {};
      const rollResults = $('roll-results');
      if (rollResults) rollResults.classList.add('hidden');
      showRoundSummary('');
      updateGameUI();
      if (window.DiceSounds && state.soundsEnabled) window.DiceSounds.newRound();
      toast('New round — place your bet.');
    });

    socket.on('chat-message', (msg) => {
      state.chat = state.chat || [];
      state.chat.push(msg);
      if (state.chat.length > 100) state.chat.shift();
      renderChat();
    });

    socket.on('reaction', (r) => {
      const el = $('reactions-bar');
      const list = $('reactions-list');
      if (!el || !list) return;
      el.classList.remove('hidden');
      const span = document.createElement('span');
      span.textContent = `${r.playerName} ${r.emoji} `;
      span.style.marginRight = '0.5rem';
      list.appendChild(span);
      setTimeout(() => span.remove(), 3000);
    });

    socket.on('kicked', () => {
      clearReconnect();
      showScreen('screen-home');
      toast('You were kicked from the game.', true);
    });
  }

  function createGame() {
    const name = ($('create-name')?.value || 'Host').trim() || 'Host';
    const startingPoints = parseInt($('create-starting-points')?.value, 10) || 1000;
    const useTimer = $('create-use-timer')?.value === 'true';
    const roundTimerSec = parseInt($('create-timer-sec')?.value, 10) || 30;
    const betMin = parseInt($('create-bet-min')?.value, 10) || 10;
    const betMax = parseInt($('create-bet-max')?.value, 10) || 500;
    const winCondition = $('create-win-condition')?.value || 'first_to_target';
    const targetPoints = parseInt($('create-target')?.value, 10) || 2000;
    fetch('/api/room/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        playerName: name,
        startingPoints,
        useTimer,
        roundTimerSec,
        betMin,
        betMax,
        winCondition,
        targetPoints
      })
    })
      .then((r) => r.json())
      .then((data) => {
        state.roomCode = data.code;
        state.playerName = name;
        state.isHost = true;
        fetch('/api/room/join', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code: data.code, playerName: name })
        })
          .then((r) => r.json())
          .then((joinData) => {
            state.playerId = joinData.playerId;
            state.players = joinData.players || [];
            state.ready = joinData.ready || [];
            state.settings = joinData.settings || null;
            connectSocket();
            socket.emit('join-room', { code: data.code, playerId: state.playerId, playerName: name, color: state.playerColor });
            $('lobby-code').textContent = data.code;
            renderLobbyPlayers();
            renderColorSwatches();
            const startBtn = $('btn-start');
            if (startBtn) startBtn.style.display = '';
            showScreen('screen-lobby');
            saveReconnect();
            toast('Room created. Share the code with friends.');
          });
      })
      .catch(() => toast('Could not create room', true));
  }

  function joinGame() {
    const code = ($('join-code')?.value || '').trim().toUpperCase();
    const name = ($('join-name')?.value || '').trim() || 'Player';
    if (!code) return toast('Enter room code', true);
    const stored = (() => {
      try {
        const s = localStorage.getItem(STORAGE_KEY);
        return s ? JSON.parse(s) : null;
      } catch (e) { return null; }
    })();
    const body = { code, playerName: name };
    if (stored && stored.roomCode === code && stored.playerName === name && stored.playerId) body.playerId = stored.playerId;
    fetch('/api/room/join', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    })
      .then((r) => r.json())
      .then((data) => {
        if (data.error) return toast(data.error, true);
        state.roomCode = data.code;
        state.playerId = data.playerId;
        state.playerName = data.playerName || name;
        state.players = data.players || [];
        state.ready = data.ready || [];
        state.settings = data.settings || null;
        state.isHost = false;
        connectSocket();
        socket.emit('join-room', { code: data.code, playerId: state.playerId, playerName: state.playerName, color: state.playerColor });
        $('lobby-code').textContent = data.code;
        renderLobbyPlayers();
        renderColorSwatches();
        const startBtn = $('btn-start');
        if (startBtn) startBtn.style.display = 'none';
        showScreen('screen-lobby');
        saveReconnect();
        toast(data.reconnected ? 'Reconnected!' : 'Joined! Waiting for host to start.');
      })
      .catch(() => toast('Could not join room', true));
  }

  function setReady(ready) {
    state.ready = state.ready.map(([pid, r]) => [pid, pid === state.playerId ? ready : r]);
    socket.emit('set-ready', { code: state.roomCode, playerId: state.playerId, ready });
    const btn = $('btn-ready');
    if (btn) btn.textContent = isReady(state.playerId) ? 'Not ready' : "I'm ready";
  }

  function startGame() {
    if (!state.isHost) return;
    socket.emit('start-game', state.roomCode);
  }

  function placeBet() {
    const amount = parseInt($('bet-amount')?.value, 10) || 0;
    if (!state.selectedBetNumber || amount <= 0) return toast('Select a number and amount', true);
    const me = getMyPlayer();
    if (me && me.points < amount) return toast('Not enough points', true);
    if (state.settings && (amount < state.settings.betMin || amount > state.settings.betMax)) return toast('Bet outside limits', true);
    if (state.myBets.length >= 3) return toast('Max 3 number bets per round', true);
    socket.emit('place-bet', {
      code: state.roomCode,
      playerId: state.playerId,
      number: state.selectedBetNumber,
      amount
    });
    state.myBets.push({ number: state.selectedBetNumber, amount });
    state.selectedBetNumber = null;
    state.currentBetAmount = '';
    if ($('bet-amount')) $('bet-amount').value = '';
    $all('.bet-num').forEach((b) => b.classList.remove('selected'));
    updateBetPreview();
    toast('Bet placed.');
  }

  function roll() {
    socket.emit('roll', state.roomCode);
  }

  function nextRound() {
    socket.emit('next-round', state.roomCode);
  }

  function leaveGame() {
    if (!confirm('Leave this game?')) return;
    socket.emit('leave-game', state.roomCode);
    clearReconnect();
    showScreen('screen-home');
    state.roomCode = null;
    state.playerId = null;
    toast('Left the game.');
  }

  function sendChat() {
    const input = $('chat-input');
    const text = (input?.value || '').trim();
    if (!text) return;
    socket.emit('chat', { code: state.roomCode, playerId: state.playerId, message: text });
    input.value = '';
  }

  $('btn-create')?.addEventListener('click', createGame);
  $('btn-join')?.addEventListener('click', joinGame);
  $('btn-copy-code')?.addEventListener('click', () => {
    if (state.roomCode) {
      navigator.clipboard.writeText(state.roomCode);
      toast('Room code copied');
    }
  });
  $('btn-ready')?.addEventListener('click', () => setReady(!isReady(state.playerId)));
  $('btn-start')?.addEventListener('click', startGame);
  $('btn-roll')?.addEventListener('click', roll);
  $('btn-next-round')?.addEventListener('click', nextRound);
  $('btn-place-bet')?.addEventListener('click', placeBet);
  $('side-bets-grid')?.addEventListener('click', (e) => {
    const btn = e.target.closest('.side-bet-btn');
    if (!btn || btn.disabled) return;
    placeSideBet(btn.dataset.type);
  });
  $('btn-leave-game')?.addEventListener('click', leaveGame);
  $('btn-back-lobby')?.addEventListener('click', () => {
    state.winner = null;
    showScreen('screen-home');
    clearReconnect();
  });
  $('btn-chat-send')?.addEventListener('click', sendChat);
  $('chat-input')?.addEventListener('keydown', (e) => { if (e.key === 'Enter') sendChat(); });

  $all('.btn-emoji')?.forEach((btn) => {
    btn.addEventListener('click', () => {
      socket.emit('reaction', { code: state.roomCode, playerId: state.playerId, emoji: btn.dataset.emoji });
    });
  });

  $all('.tab').forEach((t) => {
    t.addEventListener('click', () => {
      const tab = t.dataset.tab;
      $all('.tab').forEach((x) => x.classList.toggle('active', x.dataset.tab === tab));
      $all('.panel').forEach((p) => p.classList.toggle('active', p.id === 'panel-' + tab));
    });
  });

  $('bet-amount')?.addEventListener('input', (e) => {
    state.currentBetAmount = e.target.value;
    updateBetPreview();
    const amount = parseInt(state.currentBetAmount, 10) || 0;
    const valid = state.settings ? amount >= state.settings.betMin && amount <= state.settings.betMax : amount > 0;
    $('btn-place-bet').disabled = state.phase !== 'betting' || !state.selectedBetNumber || !valid || state.myBets.length >= 3;
  });

  function checkReconnectPrompt() {
    try {
      const s = localStorage.getItem(STORAGE_KEY);
      const data = s ? JSON.parse(s) : null;
      const prompt = $('reconnect-prompt');
      const codeEl = $('reconnect-code');
      if (data && data.roomCode && data.playerId && prompt && codeEl) {
        prompt.classList.remove('hidden');
        codeEl.textContent = data.roomCode;
      } else if (prompt) {
        prompt.classList.add('hidden');
      }
    } catch (e) {}
  }

  $('btn-reconnect')?.addEventListener('click', () => {
    try {
      const s = localStorage.getItem(STORAGE_KEY);
      const data = s ? JSON.parse(s) : null;
      if (!data || !data.roomCode || !data.playerId) return toast('No previous game to reconnect', true);
      fetch('/api/room/reconnect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: data.roomCode, playerId: data.playerId })
      })
        .then((r) => r.json())
        .then((resp) => {
          if (resp.error) {
            clearReconnect();
            checkReconnectPrompt();
            return toast(resp.error, true);
          }
          state.roomCode = resp.code;
          state.playerId = resp.playerId;
          state.playerName = data.playerName || 'Player';
          state.players = resp.players || [];
          state.ready = resp.ready || [];
          state.phase = resp.phase;
          state.roundNumber = resp.roundNumber || 0;
          state.lastRoll = resp.lastRoll || null;
          state.roundEndsAt = resp.roundEndsAt || null;
          state.settings = resp.settings || null;
          state.winner = resp.winner || null;
          state.chat = resp.chat || [];
          state.history = resp.history || [];
          state.myBets = [];
          state.mySideBets = {};
          state.isHost = resp.hostId === resp.playerId;
          connectSocket();
          socket.emit('join-room', { code: state.roomCode, playerId: state.playerId, playerName: state.playerName, color: state.playerColor });
          showScreen('screen-game');
          updateGameUI();
          renderHistory();
          renderChat();
          if (state.phase === 'rolled' && state.lastRoll) {
            showDiceRoll(state.lastRoll.d1, state.lastRoll.d2, state.lastRoll.sum, false);
            showRoundSummary(state.summary || '');
          }
          toast('Reconnected!');
        })
        .catch(() => toast('Reconnect failed', true));
    } catch (e) {
      toast('Reconnect failed', true);
    }
  });

  loadPayouts();
  checkReconnectPrompt();
})();
