/* Ultimate Tic-Tac-Toe — nine boards in a grid. Your move inside a small
   board sends your opponent to the board in that position. If that board is
   already decided, they may play anywhere. Win three small boards in a line. */
'use strict';
const LINES = [
  [0, 1, 2], [3, 4, 5], [6, 7, 8],
  [0, 3, 6], [1, 4, 7], [2, 5, 8],
  [0, 4, 8], [2, 4, 6],
];

function winnerOf(cells) {
  for (const [a, b, c] of LINES) {
    if (cells[a] && cells[a] === cells[b] && cells[a] === cells[c]) return { who: cells[a], line: [a, b, c] };
  }
  return cells.every((c) => c) ? { who: 'draw', line: null } : null;
}

function uttt(roster) {
  const seats = roster.slice(0, 2).map((p) => p.id);
  const names = Object.fromEntries(roster.map((p) => [p.id, p.name]));
  const boards = Array.from({ length: 9 }, () => Array(9).fill(0));
  const won = Array(9).fill(0);        // 0 none, 1/2 player, 3 drawn
  const wonLine = Array(9).fill(null);
  let turn = 0, active = -1, winner = null, bigLine = null, last = null;

  function playable(b) { return won[b] === 0 && boards[b].some((c) => !c); }

  return {
    init: () => ({ seats, names }),
    view: () => ({ boards, won, wonLine, turn, active, seats, names, winner, bigLine, last }),
    addPlayer(id, name) { names[id] = name; },
    removePlayer(id) {
      if (seats.includes(id) && winner === null) winner = seats.find((s) => s !== id) ?? 'abandoned';
    },
    move(id, d) {
      if (winner !== null) return { error: 'game over' };
      if (id !== seats[turn]) return { error: 'not your turn' };
      const b = Number(d && d.b), c = Number(d && d.c);
      if (!Number.isInteger(b) || !Number.isInteger(c) || b < 0 || b > 8 || c < 0 || c > 8) {
        return { error: 'bad square' };
      }
      if (active !== -1 && b !== active) return { error: 'you must play in the highlighted board' };
      if (won[b] !== 0) return { error: 'that board is finished' };
      if (boards[b][c] !== 0) return { error: 'already taken' };

      const who = turn + 1;
      boards[b][c] = who;
      last = { b, c };

      const w = winnerOf(boards[b]);
      if (w) {
        won[b] = w.who === 'draw' ? 3 : w.who;
        wonLine[b] = w.line;
        const big = winnerOf(won.map((v) => (v === 1 || v === 2 ? v : 0)));
        if (big && big.who !== 'draw') { winner = seats[big.who - 1]; bigLine = big.line; }
        else if (won.every((v) => v !== 0)) winner = 'draw';
      }

      // send the opponent to the matching board, or set them free
      active = playable(c) ? c : -1;
      if (winner === null) turn = 1 - turn;
      return { ok: true };
    },
    finished: () => winner !== null,
    result: () => ({ winner, names, bigLine }),
  };
}

module.exports = {
  name: 'Ultimate Tic-Tac-Toe', min: 2, max: 2, sync: 'relay', joinInProgress: true,
  blurb: 'Nine boards. Your move decides where they must play next.',
  make: uttt,
};
