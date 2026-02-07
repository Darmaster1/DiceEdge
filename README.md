# Dice Edge

A multiplayer dice staking game for the web. Everyone starts with points (e.g. 1000), stakes on numbers 2–12 (sum of two dice) and optional side bets. Payouts follow true odds; lower probability means higher reward.

## How to run

1. Install dependencies:
   ```bash
   npm install
   ```
2. Start the server:
   ```bash
   npm start
   ```
3. Open **http://localhost:3000** in your browser.

## How to play

1. **Create game** – Enter your name, set game options (starting points, round timer, bet limits, win condition), then "Create game". You get a 6-character room code.
2. **Share the code** – Friends open the same site, choose "Join game", enter the code and their name.
3. **Lobby** – Pick a color, click "I'm ready". Host can kick players. When ready, host clicks "Start game".
4. **Place bets** – Each round you can place up to 3 number bets (2–12) and optional side bets (Doubles, Over 7, Under 7, Exactly 7). Respect min/max bet limits.
5. **Timer** – If the round timer is on, bets close automatically when time runs out and the dice roll.
6. **Roll** – Anyone can click "Roll dice". Two dice are rolled; the sum (and side outcomes) settle all bets.
7. **Next round** – Click "Next round" and place bets again. First to reach the target (or last standing in elimination mode) wins the game.

## Features

- **Lobby:** Game settings (starting points, round timer, min/max bet, win condition, target points), ready-up, player colors, kick (host only).
- **Betting:** Up to 3 number bets per round, side bets (Doubles 6×, Over 7 / Under 7 ~2.4×, Exactly 7 6×), bet limits.
- **Round timer:** Optional countdown; auto-roll when time runs out.
- **Win conditions:** First to target points, or elimination (last with points).
- **Chat:** In-room text chat.
- **Reactions:** Quick emoji reactions after a roll.
- **History:** Roll history and round summary after each roll.
- **Dice animation & sounds:** Roll animation and optional sound effects.
- **Reconnect:** Reconnect to the same game after refresh or disconnect (player stays in room; use "Reconnect" on home or re-join with same code/name).
- **Leave / Kick:** Leave game button; host can kick players.

## Payout table (sum of 2 dice)

| Sum | Ways | Probability | Payout |
|-----|------|-------------|--------|
| 2 or 12 | 1 | 2.8% | 36× |
| 3 or 11 | 2 | 5.6% | 18× |
| 4 or 10 | 3 | 8.3% | 12× |
| 5 or 9 | 4 | 11.1% | 9× |
| 6 or 8 | 5 | 13.9% | 7.2× |
| 7 | 6 | 16.7% | 6× |

## Tech

- **Backend:** Node.js, Express, Socket.io (real-time updates).
- **Frontend:** Vanilla JS, HTML, CSS (sounds via Web Audio API).
- **Game state:** In-memory (rooms and players); no database.
