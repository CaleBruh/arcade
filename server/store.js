/* Durable storage for leaderboards, profiles, ghosts and tournaments.

   A JSON file, not a database, because the whole arcade is dependency-free and
   the data is small and read-mostly. What matters is that it survives a
   restart or a deploy without losing or corrupting anything, so:

     - writes are atomic (temp file + rename, which is atomic on POSIX), so a
       crash mid-write can never leave a half-written file
     - writes are debounced, so a busy minute is one disk write, not hundreds
     - SIGTERM/SIGINT flush synchronously before exit — hosts send SIGTERM on
       every deploy, and losing the last minute of scores each time is not
       acceptable
     - a corrupt or unreadable file is moved aside and we start clean rather
       than crash-looping on boot
     - every collection is capped so disk use cannot grow without bound     */
'use strict';
const fs = require('fs');
const path = require('path');

const DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const FILE = path.join(DIR, 'arcade.json');
const TMP = FILE + '.tmp';
const SCHEMA = 1;
const FLUSH_MS = 4000;

const CAPS = {
  scores: 50,        // per game leaderboard
  ghosts: 20,        // per game
  profiles: 5000,
  events: 200,       // tournaments / dailies
};

let db = null;
let dirty = false;
let timer = null;

function blank() {
  return { schema: SCHEMA, scores: {}, ghosts: {}, profiles: {}, events: {}, meta: {} };
}

function load() {
  if (db) return db;
  try {
    fs.mkdirSync(DIR, { recursive: true });
  } catch (e) {
    console.error('store: cannot create data dir, running in memory only:', e.message);
    db = blank();
    return db;
  }
  try {
    const raw = fs.readFileSync(FILE, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || !parsed.schema) throw new Error('not an arcade store');
    db = Object.assign(blank(), parsed);
    db.schema = SCHEMA;
  } catch (e) {
    if (e.code !== 'ENOENT') {
      // Keep the bad file for inspection instead of silently destroying data.
      const bak = FILE + '.corrupt.' + Date.now();
      try { fs.renameSync(FILE, bak); console.error(`store: unreadable (${e.message}); moved to ${bak}`); }
      catch (e2) { console.error('store: unreadable and could not be moved:', e2.message); }
    }
    db = blank();
  }
  return db;
}

function markDirty() {
  dirty = true;
  if (timer) return;
  timer = setTimeout(() => { timer = null; flush(); }, FLUSH_MS);
  if (timer.unref) timer.unref();          // never hold the process open
}

function flush() {
  if (!db || !dirty) return false;
  try {
    fs.writeFileSync(TMP, JSON.stringify(db), 'utf8');
    fs.renameSync(TMP, FILE);              // atomic: readers see old or new, never half
    dirty = false;
    return true;
  } catch (e) {
    console.error('store: write failed:', e.message);
    return false;
  }
}

/* ---------- leaderboards ---------- */
function submitScore(game, entry) {
  const d = load();
  const list = d.scores[game] || (d.scores[game] = []);
  const row = {
    name: String(entry.name || 'player').slice(0, 16),
    score: Number(entry.score) || 0,
    detail: entry.detail ? String(entry.detail).slice(0, 40) : undefined,
    at: Number(entry.at) || Date.now(),
  };
  list.push(row);
  // higher is better unless the game says otherwise (times, strokes)
  list.sort((a, b) => (entry.lowerIsBetter ? a.score - b.score : b.score - a.score));
  if (list.length > CAPS.scores) list.length = CAPS.scores;
  markDirty();
  return list.indexOf(row) + 1;            // 1-based placing, 0 if it fell off
}

function topScores(game, n = 10) {
  const d = load();
  return (d.scores[game] || []).slice(0, n);
}

/* ---------- ghosts (recorded runs) ---------- */
function saveGhost(game, ghost) {
  const d = load();
  const list = d.ghosts[game] || (d.ghosts[game] = []);
  const frames = Array.isArray(ghost.frames) ? ghost.frames.slice(0, 4000) : [];
  list.push({
    name: String(ghost.name || 'player').slice(0, 16),
    score: Number(ghost.score) || 0,
    seed: ghost.seed === undefined ? null : ghost.seed,
    frames,
    at: Date.now(),
  });
  list.sort((a, b) => b.score - a.score);
  if (list.length > CAPS.ghosts) list.length = CAPS.ghosts;
  markDirty();
  return true;
}

function ghostsFor(game, n = 5) {
  const d = load();
  return (d.ghosts[game] || []).slice(0, n)
    .map((g) => ({ name: g.name, score: g.score, seed: g.seed, frames: g.frames }));
}

/* ---------- player profiles ---------- */
function profile(key) {
  const d = load();
  return d.profiles[key] || null;
}

function updateProfile(key, patch) {
  const d = load();
  const k = String(key).slice(0, 64);
  const cur = d.profiles[k] || { created: Date.now(), wins: 0, played: 0 };
  const next = Object.assign(cur, patch, { seen: Date.now() });
  d.profiles[k] = next;
  // if we are over the cap, drop the least recently seen
  const keys = Object.keys(d.profiles);
  if (keys.length > CAPS.profiles) {
    keys.sort((a, b) => (d.profiles[a].seen || 0) - (d.profiles[b].seen || 0));
    for (let i = 0; i < keys.length - CAPS.profiles; i++) delete d.profiles[keys[i]];
  }
  markDirty();
  return next;
}

/* ---------- generic namespaced events (tournaments, dailies) ---------- */
function getEvent(key) {
  const d = load();
  return d.events[key] || null;
}

function setEvent(key, value) {
  const d = load();
  d.events[String(key).slice(0, 64)] = value;
  const keys = Object.keys(d.events);
  if (keys.length > CAPS.events) {
    keys.sort();
    for (let i = 0; i < keys.length - CAPS.events; i++) delete d.events[keys[i]];
  }
  markDirty();
  return value;
}

function stats() {
  const d = load();
  return {
    schema: d.schema,
    games: Object.keys(d.scores).length,
    scores: Object.values(d.scores).reduce((n, l) => n + l.length, 0),
    ghosts: Object.values(d.ghosts).reduce((n, l) => n + l.length, 0),
    profiles: Object.keys(d.profiles).length,
    events: Object.keys(d.events).length,
    dirty,
    file: FILE,
  };
}

/* Hosts send SIGTERM on deploy. Flush synchronously or lose the last
   FLUSH_MS of play on every single release. */
let closing = false;
function shutdown(signal) {
  if (closing) return;
  closing = true;
  const wrote = flush();
  console.log(`store: ${signal} — ${wrote ? 'flushed to disk' : 'nothing pending'}`);
  process.exit(0);
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('beforeExit', () => flush());

module.exports = {
  load, flush, stats,
  submitScore, topScores,
  saveGhost, ghostsFor,
  profile, updateProfile,
  getEvent, setEvent,
  _file: FILE, _caps: CAPS,
};
