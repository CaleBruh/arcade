/* Connect Four — client view. The server validates every drop and decides
   whose turn it is; this only draws state and sends a column. */
window.MPGAMES = window.MPGAMES || {};
window.MPGAMES.connect4 = function (canvas, net, init) {
  "use strict";
  const ctx = canvas.getContext("2d");
  const DPR = Math.min(window.devicePixelRatio || 1, 2);
  const W = init.w, H = init.h;
  const COLS = ["#5ce1ff", "#ff5c8a"];

  let st = { grid: Array.from({ length: H }, () => Array(W).fill(0)),
             turn: 0, seats: init.seats, names: init.names, winner: null, line: null };
  let hover = -1, raf = 0, running = true, anim = 0;

  function resize() {
    canvas.width = Math.round(innerWidth * DPR);
    canvas.height = Math.round(innerHeight * DPR);
    canvas.style.width = innerWidth + "px";
    canvas.style.height = innerHeight + "px";
  }
  resize();
  addEventListener("resize", resize);

  function geom() {
    const pad = 26;
    const cell = Math.min((innerWidth - pad * 2) / W, (innerHeight - 150) / H);
    const bw = cell * W, bh = cell * H;
    return { cell, x0: (innerWidth - bw) / 2, y0: (innerHeight - bh) / 2 + 20, bw, bh };
  }

  function colAt(px) {
    const g = geom();
    const c = Math.floor((px - g.x0) / g.cell);
    return c >= 0 && c < W ? c : -1;
  }

  const mm = (e) => { hover = colAt(e.clientX); };
  const cl = (e) => {
    const c = colAt(e.clientX);
    if (c >= 0 && myTurn()) net.move({ col: c });
  };
  canvas.addEventListener("mousemove", mm);
  canvas.addEventListener("click", cl);
  canvas.addEventListener("touchend", (e) => {
    const t = e.changedTouches[0];
    if (!t) return;
    const c = colAt(t.clientX);
    if (c >= 0 && myTurn()) net.move({ col: c });
  });

  function mySeat() { return st.seats.indexOf(net.id); }
  function myTurn() { return st.winner === null && st.seats[st.turn] === net.id; }

  function draw() {
    anim += 0.03;
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.fillStyle = "#070a12";
    ctx.fillRect(0, 0, innerWidth, innerHeight);
    const g = geom();

    // board
    ctx.fillStyle = "#16203a";
    const r = 14;
    ctx.beginPath();
    ctx.roundRect(g.x0 - 10, g.y0 - 10, g.bw + 20, g.bh + 20, r);
    ctx.fill();

    const seat = mySeat();
    // hover ghost
    if (hover >= 0 && myTurn()) {
      ctx.globalAlpha = 0.18;
      ctx.fillStyle = COLS[st.turn];
      ctx.fillRect(g.x0 + hover * g.cell, g.y0 - 10, g.cell, g.bh + 20);
      ctx.globalAlpha = 1;
    }

    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const cx = g.x0 + x * g.cell + g.cell / 2;
        const cy = g.y0 + y * g.cell + g.cell / 2;
        const v = st.grid[y][x];
        ctx.beginPath();
        ctx.arc(cx, cy, g.cell * 0.4, 0, Math.PI * 2);
        if (!v) { ctx.fillStyle = "#0b1020"; ctx.fill(); continue; }
        const won = st.line && st.line.some(([lx, ly]) => lx === x && ly === y);
        ctx.fillStyle = COLS[v - 1];
        if (won) { ctx.shadowColor = COLS[v - 1]; ctx.shadowBlur = 16 + Math.sin(anim * 4) * 8; }
        ctx.fill();
        ctx.shadowBlur = 0;
      }
    }

    // status line
    ctx.textAlign = "center";
    ctx.font = "700 19px system-ui,sans-serif";
    let msg, col;
    if (st.winner === "draw") { msg = "Draw"; col = "#cfd8ea"; }
    else if (st.winner !== null) {
      const win = st.winner === net.id;
      msg = win ? "You win!" : `${st.names[st.winner] || "Opponent"} wins`;
      col = win ? "#7df29b" : "#ff6b8a";
    } else if (seat < 0) {
      msg = `Spectating — ${st.names[st.seats[st.turn]] || "?"} to play`;
      col = "#8b94b0";
    } else {
      msg = myTurn() ? "Your turn" : `${st.names[st.seats[st.turn]] || "Opponent"}'s turn`;
      col = myTurn() ? COLS[seat] : "#8b94b0";
    }
    ctx.fillStyle = col;
    ctx.fillText(msg, innerWidth / 2, g.y0 - 28);

    if (seat >= 0 && st.winner === null) {
      ctx.font = "600 13px system-ui,sans-serif";
      ctx.fillStyle = "#55607a";
      ctx.fillText("You are " + (seat === 0 ? "blue" : "pink"), innerWidth / 2, g.y0 + g.bh + 40);
    }
  }

  function frame() {
    if (!running) return;
    draw();
    raf = requestAnimationFrame(frame);
  }
  raf = requestAnimationFrame(frame);

  return {
    onState(s) { st = s; },
    onOver(m) { if (m.result) { st.winner = m.result.winner; st.line = m.result.line; } },
    teardown() {
      running = false;
      cancelAnimationFrame(raf);
      removeEventListener("resize", resize);
      canvas.removeEventListener("mousemove", mm);
      canvas.removeEventListener("click", cl);
    },
  };
};
