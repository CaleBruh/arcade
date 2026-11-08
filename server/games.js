/* Game registry.

   Each entry in server/sims/<id>.js exports:
     { name, min, max, sync, joinInProgress, blurb, make(roster) }

   make() returns a sim. A 'relay' sim implements
     init() view() move(id,d) finished() result() addPlayer() removePlayer()
   A 'tick' sim implements
     init() input(id,d) step(dt) finished() result() addPlayer() removePlayer()

   The client half lives in multiplayer/games/<id>.js under the same id. */
'use strict';
const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, 'sims');
const GAMES = {};

for (const file of fs.readdirSync(DIR).sort()) {
  if (!file.endsWith('.js')) continue;
  const id = file.replace(/\.js$/, '');
  const def = require(path.join(DIR, file));
  if (!def || typeof def.make !== 'function') {
    throw new Error(`sim ${file} does not export make()`);
  }
  GAMES[id] = def;
}

function makeSim(game, roster) { return GAMES[game].make(roster); }

module.exports = { GAMES, makeSim };
