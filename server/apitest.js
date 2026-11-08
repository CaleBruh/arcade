#!/usr/bin/env node
/* HTTP API tests for the asynchronous features.

   These run against a real server on a real port with its own data dir, because
   the things worth testing here are wire-level: status codes, rejected cheats,
   and the scoring the client is deliberately not trusted to do. */
'use strict';
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

/* A fresh port per run. With a fixed port, two runs back to back collide:
   the previous server has not released the socket yet, so the new test ends
   up talking to a dying instance and fails in confusing ways. */
const PORT = 20000 + Math.floor(Math.random() * 20000);
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'arcapi-'));
let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : (fail++, console.log('  FAIL:', m)); };

function req(method, p, body) {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? null : JSON.stringify(body);
    const r = http.request({ host: '127.0.0.1', port: PORT, path: p, method,
      headers: data ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) } : {} },
      (res) => {
        let b = '';
        res.on('data', (c) => { b += c; });
        res.on('end', () => {
          let json = null;
          try { json = JSON.parse(b); } catch (e) {}
          resolve({ status: res.statusCode, body: json, raw: b });
        });
      });
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}

const today = () => {
  const d = new Date(), m = d.getMonth() + 1, dd = d.getDate();
  return `${d.getFullYear()}-${m < 10 ? '0' : ''}${m}-${dd < 10 ? '0' : ''}${dd}`;
};

async function tests() {
  // ---- daily gauntlet ----
  const d1 = await req('GET', '/api/daily');
  ok(d1.status === 200 && d1.body.games.length === 3, 'daily returns three games');
  ok(d1.body.date === today(), 'daily is dated today');
  ok(d1.body.games.every((g) => g.store && g.par > 0), 'each leg names a store key and a par');

  const d2 = await req('GET', '/api/daily');
  ok(JSON.stringify(d1.body.games) === JSON.stringify(d2.body.games),
     'the gauntlet is stable within a day');

  // the client sends raw scores; the server decides what they are worth
  const legs = d1.body.games.map((g) => g.par);           // exactly par on each
  const sub = await req('POST', '/api/daily', { date: d1.body.date, name: 'ann', legs });
  ok(sub.body.ok && sub.body.total === 300, `par on every leg scores 300 (got ${sub.body.total})`);
  ok(sub.body.legs.every((p) => p === 100), 'par on a leg is worth exactly 100');

  const expired = await req('POST', '/api/daily', { date: '2020-01-01', name: 'x', legs });
  ok(expired.status === 400, 'a run for another day is rejected');

  const short = await req('POST', '/api/daily', { date: d1.body.date, name: 'x', legs: [1] });
  ok(short.status === 400, 'an incomplete run is rejected');

  const huge = await req('POST', '/api/daily',
    { date: d1.body.date, name: 'cheat', legs: legs.map(() => 1e12) });
  ok(huge.body.total === 1200, `an absurd score is capped per leg (got ${huge.body.total})`);

  const neg = await req('POST', '/api/daily',
    { date: d1.body.date, name: 'neg', legs: legs.map(() => -1e9) });
  ok(neg.body.total === 0, 'negative legs floor at zero, they do not subtract');

  const junk = await req('POST', '/api/daily',
    { date: d1.body.date, name: 'junk', legs: ['abc', null, {}] });
  ok(junk.body.ok && junk.body.total === 0, 'non-numeric legs score zero rather than NaN');

  // ---- scores ----
  await req('POST', '/api/score', { game: 'ski', name: 'bob', score: 10 });
  await req('POST', '/api/score', { game: 'ski', name: 'cat', score: 90 });
  const sc = await req('GET', '/api/scores?game=ski');
  ok(sc.body.list[0].name === 'cat', 'leaderboard sorts highest first');

  const noGame = await req('POST', '/api/score', { name: 'x', score: 1 });
  ok(noGame.status === 400, 'a score with no game is rejected');

  const longName = await req('POST', '/api/score',
    { game: 'ski', name: 'x'.repeat(500), score: 5 });
  ok(longName.body.list.every((r) => r.name.length <= 16), 'names are truncated, not stored whole');

  // ---- ghosts ----
  const frames = Array.from({ length: 10 }, (_, i) => [i * 100, 0]);
  await req('POST', '/api/ghost', { game: 'racer', name: 'ann', score: 500, seed: 7, frames });
  const gh = await req('GET', '/api/ghosts?game=racer');
  ok(gh.body.list.length === 1 && gh.body.list[0].frames.length === 10,
     'a ghost round-trips with its frames');
  ok(gh.body.list[0].seed === 7, 'the seed survives the round trip');

  const noFrames = await req('POST', '/api/ghost', { game: 'racer', name: 'x', score: 1, frames: [] });
  ok(noFrames.status === 400, 'an empty ghost is rejected');

  const tooMany = await req('POST', '/api/ghost',
    { game: 'racer', name: 'big', score: 9999, frames: Array.from({ length: 9000 }, () => [1, 1]) });
  ok(tooMany.body.ok, 'an over-long ghost is accepted');
  const capped = await req('GET', '/api/ghosts?game=racer');
  ok(capped.body.list[0].frames.length === 4000, 'and is truncated to the frame cap');

  // ---- tournament ----
  const t = await req('GET', '/api/tournament');
  ok(t.body.standings.length > 0, 'standings are built from the leaderboards');
  ok(t.body.standings.every((s) => !s.games['gauntlet:' + today()]),
     'the daily gauntlet is kept out of the tournament table');
  ok(t.body.standings[0].points >= t.body.standings[t.body.standings.length - 1].points,
     'standings are sorted by points');

  // ---- errors ----
  const unknown = await req('GET', '/api/nope');
  ok(unknown.status === 404, 'an unknown endpoint is a 404, not a crash');

  const badJson = await new Promise((resolve) => {
    const r = http.request({ host: '127.0.0.1', port: PORT, path: '/api/score', method: 'POST',
      headers: { 'content-type': 'application/json' } }, (res) => {
      res.resume();
      res.on('end', () => resolve(res.statusCode));
    });
    r.write('{not json');
    r.end();
  });
  ok(badJson === 400, 'malformed JSON is a 400, not a crash');

  const wrongMethod = await req('DELETE', '/api/score');
  ok(wrongMethod.status === 405, 'an unsupported method is a 405');

  // the server is still alive after all of that
  const h = await req('GET', '/healthz');
  ok(h.status === 200 && h.body.ok, 'the server survived every malformed request');
}

const child = spawn(process.execPath, [path.join(__dirname, 'server.js'), String(PORT)],
  { env: { ...process.env, DATA_DIR: DATA }, stdio: ['ignore', 'pipe', 'pipe'] });

let started = false;
const boot = setTimeout(() => { if (!started) { console.log('server did not start'); process.exit(1); } }, 5000);

function waitForServer(tries = 0) {
  req('GET', '/healthz').then(() => {
    started = true;
    clearTimeout(boot);
    tests()
      .then(() => { console.log(`\n${pass} passed, ${fail} failed`); done(fail); })
      .catch((e) => { console.log('threw:', e.message); done(1); });
  }).catch(() => {
    if (tries > 50) { console.log('server never answered'); process.exit(1); }
    setTimeout(() => waitForServer(tries + 1), 100);
  });
}

function done(code) {
  child.kill('SIGTERM');
  try { fs.rmSync(DATA, { recursive: true, force: true }); } catch (e) {}
  setTimeout(() => process.exit(code ? 1 : 0), 200);
}

waitForServer();
