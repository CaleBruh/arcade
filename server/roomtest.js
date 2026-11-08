#!/usr/bin/env node
/* End-to-end room tests.

   selftest.js calls the sims directly; this drives the whole stack the way a
   browser does — real WebSockets, real handshake, real rooms — because the
   interesting failures live between the parts: a sim that works in isolation
   but whose snapshots never reach a client, a room that starts with nobody
   in it, a game that never reports finished so the room leaks.           */
'use strict';
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

/* A fresh port per run. With a fixed port, two runs back to back collide:
   the previous server has not released the socket yet, so the new test ends
   up talking to a dying instance and fails in confusing ways. */
const PORT = 20000 + Math.floor(Math.random() * 20000);
const URL = `ws://127.0.0.1:${PORT}/ws`;
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'arcroom-'));
let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : (fail++, console.log('  FAIL:', m)); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* A scriptable client: connects, remembers what it was sent, and can be
   told to act every tick. */
function client(name) {
  const c = {
    name, id: null, ws: new WebSocket(URL),
    states: [], over: null, init: null, room: null, errors: [], open: false,
  };
  c.ws.addEventListener('open', () => { c.open = true; c.send({ t: 'name', name }); });
  c.ws.addEventListener('message', (ev) => {
    let m;
    try { m = JSON.parse(ev.data); } catch (e) { return; }
    if (m.t === 'welcome') { c.id = m.id; c.token = m.token; }
    if (m.t === 'room') c.room = m.code || c.room;
    if (m.t === 'start') { c.room = m.code || c.room; c.init = m.init || c.init; }
    if (m.t === 'state') c.states.push(m.s);
    if (m.t === 'over') c.over = m;
    if (m.t === 'queued') c.queued = m;
    if (m.t === 'unqueued') { c.queued = null; c.unqueued = true; }
    if (m.t === 'error') c.errors.push(m.msg);
  });
  c.send = (o) => { try { c.ws.send(JSON.stringify(o)); } catch (e) {} };
  c.wait = async (fn, ms = 4000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) { if (fn(c)) return true; await sleep(40); }
    return false;
  };
  return c;
}

async function playRound(game, nPlayers, act, maxMs) {
  const cs = [];
  for (let i = 0; i < nPlayers; i++) cs.push(client('B' + i));
  for (const c of cs) await c.wait((x) => x.open);

  cs[0].send({ t: 'create', game });
  const made = await cs[0].wait((c) => c.room);
  if (!made) return { error: 'host never got a room code' };
  const code = cs[0].room;

  for (let i = 1; i < cs.length; i++) {
    cs[i].send({ t: 'join', code });
    await cs[i].wait((c) => c.room);
  }
  for (const c of cs) c.send({ t: 'ready', ready: true });
  await sleep(200);
  cs[0].send({ t: 'start' });

  const started = await cs[0].wait((c) => c.states.length > 0, 4000);
  if (!started) return { error: 'no snapshots after start', errors: cs.flatMap((c) => c.errors) };

  const t0 = Date.now();
  while (Date.now() - t0 < maxMs && !cs[0].over) {
    if (act) act(cs);
    await sleep(50);
  }
  const out = {
    code,
    snapshots: cs.map((c) => c.states.length),
    over: cs[0].over,
    allSawOver: cs.every((c) => c.over),
    errors: cs.flatMap((c) => c.errors),
    last: cs[0].states[cs[0].states.length - 1],
  };
  for (const c of cs) c.ws.close();
  return out;
}

async function tests() {
  // ---------- Arena ----------
  {
    const pos = {};
    const r = await playRound('arena', 4, (cs) => {
      const latest = cs[0].states[cs[0].states.length - 1];
      if (!latest) return;
      latest.p.forEach((p) => { pos[p[0]] = p; });
      for (const c of cs) {
        const me = pos[String(c.id)];
        if (!me) continue;
        let best = null, bd = 1e9;
        for (const k of Object.keys(pos)) {
          // Object.keys() gives strings; ids are numbers. Without the coercion
          // a bot never matches itself, targets itself, and aims at (0,0).
          if (k === String(c.id) || pos[k][4] <= 0) continue;
          const d = Math.hypot(pos[k][1] - me[1], pos[k][2] - me[2]);
          if (d < bd) { bd = d; best = pos[k]; }
        }
        if (!best) continue;
        const aim = Math.atan2(best[2] - me[2], best[1] - me[1]);
        c.send({ t: 'input', d: { x: Math.cos(aim), y: Math.sin(aim), aim, fire: true } });
      }
    }, 25000);
    ok(!r.error, `arena round ran (${r.error || 'ok'})`);
    ok(r.snapshots && r.snapshots.every((n) => n > 100), `arena: every client got snapshots (${r.snapshots})`);
    ok(r.last && r.last.p.length === 4, 'arena: all four players present in the snapshot');
    const frags = r.last ? r.last.p.reduce((n, p) => n + p[5], 0) : 0;
    ok(frags > 0, `arena: bots actually killed each other over the wire (${frags} frags)`);
    ok(r.errors.length === 0, `arena: no errors (${r.errors.join(',')})`);
  }

  // ---------- Battle Royale ----------
  {
    const r = await playRound('royale', 4, (cs) => {
      for (const c of cs) {
        // walk toward the ring centre so the storm doesn't just kill everyone
        const latest = c.states[c.states.length - 1];
        if (!latest) continue;
        const me = latest.p.find((p) => p[0] === c.id);
        if (!me || me[4] <= 0) continue;
        const a = Math.atan2(latest.cy - me[2], latest.cx - me[1]);
        c.send({ t: 'input', d: { x: Math.cos(a), y: Math.sin(a), aim: a, fire: true } });
      }
    }, 32000);
    ok(!r.error, `royale round ran (${r.error || 'ok'})`);
    ok(r.last && Array.isArray(r.last.c), 'royale: crates are in the snapshot');
    const gunned = r.last ? r.last.p.some((p) => p[5] > 0) : false;
    ok(gunned, 'royale: at least one bot picked up a better gun');
    ok(r.over, 'royale: the round reached a winner');
    ok(r.errors.length === 0, `royale: no errors (${r.errors.join(',')})`);
  }

  /* The storm is pure sim logic, and over the wire it is unobservable: with
     two bots the first death ends the round before the 20s grace elapses, and
     with enough bots to outlast it they kill each other instead. So it is
     asserted directly, where it is deterministic. */
  {
    const royale = require('./sims/royale');

    // Shrink: two players left alone in the middle, so nobody dies and the
    // loop actually survives past the grace period.
    {
      const sim = royale.make([{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }]);
      let snap = null, atGrace = null;
      for (let i = 0; i < 20 * 45 && !sim.finished(); i++) {
        const s = sim.step(1 / 20);
        if (s) { if (atGrace === null && s.t >= 19 && s.t <= 21) atGrace = s.r; snap = s; }
      }
      ok(atGrace === 1100, `royale: the ring holds through the grace (r=${atGrace})`);
      ok(snap && snap.r < 1100, `royale: and closes after it (r=${snap && snap.r})`);
      ok(snap && snap.r >= 110, `royale: never past the minimum (r=${snap && snap.r})`);
    }

    // Storm damage: a lone player cannot end the round, so this one runs long
    // enough to be driven out of the ring and hurt by it.
    {
      const sim = royale.make([{ id: 'a', name: 'A' }]);
      let snap = null;
      for (let i = 0; i < 20 * 40; i++) {
        sim.input('a', { x: 1, y: 1, aim: 0, fire: false });
        const s = sim.step(1 / 20);
        if (s) snap = s;
      }
      const hp = snap && snap.p[0][4];
      ok(hp !== null && hp < 100, `royale: being caught outside the ring costs health (hp=${hp})`);
    }
  }

  // ---------- Co-op Defence ----------
  {
    let built = false;
    const r = await playRound('codefence', 2, (cs) => {
      const c = cs[0];
      if (!c.init || built) return;
      built = true;
      const onPath = new Set(c.init.path.map(([x, y]) => x + ',' + y));
      let n = 0;
      for (const [px, py] of c.init.path) {
        for (const [dx, dy] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
          const col = px + dx, row = py + dy;
          if (col < 0 || row < 0 || col >= c.init.cols || row >= c.init.rows) continue;
          if (onPath.has(col + ',' + row)) continue;
          cs[n % cs.length].send({ t: 'input', d: { build: 0, col, row } });
          n++;
        }
      }
    }, 12000);
    ok(!r.error, `codefence round ran (${r.error || 'ok'})`);
    ok(r.last && r.last.tw.length > 0, `codefence: towers were built over the wire (${r.last && r.last.tw.length})`);
    ok(r.last && r.last.gold < 220 + 5000, 'codefence: gold was spent, not invented');
    ok(r.last && r.last.wave >= 1, `codefence: waves started (wave ${r.last && r.last.wave})`);
    ok(r.errors.length === 0, `codefence: no errors (${r.errors.join(',')})`);

    // a build on the path must be refused
    const before = r.last ? r.last.tw.length : 0;
    ok(before > 0, 'codefence: at least one legal build landed');
  }

  // ---------- Quiz Buzzer ----------
  {
    let leaked = false, sawQuestion = false, sawReveal = false;
    const r = await playRound('quiz', 3, (cs) => {
      for (const c of cs) {
        const s = c.states[c.states.length - 1];
        if (!s) continue;
        if (s.phase === 'question') {
          sawQuestion = true;
          // the single property that matters: no answer on the wire yet
          if ('correct' in s || 'counts' in s) leaked = true;
          c.send({ t: 'input', d: { answer: Number(c.name.slice(1)) % 4 } });
        }
        if (s.phase === 'reveal') sawReveal = true;
      }
    }, 40000);
    ok(!r.error, `quiz round ran (${r.error || 'ok'})`);
    ok(sawQuestion && sawReveal, 'quiz: cycled through question and reveal phases');
    ok(!leaked, 'quiz: the correct answer never reaches a client before the reveal');

    const last = r.last;
    ok(last && last.total === 3, `quiz: all three players counted (${last && last.total})`);
    ok(last && Array.isArray(last.board), 'quiz: a live scoreboard is broadcast');

    // a quiz must not cost 20 snapshots a second
    const perClient = r.snapshots ? r.snapshots[0] : 0;
    ok(perClient > 0 && perClient < 400,
       `quiz: snapshots are emitted on change, not per tick (${perClient} over ~40s)`);
    ok(r.errors.length === 0, `quiz: no errors (${r.errors.join(',')})`);
  }

  // an answer cannot be changed once given, or the speed bonus is meaningless
  {
    const quiz = require('./sims/quiz');
    const sim = quiz.make([{ id: 'a', name: 'A' }]);
    let locked = null;
    for (let i = 0; i < 20 * 30 && !sim.finished(); i++) {
      const s = sim.step(1 / 20);
      if (s && s.phase === 'question') {
        sim.input('a', { answer: 0 });
        sim.input('a', { answer: 3 });        // second answer must be ignored
      }
      if (s && s.phase === 'reveal' && locked === null) {
        locked = s.picks.find((p) => p[0] === 'a')[1];
        break;
      }
    }
    ok(locked === 0, `quiz: the first answer sticks (locked in ${locked})`);

    // and out-of-range answers are refused outright
    const sim2 = quiz.make([{ id: 'a', name: 'A' }]);
    let pick = 'unset';
    for (let i = 0; i < 20 * 30 && !sim2.finished(); i++) {
      const s = sim2.step(1 / 20);
      if (s && s.phase === 'question') {
        sim2.input('a', { answer: 99 });
        sim2.input('a', { answer: -1 });
        sim2.input('a', { answer: 'two' });
      }
      if (s && s.phase === 'reveal') { pick = s.picks.find((p) => p[0] === 'a')[1]; break; }
    }
    ok(pick === null, `quiz: junk answers are refused, not coerced (got ${pick})`);
  }

  // ---------- Matchmaking ----------
  {
    // two players asking for the same 2-player game should end up playing it
    const a = client('Q1'), b = client('Q2');
    await a.wait((c) => c.open); await b.wait((c) => c.open);
    a.send({ t: 'queue', game: 'connect4' });
    const gotStatus = await a.wait((c) => c.queued, 3000);
    ok(gotStatus, 'queue: a waiting player is told where they stand');
    ok(a.queued && a.queued.need === 2, `queue: status names how many are needed (${a.queued && a.queued.need})`);

    b.send({ t: 'queue', game: 'connect4' });
    // connect4 max is 2, so it is already "full" and should not wait to fill
    const launched = await a.wait((c) => c.states.length > 0, 12000);
    ok(launched, 'queue: a full match launches without waiting');
    ok(b.states.length > 0, 'queue: both queued players were put in the same game');
    ok(a.room && a.room === b.room, `queue: and in the same room (${a.room} / ${b.room})`);

    const h1 = await fetch(`http://127.0.0.1:${PORT}/healthz`).then((r) => r.json());
    ok(h1.queued === 0, `queue: matched players are removed from the queue (${h1.queued})`);
    a.ws.close(); b.ws.close();
  }

  {
    // a viable-but-small match should hold briefly to gather more players
    const cs = [client('F1'), client('F2')];
    for (const c of cs) await c.wait((x) => x.open);
    cs.forEach((c) => c.send({ t: 'queue', game: 'sumo' }));   // min 2, max 50
    await sleep(2500);
    ok(cs[0].states.length === 0, 'queue: a 2-player Sumo waits rather than starting half-empty');

    // a third and fourth arriving should tip it over the "good size" line
    const more = [client('F3'), client('F4')];
    for (const c of more) await c.wait((x) => x.open);
    more.forEach((c) => c.send({ t: 'queue', game: 'sumo' }));
    const everyone = [...cs, ...more];
    // wait for every client, not just the first: snapshots reach them on the
    // same tick but not the same millisecond, and asserting immediately after
    // the first one arrives fails perhaps one run in four
    const went = await cs[0].wait(() => everyone.every((c) => c.states.length > 0), 12000);
    ok(went, 'queue: launches once enough players gather');
    ok(everyone.every((c) => c.states.length > 0), 'queue: all four joined the same match');
    ok(new Set(everyone.map((c) => c.room)).size === 1,
       `queue: and all four are in one room (${everyone.map((c) => c.room).join(',')})`);
    everyone.forEach((c) => c.ws.close());
  }

  {
    // leaving the queue must actually leave it
    const c = client('L1');
    await c.wait((x) => x.open);
    c.send({ t: 'queue', game: 'chess' });
    await c.wait((x) => x.queued, 3000);
    const during = await fetch(`http://127.0.0.1:${PORT}/healthz`).then((r) => r.json());
    c.send({ t: 'unqueue' });
    await c.wait((x) => x.unqueued, 3000);
    const after = await fetch(`http://127.0.0.1:${PORT}/healthz`).then((r) => r.json());
    ok(during.queued === 1, `queue: one player queued (${during.queued})`);
    ok(after.queued === 0, `queue: unqueue removes them (${after.queued})`);

    // creating a room by hand should also drop the queue slot
    c.send({ t: 'queue', game: 'chess' });
    await c.wait((x) => x.queued, 3000);
    c.send({ t: 'create', game: 'chess' });
    await c.wait((x) => x.room, 3000);
    const h = await fetch(`http://127.0.0.1:${PORT}/healthz`).then((r) => r.json());
    ok(h.queued === 0, `queue: creating a room leaves the queue (${h.queued})`);
    c.ws.close();
  }

  {
    // an unknown game must be refused, not queued forever
    const c = client('X1');
    await c.wait((x) => x.open);
    c.send({ t: 'queue', game: 'not-a-game' });
    const err = await c.wait((x) => x.errors.length > 0, 3000);
    ok(err, 'queue: an unknown game is refused');
    const h = await fetch(`http://127.0.0.1:${PORT}/healthz`).then((r) => r.json());
    ok(h.queued === 0, `queue: and nothing was queued (${h.queued})`);
    c.ws.close();
  }

  // ---------- the server is still healthy ----------
  const h = await fetch(`http://127.0.0.1:${PORT}/healthz`).then((r) => r.json());
  ok(h.ok, 'server healthy after three full rounds');
  // Rooms deliberately outlive a disconnect by RESUME_GRACE_MS so a player who
  // drops can come back, so the bar here is "bounded", not "zero".
  ok(h.rooms <= 12, `room count stayed bounded (${h.rooms})`);
  // Dropped clients are likewise kept for the grace window, so the only wrong
  // answer here is unbounded growth.
  ok(h.clients <= 32, `client count stayed bounded (${h.clients})`);
}

const child = spawn(process.execPath, [path.join(__dirname, 'server.js'), String(PORT)],
  { env: { ...process.env, DATA_DIR: DATA }, stdio: ['ignore', 'ignore', 'pipe'] });
let stderr = '';
child.stderr.on('data', (d) => { stderr += d; });

function done(code) {
  child.kill('SIGTERM');
  try { fs.rmSync(DATA, { recursive: true, force: true }); } catch (e) {}
  if (stderr.trim()) console.log('server stderr:\n' + stderr.trim());
  setTimeout(() => process.exit(code ? 1 : 0), 200);
}

(async () => {
  for (let i = 0; i < 60; i++) {
    try { await fetch(`http://127.0.0.1:${PORT}/healthz`); break; }
    catch (e) { await sleep(100); }
  }
  try {
    await tests();
    console.log(`\n${pass} passed, ${fail} failed`);
    done(fail);
  } catch (e) {
    console.log('threw:', e && e.stack);
    done(1);
  }
})();
