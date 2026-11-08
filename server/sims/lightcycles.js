/* Light Cycles — grid trails, 2-6 riders. Turn, never stop, never cross.
   Grid-stepped rather than free-moving so trails are exact and collisions
   are unambiguous. */
'use strict';
const GW = 140, GH = 90;
const STEP = 1 / 15;              // cells per second comes from the tick rate
const DIRS = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
const OPP = { up: 'down', down: 'up', left: 'right', right: 'left' };

function lightcycles(roster) {
  const P = new Map();
  let acc = 0, over = false, placing = [], t = 0;
  const grid = new Uint8Array(GW * GH);          // 0 free, else rider index+1

  function spawn(id, name, i, n) {
    // ring the riders around the arena facing inward
    const slots = [
      { x: 10, y: Math.floor(GH / 2), d: 'right' },
      { x: GW - 11, y: Math.floor(GH / 2), d: 'left' },
      { x: Math.floor(GW / 2), y: 8, d: 'down' },
      { x: Math.floor(GW / 2), y: GH - 9, d: 'up' },
      { x: 18, y: 14, d: 'right' },
      { x: GW - 19, y: GH - 15, d: 'left' },
    ];
    const s = slots[i % slots.length];
    P.set(id, { id, name, x: s.x, y: s.y, dir: s.d, next: s.d,
                alive: true, hue: (i * 61) % 360, trail: [[s.x, s.y]], idx: i + 1 });
    grid[s.y * GW + s.x] = i + 1;
  }
  [...roster].forEach((p, i) => spawn(p.id, p.name, i, roster.length));

  return {
    init: () => ({ w: GW, h: GH,
      players: [...P.values()].map((p) => ({ id: p.id, name: p.name, hue: p.hue })) }),
    addPlayer() {},                           // closed once running
    removePlayer(id) {
      const p = P.get(id);
      if (p && p.alive) { p.alive = false; placing.push(id); }
      P.delete(id);
    },
    input(id, d) {
      const p = P.get(id);
      if (!p || !p.alive || !d || !DIRS[d.dir]) return;
      if (d.dir === OPP[p.dir]) return;        // no instant reverse
      p.next = d.dir;
    },
    step(dt) {
      if (over) return null;
      t += dt;
      acc += dt;
      let moved = false;
      while (acc >= STEP) {
        acc -= STEP;
        moved = true;
        const live = [...P.values()].filter((p) => p.alive);
        const wants = new Map();
        for (const p of live) {
          p.dir = p.next;
          const [dx, dy] = DIRS[p.dir];
          wants.set(p.id, [p.x + dx, p.y + dy]);
        }
        // head-on collisions: two riders claiming the same cell both die
        const counts = new Map();
        for (const [, c] of wants) {
          const k = c[1] * GW + c[0];
          counts.set(k, (counts.get(k) || 0) + 1);
        }
        for (const p of live) {
          const [nx, ny] = wants.get(p.id);
          const k = ny * GW + nx;
          const oob = nx < 0 || nx >= GW || ny < 0 || ny >= GH;
          if (oob || grid[k] !== 0 || counts.get(k) > 1) {
            p.alive = false;
            placing.push(p.id);
            continue;
          }
          p.x = nx; p.y = ny;
          grid[k] = p.idx;
          p.trail.push([nx, ny]);
        }
        const standing = [...P.values()].filter((p) => p.alive);
        if (P.size > 1 && standing.length <= 1) { over = true; break; }
        if (P.size === 1 && standing.length === 0) { over = true; break; }
      }
      if (!moved) return null;
      return {
        t: Math.round(t * 10) / 10,
        p: [...P.values()].map((p) => [p.id, p.x, p.y, p.alive ? 1 : 0, p.trail.length]),
        // send only the newest trail cell per rider; clients accumulate
        add: [...P.values()].filter((p) => p.alive).map((p) => [p.id, p.x, p.y]),
      };
    },
    finished: () => over,
    result: () => {
      const alive = [...P.values()].filter((p) => p.alive);
      const order = [...alive.map((p) => p.id), ...placing.slice().reverse()];
      return {
        winner: alive.length ? alive[0].id : null,
        standings: order.map((id, i) => {
          const p = P.get(id);
          return { place: i + 1, id, name: p ? p.name : '?' };
        }),
      };
    },
  };
}

module.exports = {
  name: 'Light Cycles', min: 2, max: 6, sync: 'tick', joinInProgress: false,
  blurb: 'Leave a wall behind you. Last rider standing wins.',
  make: lightcycles,
};
