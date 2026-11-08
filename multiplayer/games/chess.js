/* Chess client — renders the server's board and sends from/to.
   Legality is never decided here; the server ships the legal move list and
   this only highlights it. */
window.MPGAMES = window.MPGAMES || {};
window.MPGAMES.chess = function (canvas, net, init) {
  "use strict";
  const ctx = canvas.getContext("2d");
  const DPR = Math.min(window.devicePixelRatio || 1, 2);
  const GLYPH = { k: "♚", q: "♛", r: "♜", b: "♝", n: "♞", p: "♟" };

  let st = { board: ".".repeat(64), turn: 0, seats: init.seats, names: init.names,
             moves: [], winner: null, check: false, last: null };
  let sel = -1, hover = -1, promo = null, raf = 0, running = true;

  function resize() {
    canvas.width = Math.round(innerWidth * DPR);
    canvas.height = Math.round(innerHeight * DPR);
    canvas.style.width = innerWidth + "px";
    canvas.style.height = innerHeight + "px";
  }
  resize();
  addEventListener("resize", resize);

  const mySeat = () => st.seats.indexOf(net.id);
  const amWhite = () => mySeat() === 0;
  const myTurn = () => st.winner === null && st.seats[st.turn] === net.id;

  function geom() {
    const s = Math.min(innerWidth - 40, innerHeight - 140);
    return { s, cell: s / 8, x0: (innerWidth - s) / 2, y0: (innerHeight - s) / 2 + 16 };
  }
  // black plays from the far side, so flip the board for them
  function toScreen(i) {
    const f = i % 8, r = Math.floor(i / 8);
    return amWhite() ? { f, r } : { f: 7 - f, r: 7 - r };
  }
  function fromScreen(f, r) {
    const ff = amWhite() ? f : 7 - f, rr = amWhite() ? r : 7 - r;
    return rr * 8 + ff;
  }
  function squareAt(px, py) {
    const g = geom();
    const f = Math.floor((px - g.x0) / g.cell), r = Math.floor((py - g.y0) / g.cell);
    if (f < 0 || f > 7 || r < 0 || r > 7) return -1;
    return fromScreen(f, r);
  }

  function legalFrom(sq) { return st.moves.filter((m) => m.from === sq); }

  function click(px, py) {
    if (promo) {                                  // choosing a promotion piece
      const pick = promoHit(px, py);
      if (pick) { net.move({ from: promo.from, to: promo.to, promo: pick }); promo = null; }
      return;
    }
    const sq = squareAt(px, py);
    if (sq < 0) { sel = -1; return; }
    if (sel >= 0) {
      const m = legalFrom(sel).find((x) => x.to === sq);
      if (m) {
        if (m.flag === "promo") { promo = { from: sel, to: sq }; sel = -1; return; }
        net.move({ from: sel, to: sq });
        sel = -1;
        return;
      }
    }
    sel = (myTurn() && legalFrom(sq).length) ? sq : -1;
  }

  const onClick = (e) => click(e.clientX, e.clientY);
  const onMove = (e) => { hover = squareAt(e.clientX, e.clientY); };
  canvas.addEventListener("click", onClick);
  canvas.addEventListener("mousemove", onMove);
  canvas.addEventListener("touchend", (e) => {
    const t = e.changedTouches[0];
    if (t) click(t.clientX, t.clientY);
  });

  function promoBoxes() {
    const g = geom();
    const kinds = ["q", "r", "b", "n"];
    const w = g.cell, y = innerHeight / 2 - w / 2;
    return kinds.map((k, i) => ({ k, x: innerWidth / 2 - w * 2 + i * w, y, w }));
  }
  function promoHit(px, py) {
    for (const b of promoBoxes()) {
      if (px >= b.x && px <= b.x + b.w && py >= b.y && py <= b.y + b.w) return b.k;
    }
    return null;
  }

  function draw() {
    const g = geom();
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.fillStyle = "#070a12";
    ctx.fillRect(0, 0, innerWidth, innerHeight);

    const targets = sel >= 0 ? legalFrom(sel).map((m) => m.to) : [];

    for (let i = 0; i < 64; i++) {
      const { f, r } = toScreen(i);
      const x = g.x0 + f * g.cell, y = g.y0 + r * g.cell;
      const dark = (f + r) % 2 === 1;
      ctx.fillStyle = dark ? "#2a3550" : "#48567a";
      ctx.fillRect(x, y, g.cell, g.cell);

      if (st.last && (i === st.last.from || i === st.last.to)) {
        ctx.fillStyle = "rgba(255,209,102,.22)";
        ctx.fillRect(x, y, g.cell, g.cell);
      }
      if (i === sel) {
        ctx.fillStyle = "rgba(92,225,255,.35)";
        ctx.fillRect(x, y, g.cell, g.cell);
      }
      if (targets.includes(i)) {
        const occupied = st.board[i] !== ".";
        ctx.fillStyle = "rgba(92,225,255,.75)";
        ctx.beginPath();
        if (occupied) {
          ctx.lineWidth = 4; ctx.strokeStyle = "rgba(92,225,255,.85)";
          ctx.arc(x + g.cell / 2, y + g.cell / 2, g.cell * 0.42, 0, 7); ctx.stroke();
        } else {
          ctx.arc(x + g.cell / 2, y + g.cell / 2, g.cell * 0.14, 0, 7); ctx.fill();
        }
      }

      const p = st.board[i];
      if (p !== ".") {
        const white = p === p.toUpperCase();
        ctx.font = `${Math.floor(g.cell * 0.76)}px "Segoe UI Symbol",system-ui,sans-serif`;
        ctx.textAlign = "center"; ctx.textBaseline = "middle";
        // one glyph set, recoloured — avoids outline/solid font inconsistencies
        ctx.fillStyle = white ? "#f4f7ff" : "#10141f";
        ctx.strokeStyle = white ? "#10141f" : "#cfd8ea";
        ctx.lineWidth = 2;
        const gl = GLYPH[p.toLowerCase()];
        ctx.strokeText(gl, x + g.cell / 2, y + g.cell / 2 + 2);
        ctx.fillText(gl, x + g.cell / 2, y + g.cell / 2 + 2);
      }
    }

    // coordinates
    ctx.font = "600 11px system-ui,sans-serif";
    ctx.fillStyle = "#55607a";
    ctx.textAlign = "center"; ctx.textBaseline = "alphabetic";
    for (let f = 0; f < 8; f++) {
      const file = amWhite() ? f : 7 - f;
      ctx.fillText("abcdefgh"[file], g.x0 + f * g.cell + g.cell / 2, g.y0 + g.s + 15);
    }

    // status
    ctx.textAlign = "center";
    ctx.font = "700 18px system-ui,sans-serif";
    let msg, col;
    const seat = mySeat();
    if (st.winner === "draw") { msg = `Draw — ${st.reason || ""}`; col = "#cfd8ea"; }
    else if (st.winner !== null && st.winner !== undefined) {
      const win = st.winner === net.id;
      msg = `${win ? "You win" : (st.names[st.winner] || "Opponent") + " wins"} — ${st.reason || ""}`;
      col = win ? "#7df29b" : "#ff6b8a";
    } else if (seat < 0) { msg = "Spectating"; col = "#8b94b0"; }
    else {
      msg = (myTurn() ? "Your move" : "Waiting…") + (st.check ? "  ·  CHECK" : "");
      col = st.check ? "#ff6b8a" : (myTurn() ? "#5ce1ff" : "#8b94b0");
    }
    ctx.fillStyle = col;
    ctx.fillText(msg, innerWidth / 2, g.y0 - 16);

    if (seat >= 0 && st.winner === null) {
      ctx.font = "600 12px system-ui,sans-serif";
      ctx.fillStyle = "#55607a";
      ctx.fillText(`You are ${amWhite() ? "white" : "black"}`, innerWidth / 2, g.y0 + g.s + 36);
    }

    if (promo) {
      ctx.fillStyle = "rgba(6,9,16,.8)";
      ctx.fillRect(0, 0, innerWidth, innerHeight);
      ctx.fillStyle = "#cfd8ea";
      ctx.font = "700 16px system-ui,sans-serif";
      ctx.fillText("Promote to", innerWidth / 2, innerHeight / 2 - geom().cell);
      for (const b of promoBoxes()) {
        ctx.fillStyle = "#2a3550";
        ctx.fillRect(b.x, b.y, b.w, b.w);
        ctx.strokeStyle = "#5ce1ff"; ctx.lineWidth = 2;
        ctx.strokeRect(b.x, b.y, b.w, b.w);
        ctx.fillStyle = amWhite() ? "#f4f7ff" : "#10141f";
        ctx.font = `${Math.floor(b.w * 0.7)}px "Segoe UI Symbol",system-ui,sans-serif`;
        ctx.textBaseline = "middle";
        ctx.fillText(GLYPH[b.k], b.x + b.w / 2, b.y + b.w / 2);
        ctx.textBaseline = "alphabetic";
      }
    }
  }

  function frame() { if (!running) return; draw(); raf = requestAnimationFrame(frame); }
  raf = requestAnimationFrame(frame);

  return {
    onState(s) { st = s; },
    onOver(m) { if (m.result) { st.winner = m.result.winner; st.reason = m.result.reason; } },
    teardown() {
      running = false;
      cancelAnimationFrame(raf);
      removeEventListener("resize", resize);
      canvas.removeEventListener("click", onClick);
      canvas.removeEventListener("mousemove", onMove);
    },
  };
};
