/* Slime Volleyball — 1v1, one key each way plus jump. Ball physics and the
   net are server-owned. First to 7. */
'use strict';
const W = 900, H = 500;
const GROUND = H - 40;
const NET_W = 10, NET_H = 120;
const SLIME_R = 46, BALL_R = 14;
const GRAV = 1250, JUMP = 560, SPEED = 330;
const MAX_BALL = 1100;      // without this a long rally accelerates forever
const WIN = 7;

function volley(roster) {
  const seats = roster.slice(0, 2).map((p) => p.id);
  const names = Object.fromEntries(roster.map((p) => [p.id, p.name]));
  const S = {
    [seats[0]]: { x: W * 0.25, y: GROUND, vy: 0, dir: 0, side: -1 },
    [seats[1]]: { x: W * 0.75, y: GROUND, vy: 0, dir: 0, side: 1 },
  };
  const score = { [seats[0]]: 0, [seats[1]]: 0 };
  let ball = null, over = false, serveT = 1.2, server = seats[0], t = 0;

  function serve(to) {
    server = to;
    ball = { x: to === seats[0] ? W * 0.32 : W * 0.68, y: 150, vx: 0, vy: 0 };
    serveT = 1.0;
  }
  serve(seats[0]);

  const leftOf = (id) => seats.indexOf(id) === 0;

  return {
    init: () => ({ w: W, h: H, ground: GROUND, netW: NET_W, netH: NET_H,
                   slimeR: SLIME_R, ballR: BALL_R, win: WIN, seats, names }),
    addPlayer(id, name) { names[id] = name; },
    removePlayer(id) { if (seats.includes(id) && !over) over = true; },
    input(id, d) {
      const s = S[id];
      if (!s || !d) return;
      s.dir = Math.max(-1, Math.min(1, Number(d.dir) || 0));
      if (d.jump && s.y >= GROUND - 0.5) s.vy = -JUMP;
    },
    step(dt) {
      if (over) return null;
      t += dt;

      for (const id of seats) {
        const s = S[id];
        s.x += s.dir * SPEED * dt;
        s.vy += GRAV * dt;
        s.y += s.vy * dt;
        if (s.y > GROUND) { s.y = GROUND; s.vy = 0; }
        // each slime is confined to its own side of the net
        const lo = leftOf(id) ? SLIME_R : W / 2 + NET_W / 2 + SLIME_R;
        const hi = leftOf(id) ? W / 2 - NET_W / 2 - SLIME_R : W - SLIME_R;
        s.x = Math.max(lo, Math.min(hi, s.x));
      }

      if (serveT > 0) { serveT -= dt; if (serveT <= 0) ball.vy = 40; }
      else {
        ball.vy += GRAV * 0.55 * dt;
        ball.x += ball.vx * dt;
        ball.y += ball.vy * dt;
      }

      if (ball.x < BALL_R) { ball.x = BALL_R; ball.vx = Math.abs(ball.vx) * 0.9; }
      if (ball.x > W - BALL_R) { ball.x = W - BALL_R; ball.vx = -Math.abs(ball.vx) * 0.9; }
      if (ball.y < BALL_R) { ball.y = BALL_R; ball.vy = Math.abs(ball.vy) * 0.9; }

      // net: a post you can clip the ball off
      const nx = W / 2, nTop = GROUND - NET_H;
      if (Math.abs(ball.x - nx) < NET_W / 2 + BALL_R && ball.y > nTop) {
        if (ball.y - BALL_R < nTop) { ball.y = nTop - BALL_R; ball.vy = -Math.abs(ball.vy) * 0.75; }
        else {
          ball.x = ball.x < nx ? nx - NET_W / 2 - BALL_R : nx + NET_W / 2 + BALL_R;
          ball.vx *= -0.85;
        }
      }

      // slime hits: only the upper dome plays the ball
      for (const id of seats) {
        const s = S[id];
        const dx = ball.x - s.x, dy = ball.y - s.y;
        if (dy > 0) continue;
        const d = Math.hypot(dx, dy), min = SLIME_R + BALL_R;
        if (d >= min || d === 0) continue;
        const ux = dx / d, uy = dy / d;
        ball.x = s.x + ux * min;
        ball.y = s.y + uy * min;
        // keep rallies lively but bounded — 1.03x per hit with no ceiling
        // turns a long rally into an unhittable blur
        const sp = Math.min(MAX_BALL, Math.max(340, Math.hypot(ball.vx, ball.vy) * 1.02));
        ball.vx = ux * sp + s.dir * 120;
        ball.vy = uy * sp - 60;
        const cap = Math.hypot(ball.vx, ball.vy);
        if (cap > MAX_BALL) { ball.vx = ball.vx / cap * MAX_BALL; ball.vy = ball.vy / cap * MAX_BALL; }
      }

      if (ball.y >= GROUND - BALL_R) {
        const scorer = ball.x < W / 2 ? seats[1] : seats[0];
        score[scorer]++;
        if (score[scorer] >= WIN) { over = true; }
        else serve(scorer);
      }

      return {
        t: Math.round(t * 10) / 10,
        b: [Math.round(ball.x), Math.round(ball.y)],
        s: seats.map((id) => [id, Math.round(S[id].x), Math.round(S[id].y)]),
        sc: seats.map((id) => score[id]),
        serving: serveT > 0 ? 1 : 0,
      };
    },
    finished: () => over,
    result: () => {
      const a = score[seats[0]], b = score[seats[1]];
      return { winner: a === b ? null : (a > b ? seats[0] : seats[1]), score: [a, b], names };
    },
  };
}

module.exports = {
  name: 'Slime Volleyball', min: 2, max: 2, sync: 'tick', joinInProgress: false,
  blurb: 'Two blobs, one net, first to seven. Move and jump, that is all.',
  make: volley,
};
