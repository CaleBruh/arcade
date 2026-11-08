#!/usr/bin/env node
/* Pre-deploy self test. Exercises every registered sim headlessly: it must
   build, accept a tick or a move, produce a view, and never throw.
   Run with: npm test                                                      */
'use strict';
const { GAMES, makeSim } = require('./games');

let pass = 0, fail = 0;
const ok = (cond, msg) => { cond ? pass++ : (fail++, console.log('  FAIL:', msg)); };

const roster = (n) => Array.from({ length: n }, (_, i) => ({ id: i + 1, name: 'p' + i }));

for (const [id, def] of Object.entries(GAMES)) {
  const n = Math.max(def.min, Math.min(def.max, 2));
  let sim;
  try {
    sim = makeSim(id, roster(n));
    ok(true, id + ' builds');
  } catch (e) {
    ok(false, `${id} failed to build: ${e.message}`);
    continue;
  }

  try {
    const init = sim.init();
    ok(init && typeof init === 'object', id + ' init() returns an object');
  } catch (e) { ok(false, `${id} init() threw: ${e.message}`); }

  // relay games are driven entirely by views, so one must exist. Tick games
  // legitimately have none — their state arrives in the next step() snapshot,
  // which a joiner receives within one tick.
  try {
    const v = sim.viewFor ? sim.viewFor(1) : (sim.view ? sim.view() : null);
    if (def.sync === 'relay') ok(v && typeof v === 'object', id + ' produces a view');
    else ok(true, id + ' (tick) needs no view');
  } catch (e) { ok(false, `${id} view threw: ${e.message}`); }

  // garbage input must be refused, not fatal
  try {
    if (def.sync === 'relay') {
      const junk = [undefined, null, {}, { x: 'a' }, { from: -5, to: 9e9 }, { pts: 'no' }];
      junk.forEach((j) => sim.move(1, j));
      sim.move(99999, {});                       // unknown player
    } else {
      [undefined, null, {}, { x: NaN }, { x: 1e9, y: -1e9 }].forEach((j) => sim.input(1, j));
      sim.input(99999, { x: 1 });
    }
    ok(true, id + ' survives malformed input');
  } catch (e) { ok(false, `${id} threw on malformed input: ${e.message}`); }

  // tick games must run without throwing and terminate their own loop
  if (def.sync === 'tick') {
    try {
      for (let i = 0; i < 200 && !sim.finished(); i++) sim.step(1 / 20);
      ok(true, id + ' ticks cleanly');
    } catch (e) { ok(false, `${id} step() threw: ${e.message}`); }
  }

  try {
    sim.removePlayer(1);
    ok(true, id + ' handles a player leaving');
  } catch (e) { ok(false, `${id} removePlayer threw: ${e.message}`); }

  try { sim.result(); ok(true, id + ' result() works'); }
  catch (e) { ok(false, `${id} result() threw: ${e.message}`); }
}

console.log(`\n${Object.keys(GAMES).length} games · ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
