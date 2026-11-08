'use strict';

/* ==================== Battle Royale (tick, up to 50P) ====================
   Sumo shrinks a disc and shoves; Arena respawns you forever. This one keeps
   the shrinking ring but adds the two things that make a royale a royale:
   you only get one life, and what you find on the ground decides whether you
   can win a fight.

   Loot is server-placed and server-claimed. A client that asks to pick up a
   crate it is nowhere near simply doesn't.                                 */
const R = {
  W: 2200, H: 2200,
  PR: 15,
  ACCEL: 2100,
  FRICTION: 8.5,
  MAXV: 285,
  HP: 100,
  GRACE: 20,              // seconds before the ring starts closing
  SHRINK: 26,             // radius px/sec
  RMIN: 110,
  STORM_DPS: 7,           // damage per second outside the ring
  BULLET_V: 720,
  BULLET_R: 4,
  BULLET_LIFE: 1.5,
  PICKUP_R: 26,
  CRATES: 46,
  RESPAWN_LOOT: 14,       // seconds between fresh crates dropping
};

/* Three tiers. The spread is deliberately wide: finding a rifle should feel
   like it changed the game, otherwise looting is just busywork. */
const GUNS = [
  { k: 0, name: 'Pistol', cd: 0.34, dmg: 18, spread: 0.05, pellets: 1 },
  { k: 1, name: 'SMG',    cd: 0.11, dmg: 13, spread: 0.11, pellets: 1 },
  { k: 2, name: 'Rifle',  cd: 0.55, dmg: 46, spread: 0.01, pellets: 1 },
  { k: 3, name: 'Shotgun',cd: 0.72, dmg: 13, spread: 0.20, pellets: 6 },
];

/* Deterministic-ish scatter so a round is reproducible from its seed. */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function royale(roster, opts) {
  const seed = (opts && opts.seed) || 1234567;
  const rand = rng(seed);
  const P = new Map();
  const bullets = [];
  const crates = [];
  let t = 0, over = false, radius = Math.min(R.W, R.H) / 2, placing = [], nextCrate = 0;
  let cx = R.W / 2, cy = R.H / 2;

  function dropCrate() {
    // always inside the live ring, or it is unreachable the moment it lands
    const a = rand() * Math.PI * 2;
    const d = Math.sqrt(rand()) * Math.max(40, radius - 60);
    crates.push({
      id: ++nextCrate,
      x: cx + Math.cos(a) * d,
      y: cy + Math.sin(a) * d,
      // bias the table: pistols are common, rifles are not
      kind: rand() < 0.3 ? 'hp' : ['gun1', 'gun1', 'gun2', 'gun3'][Math.floor(rand() * 4)],
    });
  }
  for (let i = 0; i < R.CRATES; i++) dropCrate();

  function spawn(id, name) {
    const i = P.size;
    const a = rand() * Math.PI * 2;
    const d = Math.sqrt(rand()) * (radius * 0.8);
    P.set(id, {
      id, name, x: cx + Math.cos(a) * d, y: cy + Math.sin(a) * d,
      vx: 0, vy: 0, aim: 0, hp: R.HP, alive: true, gun: 0, cd: 0,
      kills: 0, hue: (i * 53) % 360, ix: 0, iy: 0, wantFire: false,
    });
  }
  roster.forEach((p) => spawn(p.id, p.name));

  return {
    init: () => ({
      w: R.W, h: R.H, pr: R.PR, guns: GUNS.map((g) => g.name),
      players: [...P.values()].map((p) => ({ id: p.id, name: p.name, hue: p.hue })),
    }),
    addPlayer(id, name) { if (!P.has(id)) spawn(id, name); },
    removePlayer(id) { P.delete(id); },
    input(id, d) {
      const p = P.get(id);
      if (!p || !p.alive || !d) return;
      let x = Number(d.x) || 0, y = Number(d.y) || 0;
      const m = Math.hypot(x, y);
      if (m > 1) { x /= m; y /= m; }
      p.ix = x; p.iy = y;
      const a = Number(d.aim);
      if (isFinite(a)) p.aim = a;
      if (d.fire) p.wantFire = true;
    },
    step(dt) {
      if (over) return null;
      t += dt;

      if (t > R.GRACE) radius = Math.max(R.RMIN, radius - R.SHRINK * dt);
      if (t > R.RESPAWN_LOOT && crates.length < R.CRATES &&
          Math.floor(t) % R.RESPAWN_LOOT === 0) dropCrate();

      for (const p of P.values()) {
        if (!p.alive) continue;
        p.cd -= dt;
        p.vx += p.ix * R.ACCEL * dt;
        p.vy += p.iy * R.ACCEL * dt;
        const sp = Math.hypot(p.vx, p.vy);
        if (sp > R.MAXV) { p.vx = p.vx / sp * R.MAXV; p.vy = p.vy / sp * R.MAXV; }
        const f = Math.max(0, 1 - R.FRICTION * dt);
        p.vx *= f; p.vy *= f;
        p.x = Math.max(R.PR, Math.min(R.W - R.PR, p.x + p.vx * dt));
        p.y = Math.max(R.PR, Math.min(R.H - R.PR, p.y + p.vy * dt));

        // loot is claimed by proximity — the client never asks for an item
        for (let i = crates.length - 1; i >= 0; i--) {
          const c = crates[i];
          if (Math.hypot(c.x - p.x, c.y - p.y) > R.PICKUP_R + R.PR) continue;
          if (c.kind === 'hp') p.hp = Math.min(R.HP, p.hp + 35);
          else {
            const tier = Number(c.kind.slice(3));
            if (tier > p.gun) p.gun = tier;       // never a downgrade
          }
          crates.splice(i, 1);
        }

        // the storm
        if (Math.hypot(p.x - cx, p.y - cy) > radius) {
          p.hp -= R.STORM_DPS * dt;
          if (p.hp <= 0) { p.alive = false; placing.push(p.id); }
        }

        const g = GUNS[p.gun] || GUNS[0];
        if (p.wantFire && p.cd <= 0 && p.alive) {
          p.cd = g.cd;
          for (let n = 0; n < g.pellets; n++) {
            const a = p.aim + (rand() - 0.5) * g.spread * 2;
            bullets.push({
              owner: p.id, dmg: g.dmg,
              x: p.x + Math.cos(a) * (R.PR + 2),
              y: p.y + Math.sin(a) * (R.PR + 2),
              vx: Math.cos(a) * R.BULLET_V,
              vy: Math.sin(a) * R.BULLET_V,
              life: R.BULLET_LIFE,
            });
          }
        }
        p.wantFire = false;
      }

      for (let i = bullets.length - 1; i >= 0; i--) {
        const b = bullets[i];
        const nx = b.x + b.vx * dt, ny = b.y + b.vy * dt;
        b.life -= dt;
        let dead = b.life <= 0 || nx < 0 || ny < 0 || nx > R.W || ny > R.H;
        if (!dead) {
          for (const p of P.values()) {
            if (!p.alive || p.id === b.owner) continue;
            const sx = nx - b.x, sy = ny - b.y;
            const len2 = sx * sx + sy * sy;
            let u = len2 ? ((p.x - b.x) * sx + (p.y - b.y) * sy) / len2 : 0;
            u = Math.max(0, Math.min(1, u));
            const hx = b.x + sx * u, hy = b.y + sy * u;
            if (Math.hypot(p.x - hx, p.y - hy) > R.PR + R.BULLET_R) continue;
            p.hp -= b.dmg;
            dead = true;
            if (p.hp <= 0) {
              p.alive = false;
              placing.push(p.id);
              const k = P.get(b.owner);
              if (k) k.kills++;
            }
            break;
          }
        }
        if (dead) bullets.splice(i, 1);
        else { b.x = nx; b.y = ny; }
      }

      const live = [...P.values()].filter((p) => p.alive);
      if (P.size > 1 && live.length <= 1) over = true;

      return {
        t: Math.round(t * 10) / 10,
        r: Math.round(radius), cx: Math.round(cx), cy: Math.round(cy),
        alive: live.length,
        p: [...P.values()].map((p) => [
          p.id, Math.round(p.x), Math.round(p.y),
          Math.round(p.aim * 100) / 100,
          p.alive ? Math.max(0, Math.round(p.hp)) : 0,
          p.gun, p.kills,
        ]),
        b: bullets.map((b) => [Math.round(b.x), Math.round(b.y)]),
        c: crates.map((c) => [Math.round(c.x), Math.round(c.y), c.kind === 'hp' ? 0 : Number(c.kind.slice(3))]),
      };
    },
    finished: () => over,
    result: () => {
      const live = [...P.values()].filter((p) => p.alive);
      const order = [...live.map((p) => p.id), ...placing.slice().reverse()];
      return {
        winner: live.length ? live[0].id : null,
        standings: order.map((id, i) => {
          const p = P.get(id);
          return { place: i + 1, id, name: p ? p.name : '?', kills: p ? p.kills : 0 };
        }),
      };
    },
  };
}

module.exports = {
  name: 'Battle Royale', min: 2, max: 50, sync: 'tick', joinInProgress: false,
  blurb: 'One life, a closing storm, and whatever gun you find on the ground.',
  make: royale,
};
