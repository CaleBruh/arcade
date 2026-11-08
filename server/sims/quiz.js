'use strict';

/* ==================== Quiz Buzzer (tick, up to 50P) ====================

   A design note, because the obvious reading of "buzzer" is the wrong game
   here. Classic buzz-in — first thumb locks everyone else out and answers
   aloud — means that with 50 players, 49 people watch. So everybody answers
   every question, and the buzzer part is in the scoring: you get points for
   being right and a sliding bonus for being quick. The pressure comes from
   watching the answered-count climb while you dither.

   Two things this sim must never do:
     - leak the correct answer before the reveal. Tick sims broadcast one
       identical snapshot to every player, so the answer is simply absent
       from the payload until the phase changes.
     - let an answer be changed. First answer sticks, or the speed bonus
       means nothing.                                                      */

const { QUESTIONS } = require('../quizbank');

const Q = {
  ROUNDS: 10,
  ASK: 20,            // seconds to answer
  REVEAL: 6,          // seconds showing the answer
  INTRO: 3,           // breath before the first question
  BASE: 500,          // points for a correct answer
  SPEED: 500,         // additional, scaled by how much time was left
  STREAK: 100,        // per consecutive correct beyond the first
  STREAK_CAP: 400,
};

function shuffled(list) {
  const a = list.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/* Shuffle the four options and move the correct index with them.

   This is not cosmetic. Writing a bank by hand produces a lopsided answer
   spread without anyone noticing — the first draft of quizbank.js had the
   correct answer at position B in 32 of 58 questions, so a player who
   always pressed B would score 55% knowing nothing. Randomising per game
   removes the bias whatever the bank looks like, which also means someone
   adding their own questions cannot reintroduce it. */
function shuffleOptions(q) {
  const [text, options, answer, category] = q;
  const order = shuffled(options.map((_, i) => i));
  return [text, order.map((i) => options[i]), order.indexOf(answer), category];
}

function quiz(roster) {
  const P = new Map();
  const picked = shuffled(QUESTIONS)
    .slice(0, Math.min(Q.ROUNDS, QUESTIONS.length))
    .map(shuffleOptions);

  let phase = 'intro';
  let round = -1;
  let clock = Q.INTRO;
  let over = false;
  let dirty = true;             // emit a snapshot on the next tick

  function spawn(id, name) {
    P.set(id, {
      id, name, score: 0, streak: 0, best: 0,
      answer: null, answeredAt: null, correct: 0,
      hue: (P.size * 59) % 360,
    });
  }
  roster.forEach((p) => spawn(p.id, p.name));

  function current() { return round >= 0 && round < picked.length ? picked[round] : null; }

  function nextQuestion() {
    round++;
    if (round >= picked.length) { phase = 'final'; over = true; dirty = true; return; }
    phase = 'question';
    clock = Q.ASK;
    for (const p of P.values()) { p.answer = null; p.answeredAt = null; }
    dirty = true;
  }

  function scoreRound() {
    const q = current();
    if (!q) return;
    const correctIndex = q[2];
    for (const p of P.values()) {
      if (p.answer === correctIndex) {
        // the sooner it came in, the more of the speed pot you keep
        const frac = p.answeredAt === null ? 0 : Math.max(0, Math.min(1, p.answeredAt / Q.ASK));
        p.streak++;
        const bonus = Math.min(Q.STREAK_CAP, (p.streak - 1) * Q.STREAK);
        p.score += Q.BASE + Math.round(Q.SPEED * frac) + bonus;
        p.correct++;
        p.best = Math.max(p.best, p.streak);
      } else {
        p.streak = 0;
      }
    }
  }

  return {
    init: () => ({
      rounds: picked.length, ask: Q.ASK,
      players: [...P.values()].map((p) => ({ id: p.id, name: p.name, hue: p.hue })),
    }),
    addPlayer(id, name) { if (!P.has(id)) { spawn(id, name); dirty = true; } },
    removePlayer(id) { P.delete(id); dirty = true; },

    input(id, d) {
      if (phase !== 'question' || !d) return;
      const p = P.get(id);
      if (!p || p.answer !== null) return;          // first answer sticks
      const a = Number(d.answer);
      if (!Number.isInteger(a) || a < 0 || a > 3) return;
      p.answer = a;
      p.answeredAt = clock;                          // seconds left when it landed
      dirty = true;
    },

    step(dt) {
      if (over && phase === 'final') {
        if (!dirty) return null;
        dirty = false;
        return this.view();
      }

      const before = Math.ceil(clock);
      clock -= dt;
      if (Math.ceil(clock) !== before) dirty = true;  // the visible second changed

      if (clock <= 0) {
        if (phase === 'intro') nextQuestion();
        else if (phase === 'question') { scoreRound(); phase = 'reveal'; clock = Q.REVEAL; dirty = true; }
        else if (phase === 'reveal') nextQuestion();
      }

      // everyone has answered — no reason to sit on an empty clock
      if (phase === 'question' && P.size > 0 &&
          [...P.values()].every((p) => p.answer !== null)) {
        scoreRound();
        phase = 'reveal';
        clock = Q.REVEAL;
        dirty = true;
      }

      if (!dirty) return null;      // a quiz has no reason to send 20 snapshots a second
      dirty = false;
      return this.view();
    },

    /* Built by hand per phase rather than filtered from one object, so it is
       obvious at a glance that the answer cannot escape early. */
    view() {
      const q = current();
      const base = {
        phase, round: round + 1, rounds: picked.length,
        clock: Math.max(0, Math.ceil(clock)),
        answered: [...P.values()].filter((p) => p.answer !== null).length,
        total: P.size,
        board: [...P.values()]
          .sort((a, b) => b.score - a.score)
          .slice(0, 10)
          .map((p) => ({ id: p.id, name: p.name, score: p.score, streak: p.streak })),
      };

      if (phase === 'intro') return base;

      if (phase === 'question') {
        // text and options only — no correct index, no other players' picks
        return Object.assign(base, {
          q: q[0], options: q[1], category: q[3],
          picks: [...P.values()].map((p) => [p.id, p.answer !== null ? 1 : 0]),
        });
      }

      if (phase === 'reveal') {
        const counts = [0, 0, 0, 0];
        for (const p of P.values()) if (p.answer !== null) counts[p.answer]++;
        return Object.assign(base, {
          q: q[0], options: q[1], category: q[3],
          correct: q[2], counts,
          picks: [...P.values()].map((p) => [p.id, p.answer, p.answer === q[2] ? 1 : 0]),
        });
      }

      return Object.assign(base, {
        standings: [...P.values()]
          .sort((a, b) => b.score - a.score)
          .map((p, i) => ({ place: i + 1, id: p.id, name: p.name,
                            score: p.score, correct: p.correct, best: p.best })),
      });
    },

    finished: () => over,
    result: () => {
      const order = [...P.values()].sort((a, b) => b.score - a.score || b.correct - a.correct);
      return {
        winner: order.length ? order[0].id : null,
        standings: order.map((p, i) => ({
          place: i + 1, id: p.id, name: p.name,
          score: p.score, correct: p.correct, rounds: picked.length, best: p.best,
        })),
      };
    },
  };
}

module.exports = {
  name: 'Quiz Buzzer', min: 1, max: 50, sync: 'tick', joinInProgress: true,
  blurb: 'Ten questions, everyone answers, fastest correct answer scores most.',
  make: quiz,
};
