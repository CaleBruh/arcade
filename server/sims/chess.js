/* Chess — full legal move generation.

   Board is 64 chars, index 0 = a8 .. 63 = h1 (rank-major from black's back
   rank), uppercase = white. The server is the only authority on legality, so
   every rule lives here: sliding pieces, castling through/into check, en
   passant, promotion, and the difference between checkmate and stalemate. */
'use strict';

const START = 'rnbqkbnrpppppppp' + '.'.repeat(32) + 'PPPPPPPPRNBQKBNR';
const W = (c) => c >= 'A' && c <= 'Z';
const B = (c) => c >= 'a' && c <= 'z';
const isW = (c) => c !== '.' && W(c);
const same = (a, b) => a !== '.' && b !== '.' && (isW(a) === isW(b));
const file = (i) => i % 8;
const rank = (i) => Math.floor(i / 8);
const onBoard = (f, r) => f >= 0 && f < 8 && r >= 0 && r < 8;
const idx = (f, r) => r * 8 + f;

const KNIGHT = [[1, 2], [2, 1], [2, -1], [1, -2], [-1, -2], [-2, -1], [-2, 1], [-1, 2]];
const KING = [[0, 1], [1, 1], [1, 0], [1, -1], [0, -1], [-1, -1], [-1, 0], [-1, 1]];
const ROOK = [[0, 1], [1, 0], [0, -1], [-1, 0]];
const BISHOP = [[1, 1], [1, -1], [-1, -1], [-1, 1]];

function chess(roster) {
  const seats = roster.slice(0, 2).map((p) => p.id);   // [white, black]
  const names = Object.fromEntries(roster.map((p) => [p.id, p.name]));
  let board = START.split('');
  let turn = 0;                 // 0 white, 1 black
  let castle = { K: true, Q: true, k: true, q: true };
  let ep = -1;                  // en-passant target square
  let halfmove = 0, fullmove = 1;
  let winner = null, reason = null;
  const history = [];

  /* ---- attack / legality ---- */
  function pseudo(bd, from, cast, epSq) {
    const p = bd[from];
    if (p === '.') return [];
    const white = isW(p);
    const f = file(from), r = rank(from);
    const out = [];
    const push = (tf, tr, flag) => {
      if (!onBoard(tf, tr)) return false;
      const t = idx(tf, tr);
      if (same(p, bd[t])) return false;
      out.push({ from, to: t, flag });
      return bd[t] === '.';
    };
    const slide = (dirs) => {
      for (const [df, dr] of dirs) {
        let tf = f + df, tr = r + dr;
        while (push(tf, tr)) { tf += df; tr += dr; }
      }
    };
    switch (p.toLowerCase()) {
      case 'p': {
        const dir = white ? -1 : 1;             // white moves toward rank 0
        const start = white ? 6 : 1;
        const promo = white ? 0 : 7;
        if (onBoard(f, r + dir) && bd[idx(f, r + dir)] === '.') {
          out.push({ from, to: idx(f, r + dir), flag: r + dir === promo ? 'promo' : null });
          if (r === start && bd[idx(f, r + 2 * dir)] === '.') {
            out.push({ from, to: idx(f, r + 2 * dir), flag: 'double' });
          }
        }
        for (const df of [-1, 1]) {
          const tf = f + df, tr = r + dir;
          if (!onBoard(tf, tr)) continue;
          const t = idx(tf, tr);
          if (bd[t] !== '.' && !same(p, bd[t])) {
            out.push({ from, to: t, flag: tr === promo ? 'promo' : null });
          } else if (t === epSq) {
            out.push({ from, to: t, flag: 'ep' });
          }
        }
        break;
      }
      case 'n': for (const [df, dr] of KNIGHT) push(f + df, r + dr); break;
      case 'b': slide(BISHOP); break;
      case 'r': slide(ROOK); break;
      case 'q': slide(ROOK.concat(BISHOP)); break;
      case 'k': {
        for (const [df, dr] of KING) push(f + df, r + dr);
        const home = white ? 7 : 0;
        if (r === home && f === 4) {
          const kSide = white ? cast.K : cast.k;
          const qSide = white ? cast.Q : cast.q;
          if (kSide && bd[idx(5, home)] === '.' && bd[idx(6, home)] === '.') {
            out.push({ from, to: idx(6, home), flag: 'castleK' });
          }
          if (qSide && bd[idx(3, home)] === '.' && bd[idx(2, home)] === '.' && bd[idx(1, home)] === '.') {
            out.push({ from, to: idx(2, home), flag: 'castleQ' });
          }
        }
        break;
      }
    }
    return out;
  }

  function attacked(bd, sq, byWhite) {
    for (let i = 0; i < 64; i++) {
      const p = bd[i];
      if (p === '.' || isW(p) !== byWhite) continue;
      if (p.toLowerCase() === 'p') {
        // pawns attack diagonally only — pseudo() would include quiet pushes
        const dir = byWhite ? -1 : 1;
        const f = file(i), r = rank(i);
        for (const df of [-1, 1]) {
          if (onBoard(f + df, r + dir) && idx(f + df, r + dir) === sq) return true;
        }
        continue;
      }
      for (const m of pseudo(bd, i, { K: false, Q: false, k: false, q: false }, -1)) {
        if (m.to === sq) return true;
      }
    }
    return false;
  }

  function kingSq(bd, white) {
    const k = white ? 'K' : 'k';
    return bd.indexOf(k);
  }

  function apply(bd, m, cast, epSq) {
    const nb = bd.slice();
    const p = nb[m.from];
    const white = isW(p);
    nb[m.to] = p;
    nb[m.from] = '.';
    if (m.flag === 'ep') nb[idx(file(m.to), rank(m.from))] = '.';
    if (m.flag === 'promo') {
      // never trust the client's letter: clamp to QRBN and force our own colour,
      // otherwise a crafted request promotes to the wrong side — or to a king
      const want = String(m.promo || 'q').toLowerCase();
      const kind = 'qrbn'.includes(want) ? want : 'q';
      nb[m.to] = white ? kind.toUpperCase() : kind;
    }
    if (m.flag === 'castleK') { const h = white ? 7 : 0; nb[idx(5, h)] = nb[idx(7, h)]; nb[idx(7, h)] = '.'; }
    if (m.flag === 'castleQ') { const h = white ? 7 : 0; nb[idx(3, h)] = nb[idx(0, h)]; nb[idx(0, h)] = '.'; }
    return nb;
  }

  function legalMoves(bd, white, cast, epSq) {
    const out = [];
    for (let i = 0; i < 64; i++) {
      if (bd[i] === '.' || isW(bd[i]) !== white) continue;
      for (const m of pseudo(bd, i, cast, epSq)) {
        // castling may not start in, pass through, or land in check
        if (m.flag === 'castleK' || m.flag === 'castleQ') {
          const h = white ? 7 : 0;
          const through = m.flag === 'castleK' ? [4, 5, 6] : [4, 3, 2];
          if (through.some((f) => attacked(bd, idx(f, h), !white))) continue;
        }
        const nb = apply(bd, m, cast, epSq);
        if (!attacked(nb, kingSq(nb, white), !white)) out.push(m);
      }
    }
    return out;
  }

  function stateAfter() {
    const white = turn === 0;
    const moves = legalMoves(board, white, castle, ep);
    const inCheck = attacked(board, kingSq(board, white), !white);
    if (!moves.length) {
      winner = inCheck ? seats[1 - turn] : 'draw';
      reason = inCheck ? 'checkmate' : 'stalemate';
    } else if (halfmove >= 100) {
      winner = 'draw'; reason = 'fifty-move rule';
    }
    return { moves, inCheck };
  }

  let cache = stateAfter();

  return {
    init: () => ({ seats, names }),
    view: () => ({
      board: board.join(''), turn, seats, names, winner, reason,
      check: cache.inCheck, ep, castle,
      moves: cache.moves.map((m) => ({ from: m.from, to: m.to, flag: m.flag })),
      last: history[history.length - 1] || null,
      halfmove, fullmove,
    }),
    addPlayer(id, name) { names[id] = name; },
    removePlayer(id) {
      if (seats.includes(id) && winner === null) {
        winner = seats.find((s) => s !== id) ?? 'abandoned';
        reason = 'opponent left';
      }
    },
    move(id, d) {
      if (winner !== null) return { error: 'game over' };
      if (id !== seats[turn]) return { error: 'not your turn' };
      const from = Number(d && d.from), to = Number(d && d.to);
      const m = cache.moves.find((x) => x.from === from && x.to === to);
      if (!m) return { error: 'illegal move' };

      const piece = board[from];
      const captured = board[to] !== '.' || m.flag === 'ep';
      if (d.promo && m.flag === 'promo') m.promo = String(d.promo).toLowerCase();

      board = apply(board, m, castle, ep);

      // castling rights die when the king or either rook moves or is taken
      if (piece === 'K') { castle.K = castle.Q = false; }
      if (piece === 'k') { castle.k = castle.q = false; }
      if (from === 63 || to === 63) castle.K = false;
      if (from === 56 || to === 56) castle.Q = false;
      if (from === 7 || to === 7) castle.k = false;
      if (from === 0 || to === 0) castle.q = false;

      ep = m.flag === 'double' ? idx(file(from), (rank(from) + rank(to)) / 2) : -1;
      halfmove = (piece.toLowerCase() === 'p' || captured) ? 0 : halfmove + 1;
      if (turn === 1) fullmove++;
      history.push({ from, to, flag: m.flag, piece });
      turn = 1 - turn;
      cache = stateAfter();
      return { ok: true };
    },
    finished: () => winner !== null,
    result: () => ({ winner, reason, names }),
  };
}

module.exports = {
  name: 'Chess', min: 2, max: 2, sync: 'relay', joinInProgress: true,
  blurb: 'Full rules: castling, en passant, promotion, mate and stalemate.',
  make: chess,
};
