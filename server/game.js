/**
 * Dice game logic: main bets (2–12), side bets, payouts.
 */

const WAYS = {
  2: 1, 3: 2, 4: 3, 5: 4, 6: 5, 7: 6, 8: 5, 9: 4, 10: 3, 11: 2, 12: 1
};

const MULTIPLIERS = {};
for (const [sum, ways] of Object.entries(WAYS)) {
  MULTIPLIERS[sum] = 36 / ways;
}

// Side bets: type -> multiplier (fair odds). Win condition in getSideBetPayout.
const SIDE_BET_MULTIPLIERS = {
  doubles: 6,        // 6/36 - both dice same
  over7: 36 / 15,    // 15 ways sum > 7
  under7: 36 / 15,   // 15 ways sum < 7
  exactly7: 6,      // 6/36
  any_craps: 9,     // 2, 3, or 12 = 4 ways
  hard_6: 36,       // 3+3 only = 1 way
  hard_8: 36,       // 4+4 only = 1 way
  hard_10: 36,      // 5+5 only = 1 way
  snake_eyes: 36,   // 1+1 = 2 only
  boxcars: 36       // 6+6 = 12 only
};

function rollDice() {
  const d1 = 1 + Math.floor(Math.random() * 6);
  const d2 = 1 + Math.floor(Math.random() * 6);
  const sum = d1 + d2;
  const isDouble = d1 === d2;
  return { d1, d2, sum, isDouble };
}

function getPayout(betAmount, chosenSum, actualSum) {
  if (chosenSum !== actualSum) return 0;
  const mult = MULTIPLIERS[chosenSum];
  return Math.floor(betAmount * mult);
}

function getSideBetPayout(type, amount, roll) {
  const { d1, d2, sum, isDouble } = roll;
  let win = false;
  switch (type) {
    case 'doubles': win = isDouble; break;
    case 'over7': win = sum > 7; break;
    case 'under7': win = sum < 7; break;
    case 'exactly7': win = sum === 7; break;
    case 'any_craps': win = sum === 2 || sum === 3 || sum === 12; break;
    case 'hard_6': win = d1 === 3 && d2 === 3; break;
    case 'hard_8': win = d1 === 4 && d2 === 4; break;
    case 'hard_10': win = d1 === 5 && d2 === 5; break;
    case 'snake_eyes': win = sum === 2; break;
    case 'boxcars': win = sum === 12; break;
    default: return 0;
  }
  if (!win) return 0;
  const mult = SIDE_BET_MULTIPLIERS[type];
  return Math.floor(amount * mult);
}

function getMultiplier(sum) {
  return MULTIPLIERS[sum];
}

function getProbability(sum) {
  const ways = WAYS[sum];
  return { ways, pct: ((ways / 36) * 100).toFixed(1) };
}

const SIDE_BET_LABELS = {
  doubles: 'Doubles',
  over7: 'Over 7',
  under7: 'Under 7',
  exactly7: 'Exactly 7',
  any_craps: 'Any Craps',
  hard_6: 'Hard 6',
  hard_8: 'Hard 8',
  hard_10: 'Hard 10',
  snake_eyes: 'Snake Eyes',
  boxcars: 'Boxcars'
};

function getSideBetInfo() {
  return Object.entries(SIDE_BET_MULTIPLIERS).map(([type, mult]) => ({
    type,
    multiplier: Number(mult) === Math.floor(mult) ? mult : Math.round(mult * 10) / 10,
    label: SIDE_BET_LABELS[type] || type
  }));
}

module.exports = {
  WAYS,
  MULTIPLIERS,
  SIDE_BET_MULTIPLIERS,
  rollDice,
  getPayout,
  getSideBetPayout,
  getMultiplier,
  getProbability,
  getSideBetInfo
};
