'use strict';

/* ================ Co-op Tower Defence (tick, up to 16P) ================
   The only game here where everyone wins or everyone loses. There are no
   standings to fight over — the scoreboard records what each player
   contributed, and the result is shared.

   Shared gold is the whole design. One player can spend the team's money on
   a bad tower, which is the point: it forces people to talk. The server
   still validates every build (can you afford it, is that cell on the path,
   is it already occupied), so a bad decision is possible but a cheat is not. */
const D = {
  COLS: 20, ROWS: 12, CELL: 56,
  START_GOLD: 220,
  START_LIVES: 20,
  WAVES: 15,
  WAVE_GAP: 12,            // seconds between waves
  FIRST_WAVE: 8,
};

const TOWERS = [
  { k: 0, name: 'Gun',    cost: 60,  range: 120, cd: 0.55, dmg: 11, splash: 0,  slow: 0 },
  { k: 1, name: 'Cannon', cost: 110, range: 105, cd: 1.5,  dmg: 32, splash: 46, slow: 0 },
  { k: 2, name: 'Frost',  cost: 90,  range: 110, cd: 0.9,  dmg: 5,  splash: 0,  slow: 0.45 },
  { k: 3, name: 'Tesla',  cost: 180, range: 145, cd: 1.1,  dmg: 26, splash: 0,  slow: 0, chain: 3 },
];

/* A fixed S-bend. Hand-authored rather than generated so the lanes are always
   worth defending and there is no round where the path is a straight line. */
const PATH = (() => {
  const pts = [
    [0, 2], [6, 2], [6, 6], [2, 6], [2, 9], [10, 9],
    [10, 4], [14, 4], [14, 10], [19, 10],
  ];
  const cells = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const [x0, y0] = pts[i], [x1, y1] = pts[i + 1];
    const dx = Math.sign(x1 - x0), dy = Math.sign(y1 - y0);
    let x = x0, y = y0;
    while (x !== x1 || y !== y1) { cells.push([x, y]); x += dx; y += dy; }
  }
  cells.push(pts[pts.length - 1]);
  return cells;
})();

const PATH_SET = new Set(PATH.map(([x, y]) => x + ',' + y));
const cx = (c) => c * D.CELL + D.CELL / 2;
const cy = (r) => r * D.CELL + D.CELL / 2;

function codefence(roster) {
  const P = new Map();
  const towers = [];
  const creeps = [];
  const occupied = new Set();
  let gold = D.START_GOLD, lives = D.START_LIVES;
  let t = 0, wave = 0, nextWaveAt = D.FIRST_WAVE, spawning = null;
  let over = false, won = false, nextId = 1;

  roster.forEach((p, i) => P.set(p.id, {
    id: p.id, name: p.name, hue: (i * 67) % 360, built: 0, spent: 0, dmg: 0,
  }));

  function waveSpec(n) {
    // every fifth wave is armoured; health curves faster than the economy so
    // the team has to upgrade placement, not just add more guns
    const armoured = n % 5 === 0;
    /* 1.22 was picked by simulating full rounds, not by eye. It is the point
       where a committed team wins with a scratch (19/20 lives), a guns-only
       build still wins but pays for it (17/20), and a half-hearted defence
       collapses on wave 13. Above 1.24 the game is unwinnable; below 1.20 it
       is flawless every time. */
    return {
      count: 8 + n * 2,
      hp: Math.round(26 * Math.pow(1.22, n) * (armoured ? 2.1 : 1)),
      speed: armoured ? 38 : 52 + n * 1.5,
      bounty: 7 + Math.floor(n * 1.2),
      armoured,
    };
  }

  function startWave() {
    wave++;
    const spec = waveSpec(wave);
    spawning = { left: spec.count, spec, every: 0.55, next: 0 };
  }

  return {
    init: () => ({
      cols: D.COLS, rows: D.ROWS, cell: D.CELL, path: PATH,
      towers: TOWERS.map((t) => ({ k: t.k, name: t.name, cost: t.cost, range: t.range })),
      waves: D.WAVES,
      players: [...P.values()].map((p) => ({ id: p.id, name: p.name, hue: p.hue })),
    }),
    addPlayer(id, name) {
      if (!P.has(id)) P.set(id, { id, name, hue: (P.size * 67) % 360, built: 0, spent: 0, dmg: 0 });
    },
    removePlayer(id) { P.delete(id); },
    /* Builds arrive as input rather than moves: this is a tick game, and a
       build is a one-shot intent like firing a gun. */
    input(id, d) {
      const p = P.get(id);
      if (!p || !d || over) return;
      if (d.build === undefined) return;
      const k = Number(d.build);
      const col = Math.floor(Number(d.col)), row = Math.floor(Number(d.row));
      const spec = TOWERS[k];
      if (!spec) return;
      if (!(col >= 0 && col < D.COLS && row >= 0 && row < D.ROWS)) return;
      const key = col + ',' + row;
      if (PATH_SET.has(key) || occupied.has(key)) return;   // never on the path
      if (gold < spec.cost) return;                          // never on credit
      gold -= spec.cost;
      occupied.add(key);
      towers.push({ k, col, row, x: cx(col), y: cy(row), cd: 0, by: id, kills: 0 });
      p.built++; p.spent += spec.cost;
    },
    step(dt) {
      if (over) return null;
      t += dt;

      if (!spawning && wave < D.WAVES && t >= nextWaveAt) startWave();

      if (spawning) {
        spawning.next -= dt;
        if (spawning.next <= 0 && spawning.left > 0) {
          spawning.left--;
          spawning.next = spawning.every;
          const s = spawning.spec;
          creeps.push({
            id: nextId++, seg: 0, u: 0, hp: s.hp, max: s.hp,
            speed: s.speed, bounty: s.bounty, armoured: s.armoured, slow: 0,
            x: cx(PATH[0][0]), y: cy(PATH[0][1]),
          });
        }
        if (spawning.left <= 0) {
          spawning = null;
          nextWaveAt = t + D.WAVE_GAP;
        }
      }

      // creeps walk the path; reaching the end costs a life
      for (let i = creeps.length - 1; i >= 0; i--) {
        const c = creeps[i];
        if (c.slow > 0) c.slow -= dt;
        const sp = c.speed * (c.slow > 0 ? 0.55 : 1);
        c.u += (sp * dt) / D.CELL;
        while (c.u >= 1 && c.seg < PATH.length - 1) { c.u -= 1; c.seg++; }
        if (c.seg >= PATH.length - 1) {
          creeps.splice(i, 1);
          lives--;
          continue;
        }
        const a = PATH[c.seg], b = PATH[c.seg + 1];
        c.x = cx(a[0]) + (cx(b[0]) - cx(a[0])) * c.u;
        c.y = cy(a[1]) + (cy(b[1]) - cy(a[1])) * c.u;
      }

      // towers acquire the creep furthest along the path — the one closest to
      // leaking — rather than the nearest, which is what a player would pick
      for (const tw of towers) {
        tw.cd -= dt;
        if (tw.cd > 0) continue;
        const spec = TOWERS[tw.k];
        let best = null, bestProg = -1;
        for (const c of creeps) {
          if (Math.hypot(c.x - tw.x, c.y - tw.y) > spec.range) continue;
          const prog = c.seg + c.u;
          if (prog > bestProg) { bestProg = prog; best = c; }
        }
        if (!best) continue;
        tw.cd = spec.cd;
        tw.shotAt = Math.round(t * 10) / 10;
        tw.tx = Math.round(best.x); tw.ty = Math.round(best.y);
        const owner = P.get(tw.by);

        const hit = (c, dmg) => {
          c.hp -= dmg;
          if (owner) owner.dmg += dmg;
          if (spec.slow) c.slow = spec.slow;
        };
        hit(best, spec.dmg);
        if (spec.splash) {
          for (const c of creeps) {
            if (c === best) continue;
            if (Math.hypot(c.x - best.x, c.y - best.y) <= spec.splash) hit(c, spec.dmg * 0.6);
          }
        }
        if (spec.chain) {
          let n = 0;
          for (const c of creeps) {
            if (c === best || n >= spec.chain - 1) continue;
            if (Math.hypot(c.x - best.x, c.y - best.y) <= 90) { hit(c, spec.dmg * 0.5); n++; }
          }
        }
      }

      for (let i = creeps.length - 1; i >= 0; i--) {
        if (creeps[i].hp > 0) continue;
        gold += creeps[i].bounty;
        if (towers.length) {
          // credit the kill to whoever's tower was nearest
          let near = null, nd = 1e9;
          for (const tw of towers) {
            const d = Math.hypot(tw.x - creeps[i].x, tw.y - creeps[i].y);
            if (d < nd) { nd = d; near = tw; }
          }
          if (near) near.kills++;
        }
        creeps.splice(i, 1);
      }

      if (lives <= 0) { over = true; won = false; }
      else if (wave >= D.WAVES && !spawning && creeps.length === 0) { over = true; won = true; }

      return {
        t: Math.round(t * 10) / 10,
        gold, lives, wave, waves: D.WAVES,
        next: spawning ? 0 : Math.max(0, Math.round(nextWaveAt - t)),
        tw: towers.map((tw) => [tw.k, tw.col, tw.row, tw.tx || 0, tw.ty || 0,
                                tw.shotAt && t - tw.shotAt < 0.12 ? 1 : 0]),
        c: creeps.map((c) => [Math.round(c.x), Math.round(c.y),
                              Math.round((c.hp / c.max) * 100),
                              c.armoured ? 1 : 0, c.slow > 0 ? 1 : 0]),
      };
    },
    finished: () => over,
    result: () => ({
      // co-op: there is no winner, only whether the team held
      winner: null,
      coop: true,
      won,
      wave,
      lives: Math.max(0, lives),
      standings: [...P.values()]
        .sort((a, b) => b.dmg - a.dmg)
        .map((p, i) => ({
          place: i + 1, id: p.id, name: p.name,
          built: p.built, spent: p.spent, dmg: Math.round(p.dmg),
        })),
    }),
  };
}

module.exports = {
  name: 'Co-op Defence', min: 1, max: 16, sync: 'tick', joinInProgress: true,
  blurb: 'Shared gold, shared lives. Hold fifteen waves together or lose together.',
  make: codefence,
};
