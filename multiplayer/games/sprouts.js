/* Sprouts client — drag from one spot to another to draw a curve.
   The server has the final say on whether a curve is legal; this just gives
   live feedback while you drag. */
window.MPGAMES = window.MPGAMES || {};
window.MPGAMES.sprouts = function (canvas, net, init) {
  "use strict";
  const ctx = canvas.getContext("2d");
  const DPR = Math.min(window.devicePixelRatio || 1, 2);
  const W = init.w, H = init.h, SPOT_R = init.spotR, MAXD = init.maxDeg;
  const COL = ["#5ce1ff", "#ff5c8a"];

  let st = { spots: [], curves: [], turn: 0, seats: init.seats, names: init.names, winner: null };
  let drag = null, err = "", errT = 0, raf = 0, running = true, t = 0;

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

  function view() {
    const s = Math.min((innerWidth - 30) / W, (innerHeight - 120) / H);
    return { s, x0: (innerWidth - W * s) / 2, y0: (innerHeight - H * s) / 2 + 16 };
  }
  const toScreen = (p) => { const v = view(); return { x: v.x0 + p.x * v.s, y: v.y0 + p.y * v.s }; };
  const toWorld = (px, py) => { const v = view(); return { x: (px - v.x0) / v.s, y: (py - v.y0) / v.s }; };

  function spotAt(w) {
    return st.spots.find((s) => Math.hypot(s.x - w.x, s.y - w.y) <= SPOT_R + 4) || null;
  }

  function down(px, py) {
    if (!myTurn()) return;
    const w = toWorld(px, py);
    const s = spotAt(w);
    if (!s || s.deg >= MAXD) { flash(s ? "that spot is full" : "start on a spot"); return; }
    drag = { a: s.id, pts: [{ x: s.x, y: s.y }] };
  }
  function moveTo(px, py) {
    if (!drag) return;
    const w = toWorld(px, py);
    const last = drag.pts[drag.pts.length - 1];
    if (Math.hypot(w.x - last.x, w.y - last.y) > 6) drag.pts.push(w);
  }
  function up(px, py) {
    if (!drag) return;
    const w = toWorld(px, py);
    const s = spotAt(w);
    if (!s) { flash("finish on a spot"); drag = null; return; }
    if (s.deg >= MAXD) { flash("that spot is full"); drag = null; return; }
    const pts = drag.pts.concat([{ x: s.x, y: s.y }]);
    if (pts.length > 300) pts.splice(0, pts.length - 300);
    net.move({ a: drag.a, b: s.id, pts });
    drag = null;
  }
  function flash(m) { err = m; errT = 2.2; }

  const md = (e) => down(e.clientX, e.clientY);
  const mm = (e) => moveTo(e.clientX, e.clientY);
  const mu = (e) => up(e.clientX, e.clientY);
  canvas.addEventListener("mousedown", md);
  canvas.addEventListener("mousemove", mm);
  addEventListener("mouseup", mu);
  canvas.addEventListener("touchstart", (e) => { const p = e.touches[0]; if (p) down(p.clientX, p.clientY); e.preventDefault(); }, { passive: false });
  canvas.addEventListener("touchmove", (e) => { const p = e.touches[0]; if (p) moveTo(p.clientX, p.clientY); e.preventDefault(); }, { passive: false });
  canvas.addEventListener("touchend", (e) => { const p = e.changedTouches[0]; if (p) up(p.clientX, p.clientY); });

  function strokePts(pts, colour, width) {
    if (pts.length < 2) return;
    ctx.beginPath();
    const a = toScreen(pts[0]);
    ctx.moveTo(a.x, a.y);
    for (let i = 1; i < pts.length; i++) { const p = toScreen(pts[i]); ctx.lineTo(p.x, p.y); }
    ctx.strokeStyle = colour;
    ctx.lineWidth = width;
    ctx.lineJoin = ctx.lineCap = "round";
    ctx.stroke();
  }

  function draw() {
    t += 0.03;
    if (errT > 0) errT -= 0.03;
    const v = view();
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.fillStyle = "#070a12";
    ctx.fillRect(0, 0, innerWidth, innerHeight);

    ctx.fillStyle = "#0c1120";
    ctx.fillRect(v.x0, v.y0, W * v.s, H * v.s);
    ctx.strokeStyle = "rgba(140,160,210,.25)";
    ctx.lineWidth = 1;
    ctx.strokeRect(v.x0, v.y0, W * v.s, H * v.s);

    st.curves.forEach((c) => {
      const owner = st.seats.indexOf(c.by);
      strokePts(c.pts, owner === 0 ? "rgba(92,225,255,.75)" : "rgba(255,92,138,.75)", 3);
    });

    if (drag) strokePts(drag.pts, "rgba(255,255,255,.75)", 3);

    st.spots.forEach((s) => {
      const p = toScreen(s);
      const full = s.deg >= MAXD;
      ctx.beginPath();
      ctx.arc(p.x, p.y, SPOT_R * v.s * 0.8, 0, 7);
      ctx.fillStyle = full ? "#39415a" : "#e8ecf8";
      ctx.fill();
      if (!full && myTurn()) {
        ctx.strokeStyle = `rgba(92,225,255,${0.4 + Math.sin(t * 3) * 0.25})`;
        ctx.lineWidth = 2;
        ctx.stroke();
      }
      // remaining capacity
      ctx.fillStyle = full ? "#6b7490" : "#070a12";
      ctx.font = `700 ${Math.max(9, 11 * v.s)}px system-ui,sans-serif`;
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText(String(MAXD - s.deg), p.x, p.y);
      ctx.textBaseline = "alphabetic";
    });

    ctx.textAlign = "center";
    ctx.font = "700 17px system-ui,sans-serif";
    const seat = mySeat();
    let msg, col;
    if (st.winner !== null && st.winner !== undefined) {
      const win = st.winner === net.id;
      msg = `${win ? "You win" : (st.names[st.winner] || "Opponent") + " wins"} — ${st.reason || ""}`;
      col = win ? "#7df29b" : "#ff6b8a";
    } else if (seat < 0) { msg = "Spectating"; col = "#8b94b0"; }
    else { msg = myTurn() ? "Drag between two spots" : "Waiting…"; col = myTurn() ? COL[seat] : "#8b94b0"; }
    ctx.fillStyle = col;
    ctx.fillText(msg, innerWidth / 2, 26);

    if (errT > 0) {
      ctx.fillStyle = `rgba(255,107,138,${Math.min(1, errT)})`;
      ctx.font = "600 13px system-ui,sans-serif";
      ctx.fillText(err, innerWidth / 2, 48);
    }
    if (seat >= 0 && st.winner === null) {
      ctx.font = "600 12px system-ui,sans-serif";
      ctx.fillStyle = "#55607a";
      const hint = innerWidth < 620
        ? "No crossing · 3 ends per spot"
        : "No crossing lines · each spot takes three ends · a new spot lands on your curve";
      ctx.fillText(hint, innerWidth / 2, innerHeight - 52);
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
      removeEventListener("mouseup", mu);
      canvas.removeEventListener("mousedown", md);
      canvas.removeEventListener("mousemove", mm);
    },
  };
};
