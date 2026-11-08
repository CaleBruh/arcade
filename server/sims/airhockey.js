/* Air Hockey — 1v1. Each mallet is confined to its own half; the puck is
   server-owned so neither side can shove it through the other's goal. */
'use strict';
const W = 600, H = 900;
const MALLET = 34, PUCK = 20;
const GOAL_W = 220;
const MAX_PUCK = 1400;
const WIN_GOALS = 7;

function airhockey(roster) {
  const seats = roster.slice(0, 2).map((p) => p.id);
  const names = Object.fromEntries(roster.map((p) => [p.id, p.name]));
  // seat 0 defends the top (y=0), seat 1 the bottom (y=H)
  const pads = {
    [seats[0]]: { x: W / 2, y: 110, tx: W / 2, ty: 110, vx: 0, vy: 0 },
    [seats[1]]: { x: W / 2, y: H - 110, tx: W / 2, ty: H - 110, vx: 0, vy: 0 },
  };
  const score = { [seats[0]]: 0, [seats[1]]: 0 };
  let puck = null, over = false, serveT = 1.2, lastScorer = null, t = 0;

  function reset(toward) {
    puck = { x: W / 2, y: H / 2, vx: 0, vy: 0 };
    serveT = 1.0;
    lastScorer = toward;
  }
  reset(null);

  return {
    init: () => ({ w: W, h: H, mallet: MALLET, puck: PUCK, goal: GOAL_W,
                   winGoals: WIN_GOALS, seats, names }),
    addPlayer(id, name) { names[id] = name; },
    removePlayer(id) { if (seats.includes(id) && !over) { over = true; } },
    input(id, d) {
      const p = pads[id];
      if (!p || !d) return;
      // clients send a target position; the server clamps it to their half
      let x = Number(d.x), y = Number(d.y);
      if (!isFinite(x) || !isFinite(y)) return;
      const mine = seats.indexOf(id);
      const lo = mine === 0 ? MALLET : H / 2 + MALLET;
      const hi = mine === 0 ? H / 2 - MALLET : H - MALLET;
      p.tx = Math.max(MALLET, Math.min(W - MALLET, x));
      p.ty = Math.max(lo, Math.min(hi, y));
    },
    step(dt) {
      if (over) return null;
      t += dt;

      for (const id of seats) {
        const p = pads[id];
        const nx = p.x + (p.tx - p.x) * Math.min(1, dt * 16);
        const ny = p.y + (p.ty - p.y) * Math.min(1, dt * 16);
        p.vx = (nx - p.x) / Math.max(dt, 1e-4);
        p.vy = (ny - p.y) / Math.max(dt, 1e-4);
        p.x = nx; p.y = ny;
      }

      if (serveT > 0) { serveT -= dt; if (serveT <= 0) {
        const dir = lastScorer === seats[0] ? 1 : -1;     // serve away from the scorer
        puck.vx = (Math.random() * 2 - 1) * 120;
        puck.vy = dir * (260 + Math.random() * 90);
      } }

      puck.x += puck.vx * dt;
      puck.y += puck.vy * dt;
      puck.vx *= Math.max(0, 1 - 0.25 * dt);
      puck.vy *= Math.max(0, 1 - 0.25 * dt);

      // side walls
      if (puck.x < PUCK) { puck.x = PUCK; puck.vx = Math.abs(puck.vx) * 0.92; }
      if (puck.x > W - PUCK) { puck.x = W - PUCK; puck.vx = -Math.abs(puck.vx) * 0.92; }

      // end walls, with a gap for the goal
      const inMouth = Math.abs(puck.x - W / 2) < GOAL_W / 2;
      if (puck.y < PUCK) {
        if (inMouth) { score[seats[1]]++; reset(seats[1]); }
        else { puck.y = PUCK; puck.vy = Math.abs(puck.vy) * 0.92; }
      }
      if (puck.y > H - PUCK) {
        if (inMouth) { score[seats[0]]++; reset(seats[0]); }
        else { puck.y = H - PUCK; puck.vy = -Math.abs(puck.vy) * 0.92; }
      }

      // mallet strikes: push out, then add the mallet's own motion
      for (const id of seats) {
        const p = pads[id];
        const dx = puck.x - p.x, dy = puck.y - p.y;
        const d = Math.hypot(dx, dy), min = MALLET + PUCK;
        if (d >= min || d === 0) continue;
        const nx = dx / d, ny = dy / d;
        puck.x = p.x + nx * min;
        puck.y = p.y + ny * min;
        const rel = puck.vx * nx + puck.vy * ny;
        puck.vx += nx * (-rel * 1.8) + p.vx * 0.55;
        puck.vy += ny * (-rel * 1.8) + p.vy * 0.55;
      }

      const sp = Math.hypot(puck.vx, puck.vy);
      if (sp > MAX_PUCK) { puck.vx = puck.vx / sp * MAX_PUCK; puck.vy = puck.vy / sp * MAX_PUCK; }

      if (score[seats[0]] >= WIN_GOALS || score[seats[1]] >= WIN_GOALS) over = true;

      return {
        t: Math.round(t * 10) / 10,
        puck: [Math.round(puck.x), Math.round(puck.y)],
        pads: seats.map((id) => [id, Math.round(pads[id].x), Math.round(pads[id].y)]),
        score: seats.map((id) => score[id]),
        serving: serveT > 0 ? 1 : 0,
      };
    },
    finished: () => over,
    result: () => {
      const a = score[seats[0]], b = score[seats[1]];
      return { winner: a === b ? null : (a > b ? seats[0] : seats[1]),
               score: [a, b], names };
    },
  };
}

module.exports = {
  name: 'Air Hockey', min: 2, max: 2, sync: 'tick', joinInProgress: false,
  blurb: 'First to seven. Your mallet cannot leave your own half.',
  make: airhockey,
};
