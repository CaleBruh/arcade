/* Ultimate Tic-Tac-Toe client. The playable board is highlighted; finished
   boards are stamped with their winner. */
window.MPGAMES = window.MPGAMES || {};
window.MPGAMES.uttt = function (canvas, net, init) {
  "use strict";
  const ctx = canvas.getContext("2d");
  const DPR = Math.min(window.devicePixelRatio || 1, 2);
  const COL = ["#5ce1ff", "#ff5c8a"];

  let st = { boards: Array.from({ length: 9 }, () => Array(9).fill(0)),
             won: Array(9).fill(0), wonLine: Array(9).fill(null),
             turn: 0, active: -1, seats: init.seats, names: init.names,
             winner: null, bigLine: null, last: null };
  let raf = 0, running = true, t = 0, hover = null;

  function resize() {
    canvas.width = Math.round(innerWidth * DPR);
    canvas.height = Math.round(innerHeight * DPR);
    canvas.style.width = innerWidth + "px";
    canvas.style.height = innerHeight + "px";
  }
  resize();
  addEventListener("resize", resize);

  const mySeat = () => st.seats.indexOf(net.id);
  const myTurn = () => st.winner === null && st.seats[st.turn] === net.id;

  function geom() {
    const s = Math.min(innerWidth - 40, innerHeight - 150);
    return { s, big: s / 3, cell: s / 9, x0: (innerWidth - s) / 2, y0: (innerHeight - s) / 2 + 16 };
  }
  function hit(px, py) {
    const g = geom();
    const fx = (px - g.x0) / g.cell, fy = (py - g.y0) / g.cell;
    if (fx < 0 || fx >= 9 || fy < 0 || fy >= 9) return null;
    const bx = Math.floor(fx / 3), by = Math.floor(fy / 3);
    const cx = Math.floor(fx) % 3, cy = Math.floor(fy) % 3;
    return { b: by * 3 + bx, c: cy * 3 + cx };
  }
  function playable(h) {
    if (!h || !myTurn()) return false;
    if (st.active !== -1 && h.b !== st.active) return false;
    return st.won[h.b] === 0 && st.boards[h.b][h.c] === 0;
  }

  const onMove = (e) => { hover = hit(e.clientX, e.clientY); };
  const onClick = (e) => { const h = hit(e.clientX, e.clientY); if (playable(h)) net.move(h); };
  canvas.addEventListener("mousemove", onMove);
  canvas.addEventListener("click", onClick);
  canvas.addEventListener("touchend", (e) => {
    const tc = e.changedTouches[0];
    if (!tc) return;
    const h = hit(tc.clientX, tc.clientY);
    if (playable(h)) net.move(h);
  });

  function mark(kind, x, y, size, alpha) {
    ctx.globalAlpha = alpha === undefined ? 1 : alpha;
    ctx.lineWidth = Math.max(2, size * 0.12);
    ctx.strokeStyle = COL[kind - 1];
    const r = size * 0.3;
    if (kind === 1) {
      ctx.beginPath();
      ctx.moveTo(x - r, y - r); ctx.lineTo(x + r, y + r);
      ctx.moveTo(x + r, y - r); ctx.lineTo(x - r, y + r);
      ctx.stroke();
    } else {
      ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  function draw() {
    t += 0.03;
    const g = geom();
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.fillStyle = "#070a12";
    ctx.fillRect(0, 0, innerWidth, innerHeight);

    for (let b = 0; b < 9; b++) {
      const bx = g.x0 + (b % 3) * g.big, by = g.y0 + Math.floor(b / 3) * g.big;
      const live = st.winner === null && st.won[b] === 0 && (st.active === -1 || st.active === b);

      ctx.fillStyle = live ? "rgba(92,225,255,.07)" : "#0d1120";
      ctx.fillRect(bx, by, g.big, g.big);
      if (live && myTurn()) {
        ctx.strokeStyle = `rgba(92,225,255,${0.5 + Math.sin(t * 3) * 0.25})`;
        ctx.lineWidth = 2.5;
        ctx.strokeRect(bx + 1.5, by + 1.5, g.big - 3, g.big - 3);
      }

      for (let c = 0; c < 9; c++) {
        const cx = bx + (c % 3) * g.cell, cy = by + Math.floor(c / 3) * g.cell;
        ctx.strokeStyle = "rgba(140,160,210,.14)";
        ctx.lineWidth = 1;
        ctx.strokeRect(cx, cy, g.cell, g.cell);
        const v = st.boards[b][c];
        if (v) mark(v, cx + g.cell / 2, cy + g.cell / 2, g.cell, st.won[b] ? 0.35 : 1);
        else if (hover && hover.b === b && hover.c === c && playable(hover)) {
          mark(mySeat() + 1, cx + g.cell / 2, cy + g.cell / 2, g.cell, 0.25);
        }
      }

      if (st.won[b] === 1 || st.won[b] === 2) {
        mark(st.won[b], bx + g.big / 2, by + g.big / 2, g.big * 0.9, 0.9);
      } else if (st.won[b] === 3) {
        ctx.fillStyle = "rgba(139,148,176,.5)";
        ctx.font = `700 ${Math.floor(g.big * 0.3)}px system-ui,sans-serif`;
        ctx.textAlign = "center"; ctx.textBaseline = "middle";
        ctx.fillText("—", bx + g.big / 2, by + g.big / 2);
        ctx.textBaseline = "alphabetic";
      }

      ctx.strokeStyle = "rgba(140,160,210,.45)";
      ctx.lineWidth = 2;
      ctx.strokeRect(bx, by, g.big, g.big);
    }

    ctx.textAlign = "center";
    ctx.font = "700 18px system-ui,sans-serif";
    const seat = mySeat();
    let msg, col;
    if (st.winner === "draw") { msg = "Draw"; col = "#cfd8ea"; }
    else if (st.winner !== null && st.winner !== undefined) {
      const w = st.winner === net.id;
      msg = w ? "You win!" : `${st.names[st.winner] || "Opponent"} wins`;
      col = w ? "#7df29b" : "#ff6b8a";
    } else if (seat < 0) { msg = "Spectating"; col = "#8b94b0"; }
    else {
      msg = myTurn()
        ? (st.active === -1 ? "Your turn — play anywhere" : "Your turn — highlighted board")
        : "Waiting…";
      col = myTurn() ? COL[seat] : "#8b94b0";
    }
    ctx.fillStyle = col;
    ctx.fillText(msg, innerWidth / 2, g.y0 - 16);

    if (seat >= 0 && st.winner === null) {
      ctx.font = "600 12px system-ui,sans-serif";
      ctx.fillStyle = "#55607a";
      ctx.fillText(`You are ${seat === 0 ? "✕" : "○"}`, innerWidth / 2, g.y0 + g.s + 30);
    }
  }

  function frame() { if (!running) return; draw(); raf = requestAnimationFrame(frame); }
  raf = requestAnimationFrame(frame);

  return {
    onState(s) { st = s; },
    onOver(m) { if (m.result) st.winner = m.result.winner; },
    teardown() {
      running = false;
      cancelAnimationFrame(raf);
      removeEventListener("resize", resize);
      canvas.removeEventListener("mousemove", onMove);
      canvas.removeEventListener("click", onClick);
    },
  };
};
