'use strict';

/* ======================= Connect Four (relay, 2P) ======================= */
const C4_W = 7, C4_H = 6;

function connectFour(roster) {
  const seats = roster.slice(0, 2).map((p) => p.id);
  const names = Object.fromEntries(roster.map((p) => [p.id, p.name]));
  const grid = Array.from({ length: C4_H }, () => Array(C4_W).fill(0));
  let turn = 0, winner = null, line = null, moves = 0;

  function at(x, y) { return (x >= 0 && x < C4_W && y >= 0 && y < C4_H) ? grid[y][x] : -1; }

  function winFrom(x, y, who) {
    const dirs = [[1, 0], [0, 1], [1, 1], [1, -1]];
    for (const [dx, dy] of dirs) {
      const cells = [[x, y]];
      for (const s of [1, -1]) {
        for (let k = 1; k < 4; k++) {
          const nx = x + dx * k * s, ny = y + dy * k * s;
          if (at(nx, ny) !== who) break;
          cells.push([nx, ny]);
        }
      }
      if (cells.length >= 4) return cells;
    }
    return null;
  }

  return {
    init: () => ({ w: C4_W, h: C4_H, seats, names }),
    view: () => ({ grid, turn, seats, names, winner, line, moves }),
    addPlayer(id, name) { names[id] = name; },           // spectators welcome
    removePlayer(id) {
      if (seats.includes(id) && winner === null) winner = seats.find((s) => s !== id) ?? 'abandoned';
    },
    move(id, d) {
      if (winner !== null) return { error: 'game over' };
      if (id !== seats[turn]) return { error: 'not your turn' };
      const x = Number(d && d.col);
      if (!Number.isInteger(x) || x < 0 || x >= C4_W) return { error: 'bad column' };
      let y = -1;
      for (let r = C4_H - 1; r >= 0; r--) if (!grid[r][x]) { y = r; break; }
      if (y < 0) return { error: 'column full' };
      const who = turn + 1;
      grid[y][x] = who;
      moves++;
      const w = winFrom(x, y, who);
      if (w) { winner = seats[turn]; line = w; }
      else if (moves >= C4_W * C4_H) winner = 'draw';
      else turn = 1 - turn;
      return { ok: true };
    },
    finished: () => winner !== null,
    result: () => ({ winner, names, line }),
  };
}

module.exports = {
  name: 'Connect Four', min: 2, max: 2, sync: 'relay', joinInProgress: true,
  blurb: 'Drop discs, make four in a row. Spectators welcome.',
  make: connectFour,
};
