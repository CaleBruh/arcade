#!/usr/bin/env node
/* Persistence tests. The properties that matter here can only be proven by
   spawning real processes: data must outlive a restart, and SIGTERM (which
   every host sends on deploy) must not lose the last few seconds of play. */
'use strict';
const { execFileSync, spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'arcstore-'));
const STORE = path.join(__dirname, 'store.js');
let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : (fail++, console.log('  FAIL:', m)); };

// run a snippet in a brand-new process pointed at the same data dir
const run = (code) => execFileSync(process.execPath, ['-e', code],
  { env: { ...process.env, DATA_DIR: DATA }, encoding: 'utf8' }).trim();
const S = JSON.stringify(STORE);

function main(done) {
  // 1. survives a restart
  run(`const s=require(${S});
       s.submitScore('sumo',{name:'ann',score:120});
       s.submitScore('sumo',{name:'bob',score:450});
       s.flush();`);
  const top = JSON.parse(run(`const s=require(${S});
       console.log(JSON.stringify(s.topScores('sumo')));`));
  ok(top.length === 2, `scores outlive a restart (got ${top.length})`);
  ok(top[0] && top[0].name === 'bob', 'leaderboard sorted, highest first');

  // 2. times sort the other way
  run(`const s=require(${S});
       s.submitScore('race',{name:'slow',score:90,lowerIsBetter:true});
       s.submitScore('race',{name:'fast',score:30,lowerIsBetter:true});
       s.flush();`);
  const times = JSON.parse(run(`const s=require(${S});
       console.log(JSON.stringify(s.topScores('race')));`));
  ok(times[0] && times[0].name === 'fast', 'lowerIsBetter sorts times ascending');

  // 3. caps hold
  run(`const s=require(${S});
       for(let i=0;i<300;i++) s.submitScore('cap',{name:'p'+i,score:i});
       s.flush();`);
  const capped = Number(run(`const s=require(${S});
       console.log(s.topScores('cap',9999).length);`));
  ok(capped === 50, `leaderboard capped at 50 (got ${capped})`);

  // 4. ghosts round-trip with their frames
  run(`const s=require(${S});
       s.saveGhost('racer',{name:'ann',score:50,seed:7,frames:[[0,0],[1,1]]});
       s.flush();`);
  const g = JSON.parse(run(`const s=require(${S});
       console.log(JSON.stringify(s.ghostsFor('racer')));`));
  ok(g.length === 1 && g[0].frames.length === 2 && g[0].seed === 7,
     'ghosts round-trip with frames and seed');

  // 5. profiles persist
  run(`const s=require(${S}); s.updateProfile('tok1',{wins:3}); s.flush();`);
  const pr = JSON.parse(run(`const s=require(${S});
       console.log(JSON.stringify(s.profile('tok1')));`));
  ok(pr && pr.wins === 3, 'profiles persist');

  // 6. no stray temp file
  ok(!fs.existsSync(path.join(DATA, 'arcade.json.tmp')), 'no temp file left behind');

  // 7. SIGTERM flushes unsaved work — the deploy case
  const child = spawn(process.execPath, ['-e', `
    const s=require(${S});
    s.submitScore('sigterm',{name:'late',score:999});
    process.send && process.send('ready');
    setInterval(()=>{},1000);                 // stay alive, never flush
  `], { env: { ...process.env, DATA_DIR: DATA }, stdio: ['ignore','ignore','ignore','ipc'] });

  const finish = () => {
    const after = JSON.parse(run(`const s=require(${S});
         console.log(JSON.stringify(s.topScores('sigterm')));`));
    ok(after.length === 1 && after[0].name === 'late',
       'SIGTERM flushes unsaved data (deploy safety)');

    // 8. a corrupt store recovers instead of crash-looping
    fs.writeFileSync(path.join(DATA, 'arcade.json'), '{ this is not json');
    let recovered = 'threw';
    try {
      recovered = run(`const s=require(${S});
        s.submitScore('after',{name:'x',score:1});
        console.log(s.topScores('after').length);`);
    } catch (e) { /* leave as 'threw' */ }
    ok(recovered === '1', `corrupt store recovers (got ${recovered})`);
    ok(fs.readdirSync(DATA).some((f) => f.includes('corrupt')),
       'the bad file is kept for inspection, not deleted');

    console.log(`\n${pass} passed, ${fail} failed`);
    try { fs.rmSync(DATA, { recursive: true, force: true }); } catch (e) {}
    done(fail);
  };

  child.on('message', () => { child.kill('SIGTERM'); });
  child.on('exit', () => setTimeout(finish, 150));
  setTimeout(() => { if (!child.killed) child.kill('SIGTERM'); }, 1500);
}

main((f) => process.exit(f ? 1 : 0));
