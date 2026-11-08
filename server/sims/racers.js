/* Micro Racers — top-down laps on an oval. The track is a centre-line ring
   with a width; being off it slows you, so cutting the corner costs you. */
'use strict';
const W = 1200, H = 800;
const CX = W / 2, CY = H / 2, RX = 420, RY = 260, ROAD = 92;
const ACC = 320, BRAKE = 420, DRAG = 0.75, TURN = 2.5;
const MAX_ON = 300, MAX_OFF = 140;
const LAPS = 3;

function racers(roster) {
  const P = new Map();
  let over = false, t = 0, finished = [];

  // angle around the oval, 0 = start/finish on the right
  const trackPoint = (a) => ({ x: CX + Math.cos(a) * RX, y: CY + Math.sin(a) * RY });
  function distToTrack(x, y) {
    // cheap: sample the ellipse and take the nearest point
    let best = 1e9, bestA = 0;
    for (let i = 0; i < 180; i++) {
      const a = (i / 180) * Math.PI * 2;
      const p = trackPoint(a);
      const d = Math.hypot(p.x - x, p.y - y);
      if (d < best) { best = d; bestA = a; }
    }
    return { d: best, a: bestA };
  }

  roster.forEach((pl, i) => {
    const a = -0.06 * (i + 1);
    const p0 = trackPoint(a);
    const off = (i % 2 ? 1 : -1) * 22;
    P.set(pl.id, { id: pl.id, name: pl.name, hue: (i * 59) % 360,
      x: p0.x + off, y: p0.y, a: Math.PI / 2, v: 0,
      lap: 0, prog: a, acc: 0, turn: 0, best: 0, done: false });
  });

  return {
    init: () => ({ w: W, h: H, cx: CX, cy: CY, rx: RX, ry: RY, road: ROAD, laps: LAPS,
      players: [...P.values()].map((p) => ({ id: p.id, name: p.name, hue: p.hue })) }),
    addPlayer() {},
    removePlayer(id) { P.delete(id); },
    input(id, d) {
      const p = P.get(id);
      if (!p || !d || p.done) return;
      p.acc = Math.max(-1, Math.min(1, Number(d.acc) || 0));
      p.turn = Math.max(-1, Math.min(1, Number(d.turn) || 0));
    },
    step(dt) {
      if (over) return null;
      t += dt;
      for (const p of P.values()) {
        if (p.done) continue;
        const near = distToTrack(p.x, p.y);
        const onRoad = near.d < ROAD / 2;
        const max = onRoad ? MAX_ON : MAX_OFF;
        if (p.acc > 0) p.v += ACC * dt;
        else if (p.acc < 0) p.v -= BRAKE * dt;
        p.v *= Math.max(0, 1 - DRAG * dt);
        if (p.v > max) p.v = Math.max(max, p.v - ACC * 2 * dt);
        if (p.v < -90) p.v = -90;
        // steering bites more the faster you go, nothing at a standstill
        p.a += p.turn * TURN * dt * Math.min(1, Math.abs(p.v) / 90);
        p.x += Math.cos(p.a) * p.v * dt;
        p.y += Math.sin(p.a) * p.v * dt;
        p.x = Math.max(10, Math.min(W - 10, p.x));
        p.y = Math.max(10, Math.min(H - 10, p.y));

        // lap counting: track the angle and require forward progress
        const a = Math.atan2((p.y - CY) / RY, (p.x - CX) / RX);
        let delta = a - p.prog;
        while (delta > Math.PI) delta -= Math.PI * 2;
        while (delta < -Math.PI) delta += Math.PI * 2;
        if (Math.abs(delta) < 1) {
          p.best += delta;
          p.prog = a;
          const laps = Math.floor(p.best / (Math.PI * 2));
          if (laps > p.lap) {
            p.lap = laps;
            if (p.lap >= LAPS) { p.done = true; finished.push(p.id); }
          }
        }
      }
      if (P.size && [...P.values()].every((p) => p.done)) over = true;
      if (finished.length >= Math.max(1, P.size - 1)) over = true;

      return {
        t: Math.round(t * 10) / 10,
        p: [...P.values()].map((p) => [p.id, Math.round(p.x), Math.round(p.y),
            Math.round(p.a * 100) / 100, Math.round(p.v), p.lap, p.done ? 1 : 0]),
      };
    },
    finished: () => over,
    result: () => {
      const rest = [...P.values()].filter((p) => !finished.includes(p.id))
        .sort((a, b) => b.best - a.best).map((p) => p.id);
      const order = [...finished, ...rest];
      return { winner: order[0] ?? null,
        standings: order.map((id, i) => {
          const p = P.get(id);
          return { place: i + 1, id, name: p ? p.name : '?', laps: p ? p.lap : 0 };
        }) };
    },
  };
}
module.exports = {
  name: 'Micro Racers', min: 2, max: 8, sync: 'tick', joinInProgress: false,
  blurb: 'Three laps. Cut the corner onto the grass and you will pay for it.',
  make: racers,
};
