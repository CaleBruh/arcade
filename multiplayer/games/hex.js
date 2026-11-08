/* Hex client — pointy-top hexagons on a rhombus. Red owns top/bottom,
   Blue owns left/right. */
window.MPGAMES = window.MPGAMES || {};
window.MPGAMES.hex = function (canvas, net, init) {
  "use strict";
  const ctx = canvas.getContext("2d");
  const DPR = Math.min(window.devicePixelRatio || 1, 2);
  const N = init.n;
  const COL = ["#ff5c6e", "#5ce1ff"];

  let st = { cells: Array.from({ length: N }, () => Array(N).fill(0)),
             turn: 0, seats: init.seats, names: init.names, winner: null, path: null, last: null };
  let hover = null, raf = 0, running = true, t = 0;

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
    // Rhombus: each row shifts right by half a hex, so the board is much wider
    // than tall. Solve the radius from both axes and take the tighter one.
    //   width  = sqrt(3)*r * (1.5N - 0.5)
    //   height = r * (1.5N + 0.5)
    const availW = innerWidth - 40, availH = innerHeight - 170;
    const rW = availW / (Math.sqrt(3) * (1.5 * N - 0.5));
    const rH = availH / (1.5 * N + 0.5);
    const r = Math.max(6, Math.min(rW, rH));
    const w = Math.sqrt(3) * r, h = 1.5 * r;
    const bw = w * (1.5 * N - 0.5), bh = r * (1.5 * N + 0.5);
    return { r, w, h, x0: (innerWidth - bw) / 2 + w / 2, y0: (innerHeight - bh) / 2 + r + 20 };
  }
  function center(x, y) {
    const g = geom();
    return { cx: g.x0 + x * g.w + y * g.w / 2, cy: g.y0 + y * g.h };
  }
  function hexPath(cx, cy, r) {
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
      const a = Math.PI / 180 * (60 * i - 90);
      const px = cx + r * Math.cos(a), py = cy + r * Math.sin(a);
      i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
    }
    ctx.closePath();
  }
  function cellAt(px, py) {
    const g = geom();
    let best = null, bestD = g.r;
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const { cx, cy } = center(x, y);
      const d = Math.hypot(px - cx, py - cy);
      if (d < bestD) { bestD = d; best = { x, y }; }
    }
    return best;
  }

  const onMove = (e) => { hover = cellAt(e.clientX, e.clientY); };
  const onClick = (e) => {
    const c = cellAt(e.clientX, e.clientY);
    if (c && myTurn() && st.cells[c.y][c.x] === 0) net.move({ x: c.x, y: c.y });
  };
  canvas.addEventListener("mousemove", onMove);
  canvas.addEventListener("click", onClick);
  canvas.addEventListener("touchend", (e) => {
    const tc = e.changedTouches[0];
    if (!tc) return;
    const c = cellAt(tc.clientX, tc.clientY);
    if (c && myTurn() && st.cells[c.y][c.x] === 0) net.move({ x: c.x, y: c.y });
  });

  function draw() {
    t += 0.03;
    const g = geom();
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.fillStyle = "#070a12";
    ctx.fillRect(0, 0, innerWidth, innerHeight);

    const win = st.path ? new Set(st.path.map(([x, y]) => y * N + x)) : null;

    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        const { cx, cy } = center(x, y);
        const v = st.cells[y][x];
        hexPath(cx, cy, g.r * 0.93);
        if (v) {
          ctx.fillStyle = COL[v - 1];
          if (win && win.has(y * N + x)) {
            ctx.shadowColor = COL[v - 1];
            ctx.shadowBlur = 14 + Math.sin(t * 4) * 8;
          }
          ctx.fill();
          ctx.shadowBlur = 0;
        } else {
          const isHover = hover && hover.x === x && hover.y === y && myTurn();
          ctx.fillStyle = isHover ? "rgba(255,255,255,.14)" : "#161d2e";
          ctx.fill();
        }
        ctx.strokeStyle = "rgba(140,160,210,.28)";
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
    }

    // edge markers showing who owns which sides
    ctx.lineWidth = 5;
    ctx.strokeStyle = COL[0];
    for (const row of [0, N - 1]) {
      ctx.beginPath();
      const a = center(0, row), b = center(N - 1, row);
      ctx.moveTo(a.cx - g.w / 2, a.cy + (row ? g.r : -g.r));
      ctx.lineTo(b.cx + g.w / 2, b.cy + (row ? g.r : -g.r));
      ctx.stroke();
    }
    ctx.strokeStyle = COL[1];
    for (const col of [0, N - 1]) {
      ctx.beginPath();
      const a = center(col, 0), b = center(col, N - 1);
      ctx.moveTo(a.cx + (col ? g.w / 2 : -g.w / 2), a.cy - g.r);
      ctx.lineTo(b.cx + (col ? g.w / 2 : -g.w / 2), b.cy + g.r);
      ctx.stroke();
    }

    ctx.textAlign = "center";
    ctx.font = "700 18px system-ui,sans-serif";
    const seat = mySeat();
    let msg, col;
    if (st.winner !== null && st.winner !== undefined) {
      const w = st.winner === net.id;
      msg = w ? "You connected!" : `${st.names[st.winner] || "Opponent"} connected`;
      col = w ? "#7df29b" : "#ff6b8a";
    } else if (seat < 0) { msg = "Spectating"; col = "#8b94b0"; }
    else { msg = myTurn() ? "Your turn" : "Waiting…"; col = myTurn() ? COL[seat] : "#8b94b0"; }
    ctx.fillStyle = col;
    ctx.fillText(msg, innerWidth / 2, 34);

    if (seat >= 0 && st.winner === null) {
      ctx.font = "600 12px system-ui,sans-serif";
      ctx.fillStyle = "#55607a";
      ctx.fillText(seat === 0 ? "You are RED — join top to bottom"
                              : "You are BLUE — join left to right",
                   innerWidth / 2, innerHeight - 70);
    }
  }

  function frame() { if (!running) return; draw(); raf = requestAnimationFrame(frame); }
  raf = requestAnimationFrame(frame);

  return {
    onState(s) { st = s; },
    onOver(m) { if (m.result) { st.winner = m.result.winner; st.path = m.result.path; } },
    teardown() {
      running = false;
      cancelAnimationFrame(raf);
      removeEventListener("resize", resize);
      canvas.removeEventListener("mousemove", onMove);
      canvas.removeEventListener("click", onClick);
    },
  };
};
