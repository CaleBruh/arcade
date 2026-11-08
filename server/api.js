/* HTTP JSON API for the asynchronous features.

   The single-player games are plain static files that must keep working with
   no server at all, so they talk to this over fetch() and degrade silently
   when it is absent. WebSockets would be wrong here: these are one-shot
   request/response calls from pages that are not in a room.          */
'use strict';
const store = require('./store');

const MAX_BODY = 256 * 1024;
const DAY_MS = 86400000;

/* ---- the daily gauntlet: same five games, same seed, for everyone today ---- */
/* Each leg names the localStorage key the game already writes its record to,
   so the gauntlet can measure a run without touching the games themselves. */
/* `par` is a decent run at that game. A leg is worth 100 x (score / par), so
   points from Missile Command and Lunar Lander are comparable and the total
   means something. Capped per leg so one carried game cannot be the whole run. */
const LEG_CAP = 400;
const GAUNTLET_POOL = [
  { id: 'missile-command.html', name: 'Missile Command', store: 'mc_highscore_v1',  unit: 'pts',      par: 4000 },
  { id: 'neon-swarm.html',      name: 'Neon Swarm',      store: 'neonswarm_best',   unit: 'pts',      par: 3000 },
  { id: 'ski.html',             name: 'Downhill',        store: 'ski_best',         unit: 'm',        par: 1200 },
  { id: 'horde.html',           name: 'Horde Survival',  store: 'hs_best_time',     unit: 's',        par: 120 },
  { id: 'racer.html',           name: 'Horizon Racer',   store: 'racer_best',       unit: 'm',        par: 2500 },
  { id: 'lunar-lander.html',    name: 'Lunar Lander',    store: 'll_best_landings', unit: 'landings', par: 5 },
  { id: 'miner.html',           name: 'Strata-9',        store: 'mine_best_depth',  unit: 'm',        par: 300 },
];
const legPoints = (raw, game) =>
  Math.min(LEG_CAP, Math.max(0, Math.round(100 * (Number(raw) || 0) / game.par)));

function dayKey(d = new Date()) {
  const m = d.getMonth() + 1, dd = d.getDate();
  return `${d.getFullYear()}-${m < 10 ? '0' : ''}${m}-${dd < 10 ? '0' : ''}${dd}`;
}
function seedFor(key) {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) { h ^= key.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
/* deterministic pick of three games for the day */
function gauntletFor(key) {
  const seed = seedFor(key);
  let a = seed;
  const rnd = () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1);
                      t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const pool = GAUNTLET_POOL.slice();
  const picks = [];
  for (let i = 0; i < 3 && pool.length; i++) picks.push(pool.splice(Math.floor(rnd() * pool.length), 1)[0]);
  return { date: key, seed, games: picks };
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let n = 0;
    const chunks = [];
    req.on('data', (c) => {
      n += c.length;
      if (n > MAX_BODY) { reject(new Error('body too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); }
      catch (e) { reject(new Error('bad json')); }
    });
    req.on('error', reject);
  });
}

const json = (res, code, obj) => {
  res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  res.end(JSON.stringify(obj));
};

const clean = (s, n) => String(s == null ? '' : s).slice(0, n);

/* Returns true if it handled the request. */
function handle(req, res, rel) {
  if (!rel.startsWith('/api/')) return false;
  const url = new URL(req.url, 'http://x');
  const route = rel.slice(5);

  // ---- GET ----
  if (req.method === 'GET') {
    if (route === 'daily') {
      const key = dayKey();
      const g = gauntletFor(key);
      return json(res, 200, { ...g, board: store.topScores('gauntlet:' + key, 20) }), true;
    }
    if (route === 'scores') {
      const game = clean(url.searchParams.get('game'), 40);
      return json(res, 200, { game, list: store.topScores(game, 20) }), true;
    }
    if (route === 'ghosts') {
      const game = clean(url.searchParams.get('game'), 40);
      return json(res, 200, { game, list: store.ghostsFor(game, 3) }), true;
    }
    if (route === 'tournament') {
      // standings aggregate every leaderboard: 5 points for a first place,
      // down to 1 for fifth, summed across games
      const d = store.load();
      const table = {};
      for (const [game, list] of Object.entries(d.scores)) {
        if (game.startsWith('gauntlet:')) continue;
        list.slice(0, 5).forEach((row, i) => {
          const t = table[row.name] || (table[row.name] = { name: row.name, points: 0, games: {} });
          t.points += 5 - i;
          t.games[game] = Math.max(t.games[game] || 0, 5 - i);
        });
      }
      const standings = Object.values(table).sort((a, b) => b.points - a.points).slice(0, 25);
      return json(res, 200, { standings, games: Object.keys(d.scores).filter((g) => !g.startsWith('gauntlet:')) }), true;
    }
    if (route === 'replays') {
      const d = store.load();
      const out = [];
      for (const [game, list] of Object.entries(d.ghosts)) {
        list.slice(0, 3).forEach((g) => out.push({ game, name: g.name, score: g.score, at: g.at }));
      }
      out.sort((a, b) => b.at - a.at);
      return json(res, 200, { list: out.slice(0, 30) }), true;
    }
    return json(res, 404, { error: 'unknown endpoint' }), true;
  }

  // ---- POST ----
  if (req.method === 'POST') {
    readBody(req).then((body) => {
      if (route === 'score') {
        const game = clean(body.game, 40);
        if (!game) return json(res, 400, { error: 'game required' });
        const place = store.submitScore(game, {
          name: clean(body.name, 16) || 'player',
          score: Number(body.score) || 0,
          detail: body.detail ? clean(body.detail, 40) : undefined,
          lowerIsBetter: !!body.lowerIsBetter,
        });
        return json(res, 200, { ok: true, place, list: store.topScores(game, 10) });
      }
      if (route === 'daily') {
        const key = dayKey();
        const g = gauntletFor(key);
        // only accept a result for today, and only for the games we set
        const legs = Array.isArray(body.legs) ? body.legs : [];
        if (body.date !== key) return json(res, 400, { error: 'that gauntlet has expired' });
        if (legs.length !== g.games.length) return json(res, 400, { error: 'incomplete run' });
        // the client sends raw per-game scores; we do the scoring, not it
        const pts = legs.map((v, i) => legPoints(v, g.games[i]));
        const total = pts.reduce((n, v) => n + v, 0);
        const place = store.submitScore('gauntlet:' + key, {
          name: clean(body.name, 16) || 'player',
          score: total,
          detail: pts.join(' / '),
        });
        return json(res, 200, { ok: true, place, total, legs: pts, board: store.topScores('gauntlet:' + key, 20) });
      }
      if (route === 'ghost') {
        const game = clean(body.game, 40);
        if (!game) return json(res, 400, { error: 'game required' });
        const frames = Array.isArray(body.frames) ? body.frames.slice(0, 4000) : [];
        if (!frames.length) return json(res, 400, { error: 'no frames' });
        store.saveGhost(game, {
          name: clean(body.name, 16) || 'player',
          score: Number(body.score) || 0,
          seed: body.seed === undefined ? null : body.seed,
          frames,
        });
        return json(res, 200, { ok: true, list: store.ghostsFor(game, 3).map((g) => ({ name: g.name, score: g.score })) });
      }
      return json(res, 404, { error: 'unknown endpoint' });
    }).catch((e) => json(res, 400, { error: e.message }));
    return true;
  }

  json(res, 405, { error: 'method not allowed' });
  return true;
}

module.exports = { handle, gauntletFor, dayKey, GAUNTLET_POOL };
