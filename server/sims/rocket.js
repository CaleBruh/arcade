/* Rocket Duel — thrust, rotate, shoot, with a star pulling everything in.
   Wrapping arena so nobody can camp a corner. */
'use strict';
const W = 1100, H = 780;
const SHIP_R = 13, BULLET_R = 4;
const THRUST = 330, ROT = 3.4, DRAG = 0.22;
const G_STAR = 92000, STAR_R = 44;
const SHOT_SPD = 430, SHOT_CD = 0.35, SHOT_LIFE = 2.4;
const RESPAWN = 2.2, WIN_KILLS = 10;

function rocket(roster) {
  const P = new Map();
  const shots = [];
  let over = false, t = 0;

  function place(p, i, n) {
    const a = (i / Math.max(2, n)) * Math.PI * 2;
    p.x = W / 2 + Math.cos(a) * 300;
    p.y = H / 2 + Math.sin(a) * 240;
    p.vx = 0; p.vy = 0;
    p.a = a + Math.PI;
    p.dead = 0;
  }
  roster.forEach((pl, i) => {
    const p = { id: pl.id, name: pl.name, hue: (i * 73) % 360,
                thrust: 0, turn: 0, cd: 0, kills: 0, deaths: 0 };
    place(p, i, roster.length);
    P.set(pl.id, p);
  });

  const wrap = (p) => {
    if (p.x < 0) p.x += W; if (p.x > W) p.x -= W;
    if (p.y < 0) p.y += H; if (p.y > H) p.y -= H;
  };

  return {
    init: () => ({ w: W, h: H, shipR: SHIP_R, starR: STAR_R, winKills: WIN_KILLS,
      players: [...P.values()].map((p) => ({ id: p.id, name: p.name, hue: p.hue })) }),
    addPlayer() {},
    removePlayer(id) { P.delete(id); },
    input(id, d) {
      const p = P.get(id);
      if (!p || !d || p.dead > 0) return;
      p.thrust = d.thrust ? 1 : 0;
      p.turn = Math.max(-1, Math.min(1, Number(d.turn) || 0));
      if (d.fire && p.cd <= 0) {
        shots.push({ x: p.x + Math.cos(p.a) * (SHIP_R + 4),
                     y: p.y + Math.sin(p.a) * (SHIP_R + 4),
                     vx: p.vx + Math.cos(p.a) * SHOT_SPD,
                     vy: p.vy + Math.sin(p.a) * SHOT_SPD,
                     by: id, life: SHOT_LIFE });
        p.cd = SHOT_CD;
      }
    },
    step(dt) {
      if (over) return null;
      t += dt;
      const sx = W / 2, sy = H / 2;

      for (const p of P.values()) {
        if (p.cd > 0) p.cd -= dt;
        if (p.dead > 0) { p.dead -= dt; if (p.dead <= 0) place(p, 0, 2); continue; }
        p.a += p.turn * ROT * dt;
        if (p.thrust) { p.vx += Math.cos(p.a) * THRUST * dt; p.vy += Math.sin(p.a) * THRUST * dt; }
        // the star pulls, and swallows anything that touches it
        const dx = sx - p.x, dy = sy - p.y;
        const d2 = Math.max(600, dx * dx + dy * dy);
        const d = Math.sqrt(d2);
        p.vx += (dx / d) * (G_STAR / d2) * dt;
        p.vy += (dy / d) * (G_STAR / d2) * dt;
        const k = Math.max(0, 1 - DRAG * dt);
        p.vx *= k; p.vy *= k;
        p.x += p.vx * dt; p.y += p.vy * dt;
        wrap(p);
        if (d < STAR_R + SHIP_R) { p.dead = RESPAWN; p.deaths++; }
      }

      for (let i = shots.length - 1; i >= 0; i--) {
        const s = shots[i];
        s.life -= dt;
        const dx = sx - s.x, dy = sy - s.y;
        const d2 = Math.max(600, dx * dx + dy * dy), d = Math.sqrt(d2);
        s.vx += (dx / d) * (G_STAR / d2) * dt;
        s.vy += (dy / d) * (G_STAR / d2) * dt;
        s.x += s.vx * dt; s.y += s.vy * dt;
        wrap(s);
        if (s.life <= 0 || d < STAR_R) { shots.splice(i, 1); continue; }
        for (const p of P.values()) {
          if (p.dead > 0 || p.id === s.by) continue;
          if (Math.hypot(p.x - s.x, p.y - s.y) < SHIP_R + BULLET_R) {
            p.dead = RESPAWN; p.deaths++;
            const k2 = P.get(s.by);
            if (k2) k2.kills++;
            shots.splice(i, 1);
            break;
          }
        }
      }

      if ([...P.values()].some((p) => p.kills >= WIN_KILLS)) over = true;

      return {
        t: Math.round(t * 10) / 10,
        p: [...P.values()].map((p) => [p.id, Math.round(p.x), Math.round(p.y),
            Math.round(p.a * 100) / 100, p.dead > 0 ? 0 : 1, p.kills, p.thrust]),
        s: shots.map((s) => [Math.round(s.x), Math.round(s.y)]),
      };
    },
    finished: () => over,
    result: () => {
      const all = [...P.values()].sort((a, b) => b.kills - a.kills);
      return { winner: all.length ? all[0].id : null,
        standings: all.map((p, i) => ({ place: i + 1, id: p.id, name: p.name,
                                        kills: p.kills, deaths: p.deaths })) };
    },
  };
}
module.exports = {
  name: 'Rocket Duel', min: 2, max: 6, sync: 'tick', joinInProgress: false,
  blurb: 'Thrust, drift and shoot around a star that wants you dead. First to ten.',
  make: rocket,
};
