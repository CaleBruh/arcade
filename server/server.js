#!/usr/bin/env node
/* Arcade multiplayer server.
   Serves the existing static arcade AND hosts networked rooms, so one process
   is the whole deployment. No dependencies — see ws.js.

   Two sync models, picked per game:
     relay  — the server forwards moves and arbitrates turn order. Right for
              board games: tiny traffic, no server-side rules needed.
     tick   — the server owns the simulation, applies inputs and broadcasts
              snapshots at TICK_HZ. Required for action games and for anything
              where a client could otherwise lie about its position.

   Usage: node server/server.js [port]
*/
'use strict';
const http = require('http');
const os = require('os');
const fs = require('fs');
const path = require('path');
const { attach } = require('./ws');
const { GAMES, makeSim } = require('./games');
const store = require('./store');
const api = require('./api');

const ROOT = path.join(__dirname, '..');
const PORT = Number(process.argv[2]) || Number(process.env.PORT) || 8743;
const TICK_HZ = 20;
const ROOM_IDLE_MS = 5 * 60 * 1000;
// A dropped socket keeps its seat this long. Phones sleep, wifi hiccups, and
// losing your room because of a two-second blip is the worst possible UX.
const RESUME_GRACE_MS = 45 * 1000;
// public-deployment guards
const MAX_ROOMS = 200;
const MAX_CLIENTS = 400;
const MAX_MSG_BYTES = 64 * 1024;      // a sprouts curve is the largest legit payload
const MSG_BURST = 60;                 // messages allowed per window
const MSG_WINDOW_MS = 1000;

/* ---------------- static files ---------------- */
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
};

function serveStatic(req, res) {
  let rel = decodeURIComponent((req.url || '/').split('?')[0]);
  // redirect rather than serve: the lobby's relative script paths only
  // resolve correctly from inside /multiplayer/
  if (rel === '/') {
    res.writeHead(302, { location: '/multiplayer/lobby.html' });
    res.end();
    return;
  }
  // the async features (gauntlet, ghosts, tournament) talk over plain HTTP
  // so the static single-player games can reach them with fetch()
  if (api.handle(req, res, rel)) return;

  // hosts poll this to decide whether the instance is healthy
  if (rel === '/healthz') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({
      ok: true, uptime: Math.round(process.uptime()),
      rooms: rooms.size, clients: clients.size,
      rss: Math.round(process.memoryUsage().rss / 1048576),
      queued: queue.size,
      store: store.stats(),
    }));
    return;
  }
  const file = path.join(ROOT, rel);
  // never serve outside the arcade folder
  if (!file.startsWith(ROOT)) { res.writeHead(403).end('forbidden'); return; }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404).end('not found'); return; }
    res.writeHead(200, {
      'content-type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'cache-control': 'no-cache',
    });
    res.end(data);
  });
}

/* ---------------- rooms ---------------- */
let nextId = 1;
const clients = new Map();   // id -> client
const rooms = new Map();     // code -> room

/* ---------------- matchmaking ----------------
   A single queue of people who do not care which room they end up in. The
   point is that at a party nobody wants to read out a four-letter code; they
   want to press one button and be playing.

   The tension is between launching fast and launching full. Firing the
   instant a game has its minimum would mean endless two-player Sumo when
   twelve people are waiting, so a game that has reached its minimum still
   waits for FILL_MS to gather more — unless it has reached a decent size
   already, in which case waiting just annoys everyone.                   */
const queue = new Map();     // client id -> { game, since }
const QUEUE_FILL_MS = 8000;  // how long a viable match waits for more players
const QUEUE_TICK_MS = 1000;
const ANY = 'any';
const byToken = new Map();   // token -> client (including briefly-gone ones)

function newToken() {
  return require('crypto').randomBytes(16).toString('hex');
}

function roomCode() {
  const A = 'BCDFGHJKLMNPQRSTVWXYZ23456789';   // no vowels: no accidental words
  let c;
  do { c = Array.from({ length: 4 }, () => A[Math.floor(Math.random() * A.length)]).join(''); }
  while (rooms.has(c));
  return c;
}

/* A game must never be able to take the server down with it. Any throw from
   a sim kills only that room; everyone else keeps playing. */
function safeSim(room, fn, label) {
  try {
    return { ok: fn() };
  } catch (e) {
    console.error(`[room ${room ? room.code : '?'}] ${label} failed:`, e && e.message);
    if (room) {
      broadcast(room, { t: 'error', msg: 'this game hit an internal error and was stopped' });
      try { endRoom(room); } catch (e2) {}
    }
    return { failed: true };
  }
}

function send(cl, obj) { if (cl && cl.ws && cl.ws.open) cl.ws.send(JSON.stringify(obj)); }

function broadcast(room, obj, exceptId) {
  const s = JSON.stringify(obj);
  for (const id of room.players) {
    if (id === exceptId) continue;
    const cl = clients.get(id);
    if (cl && cl.ws && cl.ws.open) cl.ws.send(s);
  }
}

/* Some games must not show every player the same thing — Battleship would
   leak the enemy fleet. A sim may expose viewFor(id) to tailor state; the
   fallback is the shared view(). */
function sendState(room, sim) {
  if (sim.viewFor) {
    for (const id of room.players) {
      const cl = clients.get(id);
      if (cl && cl.ws && cl.ws.open) {
        cl.ws.send(JSON.stringify({ t: 'state', s: sim.viewFor(id) }));
      }
    }
  } else if (sim.view) {
    broadcast(room, { t: 'state', s: sim.view() });
  }
}

function roomView(room) {
  return {
    code: room.code,
    game: room.game,
    host: room.host,
    started: room.started,
    max: room.max,
    players: room.players.map((id) => {
      const c = clients.get(id);
      return { id, name: c ? c.name : '?', ready: c ? c.ready : false,
               away: !!(c && c.gone) };
    }),
  };
}

function enqueue(cl, game) {
  if (game !== ANY && !GAMES[game]) { send(cl, { t: 'error', msg: 'unknown game: ' + game }); return; }
  leaveRoom(cl);
  queue.set(cl.id, { game, since: Date.now() });
  sendQueueStatus();
}

function dequeue(cl) {
  if (!queue.delete(cl.id)) return;
  send(cl, { t: 'unqueued' });
  sendQueueStatus();
}

/* How many people are waiting who could play `game`: those who asked for it
   by name, plus everyone who said they would take anything. */
function waitingFor(game) {
  const named = [], any = [];
  for (const [id, q] of queue) {
    const cl = clients.get(id);
    if (!cl || cl.gone) continue;
    if (q.game === game) named.push({ id, since: q.since });
    else if (q.game === ANY) any.push({ id, since: q.since });
  }
  named.sort((a, b) => a.since - b.since);
  any.sort((a, b) => a.since - b.since);
  return { named, any, total: named.length + any.length };
}

function sendQueueStatus() {
  for (const [id, q] of queue) {
    const cl = clients.get(id);
    if (!cl) continue;
    if (q.game === ANY) {
      send(cl, { t: 'queued', game: ANY, n: queue.size, need: 2,
                 waiting: Math.round((Date.now() - q.since) / 1000) });
    } else {
      const def = GAMES[q.game];
      const w = waitingFor(q.game);
      send(cl, { t: 'queued', game: q.game, n: w.total, need: def ? def.min : 2,
                 waiting: Math.round((Date.now() - q.since) / 1000) });
    }
  }
}

/* Launch a match: build the room, move everyone in, and start it. Nobody is
   the host — a quick match has no lobby to host. */
function launch(game, ids) {
  const def = GAMES[game];
  if (!def || rooms.size >= MAX_ROOMS) return false;
  const members = ids.map((id) => clients.get(id)).filter((c) => c && !c.gone);
  if (members.length < def.min) return false;

  for (const cl of members) { queue.delete(cl.id); leaveRoom(cl); }

  const room = {
    code: roomCode(), game, host: members[0].id,
    players: members.map((c) => c.id),
    max: def.max, started: false, sim: null, timer: null, touched: Date.now(),
    quick: true,
  };
  rooms.set(room.code, room);
  for (const cl of members) { cl.room = room.code; cl.ready = true; }
  broadcast(room, { t: 'room', ...roomView(room) });
  startRoom(members[0]);
  return true;
}

function matchmakeTick() {
  if (!queue.size) return;
  const now = Date.now();

  // Try every game someone named, oldest waiter first, so nobody starves.
  const games = [...new Set([...queue.values()].map((q) => q.game))].filter((g) => g !== ANY);

  // Anyone on ANY should land in whichever game is closest to going.
  games.sort((a, b) => waitingFor(b).total - waitingFor(a).total);

  for (const game of games) {
    const def = GAMES[game];
    if (!def) continue;
    const w = waitingFor(game);
    if (w.total < def.min) continue;

    // a "good" game is a few more than the bare minimum, capped by the game
    const sweet = Math.min(def.max, Math.max(def.min, 4));
    const oldest = Math.min(...[...w.named, ...w.any].map((p) => p.since));
    const waited = now - oldest;
    if (w.total < sweet && waited < QUEUE_FILL_MS) continue;

    const take = [...w.named, ...w.any].slice(0, def.max).map((p) => p.id);
    if (launch(game, take)) { sendQueueStatus(); return; }   // one match per tick
  }

  /* Only ANY players left and none of them named a game: pick something they
     can all play rather than leaving them queued forever. */
  const onlyAny = [...queue.values()].every((q) => q.game === ANY);
  if (onlyAny && queue.size >= 2) {
    const oldest = Math.min(...[...queue.values()].map((q) => q.since));
    if (now - oldest >= QUEUE_FILL_MS) {
      const ids = [...queue.keys()];
      const fits = Object.entries(GAMES)
        .filter(([, g]) => g.min <= ids.length)
        .sort((a, b) => b[1].max - a[1].max);
      if (fits.length) {
        const pick = fits[Math.floor(Math.random() * Math.min(4, fits.length))][0];
        launch(pick, ids.slice(0, GAMES[pick].max));
        sendQueueStatus();
      }
    }
  }
}

setInterval(matchmakeTick, QUEUE_TICK_MS).unref();

function createRoom(cl, game, maxReq) {
  const def = GAMES[game];
  if (!def) { send(cl, { t: 'error', msg: 'unknown game: ' + game }); return; }
  if (rooms.size >= MAX_ROOMS) { send(cl, { t: 'error', msg: 'server is at capacity, try again shortly' }); return; }
  leaveRoom(cl);
  const max = Math.max(def.min, Math.min(def.max, maxReq || def.max));
  const room = {
    code: roomCode(), game, host: cl.id, players: [cl.id],
    max, started: false, sim: null, timer: null, touched: Date.now(),
  };
  rooms.set(room.code, room);
  cl.room = room.code;
  send(cl, { t: 'room', ...roomView(room) });
}

function joinRoom(cl, code) {
  const room = rooms.get(String(code || '').toUpperCase());
  if (!room) { send(cl, { t: 'error', msg: 'no such room' }); return; }
  if (room.players.length >= room.max) { send(cl, { t: 'error', msg: 'room full' }); return; }
  if (room.started && !GAMES[room.game].joinInProgress) {
    send(cl, { t: 'error', msg: 'game already started' }); return;
  }
  leaveRoom(cl);
  room.players.push(cl.id);
  cl.room = room.code;
  room.touched = Date.now();
  if (room.sim) {
    room.sim.addPlayer(cl.id, cl.name);
    // late joiners / spectators need the position and the running game
    send(cl, { t: 'start', ...roomView(room), init: room.sim.init() });
    const v = room.sim.viewFor ? room.sim.viewFor(cl.id) : (room.sim.view ? room.sim.view() : null);
    if (v) send(cl, { t: 'state', s: v });
  }
  broadcast(room, { t: 'room', ...roomView(room) });
}

function leaveRoom(cl) {
  if (!cl.room) return;
  const room = rooms.get(cl.room);
  cl.room = null;
  cl.ready = false;
  if (!room) return;
  room.players = room.players.filter((id) => id !== cl.id);
  if (room.sim) room.sim.removePlayer(cl.id);
  if (!room.players.length) { closeRoom(room); return; }
  if (room.host === cl.id) room.host = room.players[0];   // host migration
  broadcast(room, { t: 'room', ...roomView(room) });
}

function closeRoom(room) {
  if (room.timer) clearInterval(room.timer);
  rooms.delete(room.code);
}

function startRoom(cl) {
  const room = rooms.get(cl.room);
  if (!room || room.host !== cl.id || room.started) return;
  const def = GAMES[room.game];
  if (room.players.length < def.min) {
    send(cl, { t: 'error', msg: `needs at least ${def.min} players` });
    return;
  }
  room.started = true;
  const roster = room.players.map((id) => ({ id, name: clients.get(id).name }));
  const built = safeSim(room, () => {
    room.sim = makeSim(room.game, roster);
    return room.sim.init();
  }, 'init');
  if (built.failed) { room.started = false; room.sim = null; return; }
  broadcast(room, { t: 'start', ...roomView(room), init: built.ok });

  // Relay games only emit state after a move, so send the opening position
  // immediately or the first player stares at an empty board.
  if (def.sync === 'relay') sendState(room, room.sim);

  if (def.sync === 'tick') {
    room.timer = setInterval(() => {
      if (!room.sim) return;
      const r = safeSim(room, () => {
        const snap = room.sim.step(1 / TICK_HZ);
        if (snap) broadcast(room, { t: 'state', s: snap });
        return room.sim.finished && room.sim.finished();
      }, 'step');
      if (r.failed) return;
      if (r.ok) endRoom(room);
    }, 1000 / TICK_HZ);
  }
}

function endRoom(room) {
  if (room.timer) { clearInterval(room.timer); room.timer = null; }
  room.started = false;
  let result = null;
  try { result = room.sim && room.sim.result ? room.sim.result() : null; }
  catch (e) { console.error('result() failed:', e.message); }
  room.sim = null;
  if (result) { try { record(room, result); } catch (e) { console.error('record failed:', e.message); } }
  broadcast(room, { t: 'over', result, ...roomView(room) });
}

/* Durable record of a finished game: a leaderboard row for the winner and a
   win/played tally per player, keyed by their resume token so the same person
   accumulates a record across sessions. */
function record(room, result) {
  const def = GAMES[room.game];
  const winner = result.winner;
  for (const id of room.players) {
    const cl = clients.get(id);
    if (!cl) continue;
    const prof = store.profile(cl.token) || {};
    store.updateProfile(cl.token, {
      name: cl.name,
      played: (prof.played || 0) + 1,
      wins: (prof.wins || 0) + (id === winner ? 1 : 0),
    });
  }
  if (winner === null || winner === undefined || winner === 'draw') return;
  const wc = clients.get(winner);
  if (!wc) return;
  // prefer a game-specific figure when the sim reports one
  const row = (result.standings || []).find((x) => x.id === winner) || {};
  const score = Number(row.kills ?? row.laps ?? (result.score && Math.max(...result.score)) ?? 1);
  store.submitScore(room.game, {
    name: wc.name,
    score: isFinite(score) ? score : 1,
    detail: def ? def.name : room.game,
  });
}

/* ---------------- connection handling ---------------- */
const server = http.createServer(serveStatic);

const GAMELIST = () => Object.entries(GAMES).map(([k, g]) => ({
  id: k, name: g.name, min: g.min, max: g.max, sync: g.sync, blurb: g.blurb,
}));

attach(server, '/ws', (ws) => {
  let cl = null;

  function greet(c, resumed) {
    send(c, { t: 'welcome', id: c.id, token: c.token, resumed: !!resumed, games: GAMELIST() });
    if (resumed && c.room) {
      const room = rooms.get(c.room);
      if (room) {
        send(c, { t: 'room', ...roomView(room) });
        if (room.started && room.sim) {
          send(c, { t: 'start', ...roomView(room), init: room.sim.init() });
          const rv = room.sim.viewFor ? room.sim.viewFor(c.id)
                                      : (room.sim.view ? room.sim.view() : null);
          if (rv) send(c, { t: 'state', s: rv });
        }
      } else {
        c.room = null;
      }
    }
  }

  function attachNew() {
    if (clients.size >= MAX_CLIENTS) {
      try { ws.send(JSON.stringify({ t: 'error', msg: 'server is full' })); } catch (e) {}
      ws.close(1013);
      return;
    }
    cl = { id: nextId++, ws, name: 'player', room: null, ready: false,
           token: newToken(), gone: 0 };
    clients.set(cl.id, cl);
    byToken.set(cl.token, cl);
    greet(cl, false);
  }

  // Wait one tick for a resume attempt; if none arrives, hand out a new identity.
  const graceTimer = setTimeout(() => { if (!cl) attachNew(); }, 250);

  let bucket = 0, bucketAt = Date.now();

  ws.on('message', (raw) => {
    // oversized or spammed messages are dropped before they reach a sim
    if (raw.length > MAX_MSG_BYTES) { ws.close(1009); return; }
    const now = Date.now();
    if (now - bucketAt > MSG_WINDOW_MS) { bucket = 0; bucketAt = now; }
    if (++bucket > MSG_BURST) return;

    let m;
    try { m = JSON.parse(raw); } catch (e) { return; }
    if (!m || typeof m.t !== 'string') return;

    if (m.t === 'resume') {
      clearTimeout(graceTimer);
      const old = byToken.get(String(m.token || ''));
      if (old && old.gone && clients.has(old.id)) {
        if (old.ws && old.ws !== ws) { try { old.ws.close(1000); } catch (e) {} }
        old.ws = ws;
        old.gone = 0;
        cl = old;
        greet(cl, true);
        const r = cl.room ? rooms.get(cl.room) : null;
        if (r) broadcast(r, { t: 'room', ...roomView(r) });
        return;
      }
      if (!cl) attachNew();
      return;
    }
    if (!cl) { clearTimeout(graceTimer); attachNew(); }
    if (!cl) return;                       // refused: server full

    const room = cl.room ? rooms.get(cl.room) : null;
    if (room) room.touched = Date.now();

    switch (m.t) {
      case 'name':
        cl.name = String(m.name || 'player').slice(0, 16);
        if (room) broadcast(room, { t: 'room', ...roomView(room) });
        break;
      case 'create': dequeue(cl); createRoom(cl, m.game, m.max); break;
      case 'queue':   enqueue(cl, m.game === ANY ? ANY : String(m.game || ANY)); break;
      case 'unqueue': dequeue(cl); break;
      case 'join':   dequeue(cl); joinRoom(cl, m.code); break;
      case 'leave':  leaveRoom(cl); send(cl, { t: 'left' }); break;
      case 'ready':
        cl.ready = !!m.ready;
        if (room) broadcast(room, { t: 'room', ...roomView(room) });
        break;
      case 'start':  startRoom(cl); break;
      case 'rooms':
        send(cl, { t: 'rooms', list: [...rooms.values()]
          .filter((r) => !r.started || GAMES[r.game].joinInProgress)
          .map((r) => ({ code: r.code, game: r.game, n: r.players.length, max: r.max })) });
        break;
      case 'move':   // turn-based: the sim validates and decides who is next
        if (room && room.sim && GAMES[room.game].sync === 'relay') {
          const r = safeSim(room, () => room.sim.move(cl.id, m.d), 'move');
          if (r.failed) break;
          if (r.ok && r.ok.error) { send(cl, { t: 'error', msg: r.ok.error }); break; }
          const r2 = safeSim(room, () => {
            sendState(room, room.sim);
            return room.sim.finished && room.sim.finished();
          }, 'view');
          if (!r2.failed && r2.ok) endRoom(room);
        }
        break;
      case 'input':  // realtime: queue for the next tick
        if (room && room.sim && GAMES[room.game].sync === 'tick') {
          safeSim(room, () => room.sim.input(cl.id, m.d), 'input');
        }
        break;
      case 'scores':
        send(cl, { t: 'scores', game: m.game,
                   list: store.topScores(String(m.game || '').slice(0, 32), 10) });
        break;
      case 'me':
        send(cl, { t: 'me', profile: store.profile(cl.token) });
        break;
      case 'ping': send(cl, { t: 'pong', ts: m.ts }); break;
    }
  });

  ws.on('close', () => {
    clearTimeout(graceTimer);
    if (!cl || cl.ws !== ws) return;        // superseded by a resumed socket
    cl.gone = Date.now();
    const room = cl.room ? rooms.get(cl.room) : null;
    if (room) broadcast(room, { t: 'room', ...roomView(room) });
  });
});

/* heartbeat: drop sockets that stop answering, and sweep idle rooms */
setInterval(() => {
  const now = Date.now();
  for (const cl of [...clients.values()]) {
    if (cl.gone) {
      if (now - cl.gone > RESUME_GRACE_MS) {   // never coming back
        queue.delete(cl.id);
        leaveRoom(cl);
        byToken.delete(cl.token);
        clients.delete(cl.id);
      }
      continue;
    }
    if (!cl.ws.isAlive) { cl.ws.close(1001); continue; }
    cl.ws.ping();
  }
  for (const room of [...rooms.values()]) {
    if (!room.players.length || now - room.touched > ROOM_IDLE_MS) closeRoom(room);
  }
}, 30000);

/* Last resort. Everything above should prevent these, but a public service
   must not vanish because of one unanticipated throw. */
process.on('uncaughtException', (e) => {
  console.error('uncaughtException (staying up):', e && e.stack || e);
});
process.on('unhandledRejection', (e) => {
  console.error('unhandledRejection (staying up):', e);
});

/* Every non-internal IPv4 address this machine answers on.

   This matters more than it looks. The common way to run this is one laptop
   on a venue's wifi with everyone else on their phones, and "localhost" is
   useless to them — they need the address of this machine on that network.
   Printing it removes the step where somebody reads an IP out loud twice. */
function lanAddresses() {
  const out = [];
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const net of ifaces[name] || []) {
      if (net.family !== 'IPv4' && net.family !== 4) continue;
      if (net.internal) continue;
      out.push({ name, address: net.address });
    }
  }
  return out;
}

server.listen(PORT, '0.0.0.0', () => {
  const lan = lanAddresses();
  console.log('');
  console.log(`  arcade multiplayer — listening on port ${PORT}`);
  console.log('');
  console.log(`  on this machine   http://localhost:${PORT}/`);
  if (lan.length) {
    console.log('');
    console.log('  share one of these with everyone on the same wifi:');
    for (const n of lan) console.log(`      http://${n.address}:${PORT}/        (${n.name})`);
  } else {
    console.log('');
    console.log('  no network interface found — others cannot reach this machine');
  }
  console.log('');
  console.log(`  lobby   /multiplayer/lobby.html`);
  console.log(`  daily   /multiplayer/async.html`);
  console.log(`  data    ${store.stats().file}`);
  console.log('');
});

module.exports = { server };
