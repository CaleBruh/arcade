'use strict';

/* ==================== Arena (tick, up to 24P) ====================
   Top-down deathmatch. Sumo is a shoving game with no respawns; this is the
   opposite — you shoot, you die, you come straight back, and the round ends
   on a frag count rather than a last-player-standing.

   Everything that decides a kill lives here: bullet travel, wall occlusion
   and hit detection. The client sends a move vector, an aim angle and a fire
   flag, and nothing else.                                                  */
const A = {
  W: 1400, H: 900,
  PR: 15,                 // player radius
  ACCEL: 2400,
  FRICTION: 9,
  MAXV: 300,
  HP: 100,
  RESPAWN: 2.5,
  FIRE_CD: 0.18,
  BULLET_V: 780,
  BULLET_R: 4,
  BULLET_DMG: 26,
  // must out-reach the map diagonal (1664px) or the two furthest spawns
  // cannot shoot at each other at all — 2.2s gives 1716px
  BULLET_LIFE: 2.2,
  FRAG_LIMIT: 20,
  TIME_LIMIT: 240,
};

/* A fixed symmetric map. Symmetry matters: with random cover, spawning badly
   decides the round before anyone shoots. */
const WALLS = [
  { x: 300, y: 180, w: 160, h: 28 },
  { x: 940, y: 692, w: 160, h: 28 },
  { x: 300, y: 692, w: 160, h: 28 },
  { x: 940, y: 180, w: 160, h: 28 },
  { x: 660, y: 300, w: 28, h: 300 },
  { x: 712, y: 300, w: 28, h: 300 },
  { x: 180, y: 420, w: 28, h: 160 },
  { x: 1192, y: 420, w: 28, h: 160 },
  { x: 520, y: 100, w: 28, h: 120 },
  { x: 852, y: 680, w: 28, h: 120 },
];

/* Eight spawn points, used round-robin and biased away from live players so
   nobody respawns under someone's crosshair. */
const SPAWNS = [
  [120, 120], [1280, 120], [120, 780], [1280, 780],
  [700, 110], [700, 790], [110, 450], [1290, 450],
];

function segHitsRect(x0, y0, x1, y1, r) {
  // slab clip: does the segment touch the axis-aligned box at all
  let t0 = 0, t1 = 1;
  const dx = x1 - x0, dy = y1 - y0;
  const p = [-dx, dx, -dy, dy];
  const q = [x0 - r.x, r.x + r.w - x0, y0 - r.y, r.y + r.h - y0];
  for (let i = 0; i < 4; i++) {
    if (p[i] === 0) { if (q[i] < 0) return false; continue; }
    const t = q[i] / p[i];
    if (p[i] < 0) { if (t > t1) return false; if (t > t0) t0 = t; }
    else { if (t < t0) return false; if (t < t1) t1 = t; }
  }
  return true;
}

function arena(roster) {
  const P = new Map();
  const bullets = [];
  let t = 0, over = false, nextBullet = 1, spawnTurn = 0;

  function placeAt(p) {
    // pick the spawn furthest from the nearest living player
    let best = SPAWNS[spawnTurn % SPAWNS.length], bestD = -1;
    for (const s of SPAWNS) {
      let near = 1e9;
      for (const o of P.values()) {
        if (o === p || !o.alive) continue;
        near = Math.min(near, Math.hypot(o.x - s[0], o.y - s[1]));
      }
      if (near > bestD) { bestD = near; best = s; }
    }
    spawnTurn++;
    p.x = best[0]; p.y = best[1];
    p.vx = 0; p.vy = 0;
    p.hp = A.HP; p.alive = true; p.respawn = 0;
  }

  function spawn(id, name) {
    const i = P.size;
    const p = {
      id, name, x: 0, y: 0, vx: 0, vy: 0, aim: 0, hp: A.HP, alive: true,
      respawn: 0, cd: 0, frags: 0, deaths: 0, hue: (i * 61) % 360,
      ix: 0, iy: 0, wantFire: false,
    };
    P.set(id, p);
    placeAt(p);
  }

  roster.forEach((p) => spawn(p.id, p.name));

  function blocked(x0, y0, x1, y1) {
    for (const w of WALLS) if (segHitsRect(x0, y0, x1, y1, w)) return true;
    return false;
  }

  function slideWalls(p) {
    for (const w of WALLS) {
      const cx = Math.max(w.x, Math.min(p.x, w.x + w.w));
      const cy = Math.max(w.y, Math.min(p.y, w.y + w.h));
      const dx = p.x - cx, dy = p.y - cy;
      const d = Math.hypot(dx, dy);
      if (d >= A.PR) continue;
      if (d === 0) { p.x += A.PR; continue; }
      const push = A.PR - d;
      p.x += (dx / d) * push;
      p.y += (dy / d) * push;
      // kill the velocity component heading into the wall
      const nx = dx / d, ny = dy / d;
      const into = p.vx * nx + p.vy * ny;
      if (into < 0) { p.vx -= nx * into; p.vy -= ny * into; }
    }
  }

  return {
    init: () => ({
      w: A.W, h: A.H, pr: A.PR, walls: WALLS, frags: A.FRAG_LIMIT,
      players: [...P.values()].map((p) => ({ id: p.id, name: p.name, hue: p.hue })),
    }),
    addPlayer(id, name) { if (!P.has(id)) spawn(id, name); },
    removePlayer(id) { P.delete(id); },
    input(id, d) {
      const p = P.get(id);
      if (!p || !d) return;
      let x = Number(d.x) || 0, y = Number(d.y) || 0;
      const m = Math.hypot(x, y);
      if (m > 1) { x /= m; y /= m; }          // no crafted long vectors
      p.ix = x; p.iy = y;
      const a = Number(d.aim);
      if (isFinite(a)) p.aim = a;
      if (d.fire) p.wantFire = true;
    },
    step(dt) {
      if (over) return null;
      t += dt;

      for (const p of P.values()) {
        if (!p.alive) {
          p.respawn -= dt;
          if (p.respawn <= 0) placeAt(p);
          p.wantFire = false;
          continue;
        }
        p.cd -= dt;
        p.vx += p.ix * A.ACCEL * dt;
        p.vy += p.iy * A.ACCEL * dt;
        const sp = Math.hypot(p.vx, p.vy);
        if (sp > A.MAXV) { p.vx = p.vx / sp * A.MAXV; p.vy = p.vy / sp * A.MAXV; }
        const f = Math.max(0, 1 - A.FRICTION * dt);
        p.vx *= f; p.vy *= f;
        p.x += p.vx * dt; p.y += p.vy * dt;
        p.x = Math.max(A.PR, Math.min(A.W - A.PR, p.x));
        p.y = Math.max(A.PR, Math.min(A.H - A.PR, p.y));
        slideWalls(p);

        if (p.wantFire && p.cd <= 0) {
          p.cd = A.FIRE_CD;
          bullets.push({
            id: nextBullet++, owner: p.id,
            x: p.x + Math.cos(p.aim) * (A.PR + 2),
            y: p.y + Math.sin(p.aim) * (A.PR + 2),
            vx: Math.cos(p.aim) * A.BULLET_V,
            vy: Math.sin(p.aim) * A.BULLET_V,
            life: A.BULLET_LIFE,
          });
        }
        p.wantFire = false;
      }

      // bullets: swept against walls and players so fast rounds can't tunnel
      for (let i = bullets.length - 1; i >= 0; i--) {
        const b = bullets[i];
        const nx = b.x + b.vx * dt, ny = b.y + b.vy * dt;
        b.life -= dt;
        let dead = b.life <= 0 || nx < 0 || ny < 0 || nx > A.W || ny > A.H;

        if (!dead && blocked(b.x, b.y, nx, ny)) dead = true;

        if (!dead) {
          for (const p of P.values()) {
            if (!p.alive || p.id === b.owner) continue;
            // distance from the player's centre to this tick's travel segment
            const sx = nx - b.x, sy = ny - b.y;
            const len2 = sx * sx + sy * sy;
            let u = len2 ? ((p.x - b.x) * sx + (p.y - b.y) * sy) / len2 : 0;
            u = Math.max(0, Math.min(1, u));
            const hx = b.x + sx * u, hy = b.y + sy * u;
            if (Math.hypot(p.x - hx, p.y - hy) > A.PR + A.BULLET_R) continue;
            p.hp -= A.BULLET_DMG;
            dead = true;
            if (p.hp <= 0) {
              p.alive = false;
              p.deaths++;
              p.respawn = A.RESPAWN;
              const k = P.get(b.owner);
              if (k) k.frags++;
            }
            break;
          }
        }
        if (dead) bullets.splice(i, 1);
        else { b.x = nx; b.y = ny; }
      }

      const leader = [...P.values()].sort((a, b) => b.frags - a.frags)[0];
      if ((leader && leader.frags >= A.FRAG_LIMIT) || t >= A.TIME_LIMIT) over = true;

      return {
        t: Math.round(t * 10) / 10,
        left: Math.max(0, Math.round(A.TIME_LIMIT - t)),
        p: [...P.values()].map((p) => [
          p.id, Math.round(p.x), Math.round(p.y),
          Math.round(p.aim * 100) / 100,
          p.alive ? Math.max(0, p.hp) : 0, p.frags,
        ]),
        b: bullets.map((b) => [Math.round(b.x), Math.round(b.y)]),
      };
    },
    finished: () => over,
    result: () => {
      const order = [...P.values()].sort((a, b) => b.frags - a.frags || a.deaths - b.deaths);
      return {
        winner: order.length ? order[0].id : null,
        standings: order.map((p, i) => ({
          place: i + 1, id: p.id, name: p.name, frags: p.frags, deaths: p.deaths,
        })),
      };
    },
  };
}

module.exports = {
  name: 'Arena', min: 2, max: 24, sync: 'tick', joinInProgress: true,
  blurb: 'Top-down deathmatch. Instant respawns, first to 20 frags.',
  make: arena,
};
