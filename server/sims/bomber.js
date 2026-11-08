/* Bomber Grid — classic bomb-and-blast. Grid-based so blasts are exact.
   Walls are permanent, crates break and sometimes drop a pickup. */
'use strict';
const GW = 15, GH = 13;          // odd dimensions so the pillar lattice works
const FUSE = 2.4, BLAST_T = 0.45;
const WALL = 1, CRATE = 2;
const SPAWNS = [[1,1],[GW-2,1],[1,GH-2],[GW-2,GH-2],[Math.floor(GW/2),1],[Math.floor(GW/2),GH-2]];

function bomber(roster) {
  const P = new Map();
  const grid = new Uint8Array(GW * GH);
  const bombs = [];            // {x,y,by,t,range}
  const fires = [];            // {x,y,t}
  const items = [];            // {x,y,kind}
  let over = false, placing = [], t = 0;
  const at = (x, y) => (x >= 0 && x < GW && y >= 0 && y < GH) ? grid[y * GW + x] : WALL;
  const set = (x, y, v) => { grid[y * GW + x] = v; };

  // lattice of pillars, crates scattered between, spawn corners kept clear
  for (let y = 0; y < GH; y++) for (let x = 0; x < GW; x++) {
    if (x === 0 || y === 0 || x === GW - 1 || y === GH - 1) set(x, y, WALL);
    else if (x % 2 === 0 && y % 2 === 0) set(x, y, WALL);
    else if (Math.random() < 0.58) set(x, y, CRATE);
  }
  for (const [sx, sy] of SPAWNS) {
    [[0,0],[1,0],[0,1],[-1,0],[0,-1]].forEach(([dx,dy]) => {
      const x = sx + dx, y = sy + dy;
      if (at(x, y) === CRATE) set(x, y, 0);
    });
  }

  roster.forEach((p, i) => {
    const [x, y] = SPAWNS[i % SPAWNS.length];
    P.set(p.id, { id: p.id, name: p.name, x, y, alive: true, hue: (i * 67) % 360,
                  bombs: 1, range: 2, live: 0, moveCd: 0, kills: 0 });
  });

  function explode(b) {
    const hit = [[b.x, b.y]];
    for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
      for (let r = 1; r <= b.range; r++) {
        const x = b.x + dx * r, y = b.y + dy * r;
        const c = at(x, y);
        if (c === WALL) break;
        hit.push([x, y]);
        if (c === CRATE) {
          set(x, y, 0);
          if (Math.random() < 0.35) {
            items.push({ x, y, kind: Math.random() < 0.5 ? 'range' : 'bomb' });
          }
          break;
        }
      }
    }
    for (const [x, y] of hit) {
      fires.push({ x, y, t: BLAST_T });
      // chain reaction
      const other = bombs.find((o) => o !== b && !o.done && o.x === x && o.y === y);
      if (other) { other.t = 0; }
      for (const p of P.values()) {
        if (p.alive && p.x === x && p.y === y) {
          p.alive = false;
          placing.push(p.id);
          const k = P.get(b.by);
          if (k && k !== p) k.kills++;
        }
      }
    }
    const owner = P.get(b.by);
    if (owner) owner.live--;
    b.done = true;
  }

  return {
    init: () => ({ w: GW, h: GH, grid: Array.from(grid),
      players: [...P.values()].map((p) => ({ id: p.id, name: p.name, hue: p.hue })) }),
    addPlayer() {},
    removePlayer(id) {
      const p = P.get(id);
      if (p && p.alive) { p.alive = false; placing.push(id); }
      P.delete(id);
    },
    input(id, d) {
      const p = P.get(id);
      if (!p || !p.alive || !d) return;
      if (d.bomb) {
        if (p.live < p.bombs && !bombs.some((b) => !b.done && b.x === p.x && b.y === p.y)) {
          bombs.push({ x: p.x, y: p.y, by: id, t: FUSE, range: p.range, done: false });
          p.live++;
        }
        return;
      }
      if (p.moveCd > 0) return;
      const DIR = { up: [0,-1], down: [0,1], left: [-1,0], right: [1,0] };
      const v = DIR[d.dir];
      if (!v) return;
      const nx = p.x + v[0], ny = p.y + v[1];
      if (at(nx, ny) !== 0) return;
      if (bombs.some((b) => !b.done && b.x === nx && b.y === ny)) return;
      p.x = nx; p.y = ny;
      p.moveCd = 0.12;
      const gi = items.findIndex((it) => it.x === nx && it.y === ny);
      if (gi >= 0) {
        const it = items.splice(gi, 1)[0];
        if (it.kind === 'range') p.range = Math.min(7, p.range + 1);
        else p.bombs = Math.min(6, p.bombs + 1);
      }
    },
    step(dt) {
      if (over) return null;
      t += dt;
      for (const p of P.values()) if (p.moveCd > 0) p.moveCd -= dt;
      for (const b of bombs) {
        if (b.done) continue;
        b.t -= dt;
        if (b.t <= 0) explode(b);
      }
      for (let i = bombs.length - 1; i >= 0; i--) if (bombs[i].done) bombs.splice(i, 1);
      for (let i = fires.length - 1; i >= 0; i--) {
        fires[i].t -= dt;
        if (fires[i].t <= 0) fires.splice(i, 1);
      }
      // standing in a fresh blast still kills you
      for (const f of fires) {
        for (const p of P.values()) {
          if (p.alive && p.x === f.x && p.y === f.y) { p.alive = false; placing.push(p.id); }
        }
      }
      const live = [...P.values()].filter((p) => p.alive);
      if (P.size > 1 && live.length <= 1) over = true;
      if (P.size === 1 && live.length === 0) over = true;

      return {
        t: Math.round(t * 10) / 10,
        g: Array.from(grid),
        p: [...P.values()].map((p) => [p.id, p.x, p.y, p.alive ? 1 : 0, p.bombs, p.range, p.kills]),
        b: bombs.filter((b) => !b.done).map((b) => [b.x, b.y, Math.round(b.t * 10)]),
        f: fires.map((f) => [f.x, f.y]),
        i: items.map((it) => [it.x, it.y, it.kind === 'range' ? 1 : 0]),
      };
    },
    finished: () => over,
    result: () => {
      const alive = [...P.values()].filter((p) => p.alive);
      const order = [...alive.map((p) => p.id), ...placing.slice().reverse()];
      return { winner: alive.length ? alive[0].id : null,
        standings: order.map((id, i) => {
          const p = P.get(id);
          return { place: i + 1, id, name: p ? p.name : '?', kills: p ? p.kills : 0 };
        }) };
    },
  };
}
module.exports = {
  name: 'Bomber Grid', min: 2, max: 6, sync: 'tick', joinInProgress: false,
  blurb: 'Blast the crates, trap your friends. Mind the chain reactions.',
  make: bomber,
};
