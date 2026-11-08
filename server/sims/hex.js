/* Hex — 11x11 rhombus. Red joins top to bottom, Blue joins left to right.
   Hex cannot draw: when the board fills, exactly one connection exists. */
'use strict';
const N = 11;
// axial neighbours on a rhombus board
const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, -1], [-1, 1]];

function hex(roster) {
  const seats = roster.slice(0, 2).map((p) => p.id);
  const names = Object.fromEntries(roster.map((p) => [p.id, p.name]));
  const cells = Array.from({ length: N }, () => Array(N).fill(0));
  let turn = 0, winner = null, path = null, moves = 0;
  const history = [];

  function at(x, y) { return (x >= 0 && x < N && y >= 0 && y < N) ? cells[y][x] : -1; }

  /* Flood from one edge; if we reach the far edge the player has connected.
     Returns the winning chain so the client can draw it. */
  function connected(who) {
    const seen = new Set();
    const stack = [];
    for (let i = 0; i < N; i++) {
      // red (1) starts on the top row, blue (2) on the left column
      const sx = who === 1 ? i : 0;
      const sy = who === 1 ? 0 : i;
      if (at(sx, sy) === who) { stack.push([sx, sy, null]); }
    }
    const from = new Map();
    while (stack.length) {
      const [x, y, prev] = stack.pop();
      const k = y * N + x;
      if (seen.has(k)) continue;
      seen.add(k);
      from.set(k, prev);
      const done = who === 1 ? y === N - 1 : x === N - 1;
      if (done) {
        const chain = [];
        let cur = k;
        while (cur !== null && cur !== undefined) {
          chain.push([cur % N, Math.floor(cur / N)]);
          cur = from.get(cur);
        }
        return chain;
      }
      for (const [dx, dy] of DIRS) {
        const nx = x + dx, ny = y + dy;
        if (at(nx, ny) === who && !seen.has(ny * N + nx)) stack.push([nx, ny, k]);
      }
    }
    return null;
  }

  return {
    init: () => ({ n: N, seats, names }),
    view: () => ({ n: N, cells, turn, seats, names, winner, path, moves, last: history[history.length - 1] || null }),
    addPlayer(id, name) { names[id] = name; },
    removePlayer(id) {
      if (seats.includes(id) && winner === null) winner = seats.find((s) => s !== id) ?? 'abandoned';
    },
    move(id, d) {
      if (winner !== null) return { error: 'game over' };
      if (id !== seats[turn]) return { error: 'not your turn' };
      const x = Number(d && d.x), y = Number(d && d.y);
      if (!Number.isInteger(x) || !Number.isInteger(y) || at(x, y) === -1) return { error: 'off board' };
      if (cells[y][x] !== 0) return { error: 'already taken' };
      const who = turn + 1;
      cells[y][x] = who;
      history.push([x, y]);
      moves++;
      const chain = connected(who);
      if (chain) { winner = seats[turn]; path = chain; }
      else turn = 1 - turn;
      return { ok: true };
    },
    finished: () => winner !== null,
    result: () => ({ winner, names, path }),
  };
}

module.exports = {
  name: 'Hex', min: 2, max: 2, sync: 'relay', joinInProgress: true,
  blurb: 'Connect your two sides before they connect theirs. No draws, ever.',
  make: hex,
};
