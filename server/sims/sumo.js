'use strict';

/* ==================== Sumo Arena (tick, up to 50P) ==================== */
/* Everyone shares one shrinking disc. Steering is yours; the shoving is
   physics. Server owns positions so nobody can teleport or refuse a hit.   */
const SUMO = {
  R0: 460,           // starting arena radius
  RMIN: 90,
  SHRINK_START: 12,  // seconds of grace before the ring closes
  SHRINK_RATE: 9,    // px per second
  ACCEL: 620,
  FRICTION: 2.2,
  MAXV: 300,
  PR: 16,            // player radius
  BOUNCE: 1.35,      // how hard collisions throw you
  DASH_V: 420,
  DASH_CD: 2.5,
};

function sumo(roster) {
  const P = new Map();
  let t = 0, radius = SUMO.R0, over = false, placing = [];

  function spawn(id, name, n) {
    const i = P.size;
    const a = (i / Math.max(8, n)) * Math.PI * 2 + Math.random() * 0.3;
    const r = SUMO.R0 * 0.62;
    P.set(id, {
      id, name, x: Math.cos(a) * r, y: Math.sin(a) * r,
      vx: 0, vy: 0, alive: true, dash: 0, hue: (i * 47) % 360, kills: 0,
      ix: 0, iy: 0, wantDash: false,
    });
  }

  roster.forEach((p) => spawn(p.id, p.name, roster.length));

  return {
    init: () => ({
      r0: SUMO.R0, pr: SUMO.PR,
      players: [...P.values()].map((p) => ({ id: p.id, name: p.name, hue: p.hue })),
    }),
    addPlayer(id, name) { if (!P.has(id)) spawn(id, name, P.size + 1); },
    removePlayer(id) { P.delete(id); },
    input(id, d) {
      const p = P.get(id);
      if (!p || !p.alive || !d) return;
      // normalise so a crafted client can't request a longer vector
      let x = Number(d.x) || 0, y = Number(d.y) || 0;
      const m = Math.hypot(x, y);
      if (m > 1) { x /= m; y /= m; }
      p.ix = x; p.iy = y;
      if (d.dash) p.wantDash = true;
    },
    step(dt) {
      if (over) return null;
      t += dt;
      if (t > SUMO.SHRINK_START) {
        radius = Math.max(SUMO.RMIN, radius - SUMO.SHRINK_RATE * dt);
      }
      const live = [...P.values()].filter((p) => p.alive);

      for (const p of live) {
        if (p.dash > 0) p.dash -= dt;
        if (p.wantDash && p.dash <= 0) {
          const m = Math.hypot(p.ix, p.iy) || 1;
          p.vx += (p.ix / m) * SUMO.DASH_V;
          p.vy += (p.iy / m) * SUMO.DASH_V;
          p.dash = SUMO.DASH_CD;
        }
        p.wantDash = false;
        p.vx += p.ix * SUMO.ACCEL * dt;
        p.vy += p.iy * SUMO.ACCEL * dt;
        const sp = Math.hypot(p.vx, p.vy);
        const cap = SUMO.MAXV * 1.9;
        if (sp > cap) { p.vx = p.vx / sp * cap; p.vy = p.vy / sp * cap; }
        const f = Math.max(0, 1 - SUMO.FRICTION * dt);
        p.vx *= f; p.vy *= f;
        p.x += p.vx * dt; p.y += p.vy * dt;
      }

      // pairwise shoves. 50 players is 1225 pairs per tick — trivial.
      for (let i = 0; i < live.length; i++) {
        for (let j = i + 1; j < live.length; j++) {
          const a = live[i], b = live[j];
          let dx = b.x - a.x, dy = b.y - a.y;
          let d = Math.hypot(dx, dy);
          const min = SUMO.PR * 2;
          if (d >= min || d === 0) continue;
          const nx = dx / d, ny = dy / d;
          const push = (min - d) / 2;
          a.x -= nx * push; a.y -= ny * push;
          b.x += nx * push; b.y += ny * push;
          // exchange momentum along the normal
          const rel = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
          if (rel < 0) {
            const imp = -rel * SUMO.BOUNCE;
            a.vx -= nx * imp; a.vy -= ny * imp;
            b.vx += nx * imp; b.vy += ny * imp;
            a.lastHit = b.id; b.lastHit = a.id;
          }
        }
      }

      // eliminations
      for (const p of live) {
        if (Math.hypot(p.x, p.y) > radius + SUMO.PR) {
          p.alive = false;
          placing.push(p.id);
          const k = P.get(p.lastHit);
          if (k && k.alive) k.kills++;
        }
      }

      const stillUp = [...P.values()].filter((p) => p.alive);
      if (P.size > 1 && stillUp.length <= 1) over = true;

      return {
        t: Math.round(t * 10) / 10,
        r: Math.round(radius),
        p: [...P.values()].map((p) => [
          p.id, Math.round(p.x), Math.round(p.y), p.alive ? 1 : 0,
          Math.max(0, Math.round(p.dash * 10)), p.kills,
        ]),
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
          return { place: i + 1, id, name: p ? p.name : '?', kills: p ? p.kills : 0 };
        }),
      };
    },
  };
}

module.exports = {
  name: 'Sumo Arena', min: 2, max: 50, sync: 'tick', joinInProgress: false,
  blurb: 'Fifty players, one shrinking disc. Shove everyone else off.',
  make: sumo,
};
