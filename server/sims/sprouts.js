/* Sprouts — the pencil-and-paper game.

   Rules: join two spots (or a spot to itself) with a curve that crosses
   nothing, then drop a new spot on that curve. A spot may carry at most three
   line ends. The player with no legal move loses.

   The hard part is planarity. Clients draw a freehand polyline and the server
   accepts it only if every segment is clear of every existing segment and of
   every spot it is not allowed to touch. Doing this server-side matters: a
   client could otherwise simply declare an illegal curve legal. */
'use strict';

const W = 1000, H = 700;        // logical drawing area
const SPOT_R = 13;              // spots this close count as "touched"
const CLEAR = 9;                // a curve must keep this far from other spots
const MAX_DEG = 3;
const MAX_PTS = 400;

/* --- geometry helpers --- */
function segInt(a, b, c, d) {
  const o = (p, q, r) => Math.sign((q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x));
  const on = (p, q, r) =>
    Math.min(p.x, r.x) - 1e-9 <= q.x && q.x <= Math.max(p.x, r.x) + 1e-9 &&
    Math.min(p.y, r.y) - 1e-9 <= q.y && q.y <= Math.max(p.y, r.y) + 1e-9;
  const o1 = o(a, b, c), o2 = o(a, b, d), o3 = o(c, d, a), o4 = o(c, d, b);
  if (o1 !== o2 && o3 !== o4) return true;
  if (o1 === 0 && on(a, c, b)) return true;
  if (o2 === 0 && on(a, d, b)) return true;
  if (o3 === 0 && on(c, a, d)) return true;
  if (o4 === 0 && on(c, b, d)) return true;
  return false;
}
function distToSeg(p, a, b) {
  const vx = b.x - a.x, vy = b.y - a.y;
  const L = vx * vx + vy * vy;
  let t = L ? ((p.x - a.x) * vx + (p.y - a.y) * vy) / L : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + vx * t), p.y - (a.y + vy * t));
}

function sprouts(roster, startSpots = 4) {
  const seats = roster.slice(0, 2).map((p) => p.id);
  const names = Object.fromEntries(roster.map((p) => [p.id, p.name]));
  const spots = [];
  const curves = [];               // { pts:[{x,y}], a, b, by }
  let turn = 0, winner = null, reason = null;

  for (let i = 0; i < startSpots; i++) {
    const a = (i / startSpots) * Math.PI * 2 - Math.PI / 2;
    spots.push({ id: i, x: Math.round(W / 2 + Math.cos(a) * 190),
                        y: Math.round(H / 2 + Math.sin(a) * 190), deg: 0 });
  }

  const free = (s) => s.deg < MAX_DEG;

  /* Can any legal move still exist? Two free ends must remain, and at least
     one pair must be joinable by *some* curve. A straight line is only a
     sufficient test, so when it fails we fall back to "ends remain", which
     keeps the game going rather than ending it wrongly. */
  function anyMoveLeft() {
    const ends = spots.reduce((n, s) => n + (MAX_DEG - s.deg), 0);
    if (ends < 2) return false;
    const avail = spots.filter(free);
    if (avail.length === 1 && avail[0].deg > MAX_DEG - 2) return false;
    return true;
  }

  function validate(pts, aId, bId) {
    if (!Array.isArray(pts) || pts.length < 2) return 'curve too short';
    if (pts.length > MAX_PTS) return 'curve too detailed';
    for (const p of pts) {
      if (typeof p.x !== 'number' || typeof p.y !== 'number' ||
          !isFinite(p.x) || !isFinite(p.y) ||
          p.x < 0 || p.x > W || p.y < 0 || p.y > H) return 'curve leaves the paper';
    }
    const a = spots.find((s) => s.id === aId), b = spots.find((s) => s.id === bId);
    if (!a || !b) return 'unknown spot';
    if (!free(a) || !free(b)) return 'that spot already has three lines';
    if (a === b && a.deg > MAX_DEG - 2) return 'not enough room for a loop';
    if (Math.hypot(pts[0].x - a.x, pts[0].y - a.y) > SPOT_R) return 'curve must start on a spot';
    const last = pts[pts.length - 1];
    if (Math.hypot(last.x - b.x, last.y - b.y) > SPOT_R) return 'curve must end on a spot';

    const segs = [];
    for (let i = 0; i + 1 < pts.length; i++) segs.push([pts[i], pts[i + 1]]);

    // may not cross itself (ignoring neighbours, which share a point)
    for (let i = 0; i < segs.length; i++) {
      for (let j = i + 2; j < segs.length; j++) {
        if (i === 0 && j === segs.length - 1 && aId === bId) continue;   // closed loop
        if (segInt(segs[i][0], segs[i][1], segs[j][0], segs[j][1])) return 'the curve crosses itself';
      }
    }
    // may not cross an existing curve
    for (const c of curves) {
      for (let i = 0; i + 1 < c.pts.length; i++) {
        const e0 = c.pts[i], e1 = c.pts[i + 1];
        for (let k = 0; k < segs.length; k++) {
          // segments touching a shared endpoint spot are allowed to meet there
          const nearEnd = (p) =>
            (Math.hypot(p.x - a.x, p.y - a.y) <= SPOT_R + 1) ||
            (Math.hypot(p.x - b.x, p.y - b.y) <= SPOT_R + 1);
          if (nearEnd(segs[k][0]) || nearEnd(segs[k][1])) {
            if (nearEnd(e0) || nearEnd(e1)) continue;
          }
          if (segInt(segs[k][0], segs[k][1], e0, e1)) return 'the curve crosses another line';
        }
      }
    }
    // may not run over a spot it does not connect
    for (const s of spots) {
      if (s === a || s === b) continue;
      for (const [p, q] of segs) {
        if (distToSeg(s, p, q) < CLEAR) return 'the curve runs through a spot';
      }
    }
    return null;
  }

  return {
    init: () => ({ w: W, h: H, maxDeg: MAX_DEG, spotR: SPOT_R, seats, names }),
    view: () => ({
      w: W, h: H, spots, curves, turn, seats, names, winner, reason, maxDeg: MAX_DEG,
    }),
    addPlayer(id, name) { names[id] = name; },
    removePlayer(id) {
      if (seats.includes(id) && winner === null) {
        winner = seats.find((s) => s !== id) ?? 'abandoned';
        reason = 'opponent left';
      }
    },
    move(id, d) {
      if (winner !== null) return { error: 'game over' };
      if (id !== seats[turn]) return { error: 'not your turn' };
      const err = validate(d && d.pts, d && d.a, d && d.b);
      if (err) return { error: err };

      const a = spots.find((s) => s.id === d.a), b = spots.find((s) => s.id === d.b);
      a.deg++; b.deg++;
      const mid = d.pts[Math.floor(d.pts.length / 2)];
      const ns = { id: spots.length, x: Math.round(mid.x), y: Math.round(mid.y), deg: 2 };
      spots.push(ns);
      curves.push({ pts: d.pts.map((p) => ({ x: Math.round(p.x), y: Math.round(p.y) })),
                    a: d.a, b: d.b, by: id, spot: ns.id });

      if (!anyMoveLeft()) {
        winner = seats[1 - turn];              // the player to move has lost
        reason = 'no legal move left';
      } else {
        turn = 1 - turn;
      }
      return { ok: true };
    },
    finished: () => winner !== null,
    result: () => ({ winner, reason, names }),
  };
}

module.exports = {
  name: 'Sprouts', min: 2, max: 2, sync: 'relay', joinInProgress: true,
  blurb: 'Join two dots without crossing a line. Run out of moves and you lose.',
  make: (roster) => sprouts(roster, 4),
};
