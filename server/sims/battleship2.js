/* Battleship — two players, hidden fleets.

   Uses viewFor(): each player is sent their own board in full and only the
   SHOTS they have taken at the enemy. The enemy's ship layout never leaves
   the server until the game ends, so no client can read it off the wire. */
'use strict';

const SIZE = 10;
const FLEET = [
  { name: 'Carrier', len: 5 },
  { name: 'Battleship', len: 4 },
  { name: 'Cruiser', len: 3 },
  { name: 'Submarine', len: 3 },
  { name: 'Destroyer', len: 2 },
];

function blankBoard() {
  return {
    ships: [],                                            // {name,len,cells,hits}
    grid: Array.from({ length: SIZE }, () => Array(SIZE).fill(null)),
    shots: Array.from({ length: SIZE }, () => Array(SIZE).fill(false)),
    ready: false,
  };
}

function battleship2(roster) {
  const seats = roster.slice(0, 2).map((p) => p.id);
  const names = Object.fromEntries(roster.map((p) => [p.id, p.name]));
  const boards = { [seats[0]]: blankBoard(), [seats[1]]: blankBoard() };
  let phase = 'place';      // place -> battle -> over
  let turn = 0;
  let winner = null;
  const log = [];

  const other = (id) => seats.find((s) => s !== id);

  function cellsFor(x, y, len, horiz) {
    const out = [];
    for (let i = 0; i < len; i++) out.push(horiz ? { x: x + i, y } : { x, y: y + i });
    return out;
  }

  function placeFleet(id, list) {
    const b = boards[id];
    if (!b) return { error: 'not a player' };
    if (b.ready) return { error: 'fleet already placed' };
    if (!Array.isArray(list) || list.length !== FLEET.length) {
      return { error: 'need exactly ' + FLEET.length + ' ships' };
    }
    const grid = Array.from({ length: SIZE }, () => Array(SIZE).fill(null));
    const ships = [];
    for (let i = 0; i < FLEET.length; i++) {
      const spec = FLEET[i], s = list[i] || {};
      const x = Number(s.x), y = Number(s.y), horiz = !!s.horiz;
      if (!Number.isInteger(x) || !Number.isInteger(y)) return { error: 'bad coordinates' };
      const cells = cellsFor(x, y, spec.len, horiz);
      for (const c of cells) {
        if (c.x < 0 || c.x >= SIZE || c.y < 0 || c.y >= SIZE) return { error: spec.name + ' is off the grid' };
        if (grid[c.y][c.x] !== null) return { error: spec.name + ' overlaps another ship' };
      }
      cells.forEach((c) => { grid[c.y][c.x] = i; });
      ships.push({ name: spec.name, len: spec.len, cells, hits: 0, sunk: false });
    }
    b.grid = grid;
    b.ships = ships;
    b.ready = true;
    if (seats.every((sid) => boards[sid].ready)) phase = 'battle';
    return { ok: true };
  }

  function fire(id, x, y) {
    if (phase !== 'battle') return { error: 'not firing yet' };
    if (id !== seats[turn]) return { error: 'not your turn' };
    if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || x >= SIZE || y < 0 || y >= SIZE) {
      return { error: 'off the grid' };
    }
    const foe = boards[other(id)];
    if (foe.shots[y][x]) return { error: 'already fired there' };
    foe.shots[y][x] = true;

    const si = foe.grid[y][x];
    if (si === null) {
      log.push({ by: id, x, y, hit: false });
      turn = 1 - turn;                                  // miss hands over
      return { ok: true };
    }
    const ship = foe.ships[si];
    ship.hits++;
    const sunk = ship.hits >= ship.len;
    if (sunk) ship.sunk = true;
    log.push({ by: id, x, y, hit: true, sunk: sunk ? ship.name : null });
    if (foe.ships.every((s) => s.sunk)) { winner = id; phase = 'over'; }
    return { ok: true };                                 // a hit keeps the turn
  }

  /* what a given player is allowed to see */
  function viewFor(id) {
    const meB = boards[id], foeId = other(id), foeB = boards[foeId];
    const spectator = !meB;
    const base = {
      size: SIZE, fleet: FLEET.map((f) => f.name), phase, turn, seats, names,
      winner, log: log.slice(-6),
      youReady: spectator ? false : meB.ready,
      foeReady: foeB ? foeB.ready : false,
    };
    if (spectator) {
      // spectators see shot maps only — never either fleet
      return { ...base, spectator: true,
        you: null,
        foe: { shots: foeB ? foeB.shots : null } };
    }
    return {
      ...base,
      spectator: false,
      you: {
        ships: meB.ships.map((s) => ({ name: s.name, len: s.len, cells: s.cells, sunk: s.sunk })),
        shots: meB.shots,                                 // where the enemy fired at me
      },
      foe: {
        shots: foeB.shots,                                // where I fired
        // reveal a cell's contents only once I have fired at it
        hits: foeB.shots.map((row, y) => row.map((fired, x) =>
          fired ? (foeB.grid[y][x] !== null ? 1 : 0) : -1)),
        sunk: foeB.ships.filter((s) => s.sunk).map((s) => ({ name: s.name, cells: s.cells })),
        remaining: foeB.ships.filter((s) => !s.sunk).length,
      },
    };
  }

  return {
    init: () => ({ size: SIZE, fleet: FLEET, seats, names }),
    viewFor,
    addPlayer(id, name) { names[id] = name; },
    removePlayer(id) {
      if (seats.includes(id) && winner === null) { winner = other(id); phase = 'over'; }
    },
    move(id, d) {
      if (winner !== null) return { error: 'game over' };
      if (!d) return { error: 'empty move' };
      if (d.place) return placeFleet(id, d.place);
      if (phase === 'place') return { error: 'waiting for both fleets' };
      return fire(id, Number(d.x), Number(d.y));
    },
    finished: () => winner !== null,
    result: () => ({ winner, names }),
  };
}

module.exports = {
  name: 'Battleship', min: 2, max: 2, sync: 'relay', joinInProgress: true,
  blurb: 'Hide your fleet, hunt theirs. A hit lets you fire again.',
  make: battleship2,
};
