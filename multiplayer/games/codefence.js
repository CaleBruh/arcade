/* Co-op Defence — client view.
   Click a free cell to build the selected tower. The server validates every
   build (affordable, off the path, not already taken), so this can show an
   optimistic preview without being able to lie about the result. */
window.MPGAMES = window.MPGAMES || {};
window.MPGAMES.codefence = function (canvas, net, init) {
  "use strict";
  const ctx = canvas.getContext("2d");
  const DPR = Math.min(window.devicePixelRatio || 1, 2);
  const CELL = init.cell;
  const BOARD_W = init.cols * CELL, BOARD_H = init.rows * CELL;
  const TCOL = ["#5ce1ff", "#ffa94d", "#9bd4ff", "#f3c969"];

  const pathSet = new Set(init.path.map(([x, y]) => x + "," + y));
  let cur = null, over = null, pick = 0, hover = null;
  let raf = 0, running = true;
  let view = { x: 0, y: 0, s: 1 };

  function resize() {
    canvas.width = Math.round(innerWidth * DPR);
    canvas.height = Math.round(innerHeight * DPR);
    canvas.style.width = innerWidth + "px";
    canvas.style.height = innerHeight + "px";
    // fit the whole board, leaving room for the toolbar
    const availH = innerHeight - 150;
    view.s = Math.min(innerWidth / (BOARD_W + 40), availH / BOARD_H);
    view.x = (innerWidth - BOARD_W * view.s) / 2;
    view.y = 70;
  }
  resize();
  addEventListener("resize", resize);

  const toCell = (sx, sy) => ({
    col: Math.floor((sx - view.x) / (CELL * view.s)),
    row: Math.floor((sy - view.y) / (CELL * view.s)),
  });

  const mm = (e) => {
    const c = toCell(e.clientX, e.clientY);
    hover = (c.col >= 0 && c.col < init.cols && c.row >= 0 && c.row < init.rows) ? c : null;
  };
  const click = (e) => {
    // the toolbar is drawn on the canvas, so hit-test it before the board
    const n = toolbarHit(e.clientX, e.clientY);
    if (n !== null) { pick = n; return; }
    const c = toCell(e.clientX, e.clientY);
    if (c.col < 0 || c.col >= init.cols || c.row < 0 || c.row >= init.rows) return;
    if (pathSet.has(c.col + "," + c.row)) return;
    net.input({ build: pick, col: c.col, row: c.row });
  };
  canvas.addEventListener("mousemove", mm);
  canvas.addEventListener("click", click);
  const kd = (e) => {
    const n = parseInt(e.key, 10);
    if (n >= 1 && n <= init.towers.length) pick = n - 1;
  };
  addEventListener("keydown", kd);

  function toolbarRects() {
    const w = 128, h = 44, gap = 10;
    const total = init.towers.length * w + (init.towers.length - 1) * gap;
    const x0 = (innerWidth - total) / 2, y0 = innerHeight - 66;
    return init.towers.map((t, i) => ({ x: x0 + i * (w + gap), y: y0, w, h, t, i }));
  }
  function toolbarHit(sx, sy) {
    for (const r of toolbarRects()) {
      if (sx >= r.x && sx <= r.x + r.w && sy >= r.y && sy <= r.y + r.h) return r.i;
    }
    return null;
  }

  function onState(s) { cur = s; }
  function onOver(m) { over = m.result; }

  function draw() {
    const W = innerWidth, H = innerHeight;
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.fillStyle = "#070a12";
    ctx.fillRect(0, 0, W, H);

    ctx.save();
    ctx.translate(view.x, view.y);
    ctx.scale(view.s, view.s);

    ctx.fillStyle = "#101a2c";
    ctx.fillRect(0, 0, BOARD_W, BOARD_H);

    // buildable cells
    ctx.strokeStyle = "rgba(92,225,255,.08)";
    ctx.lineWidth = 1;
    for (let c = 0; c <= init.cols; c++) { ctx.beginPath(); ctx.moveTo(c * CELL, 0); ctx.lineTo(c * CELL, BOARD_H); ctx.stroke(); }
    for (let r = 0; r <= init.rows; r++) { ctx.beginPath(); ctx.moveTo(0, r * CELL); ctx.lineTo(BOARD_W, r * CELL); ctx.stroke(); }

    // the creep path
    for (const [c, r] of init.path) {
      ctx.fillStyle = "#24314d";
      ctx.fillRect(c * CELL, r * CELL, CELL, CELL);
    }
    // start and base
    const first = init.path[0], last = init.path[init.path.length - 1];
    ctx.fillStyle = "rgba(255,107,138,.35)";
    ctx.fillRect(first[0] * CELL, first[1] * CELL, CELL, CELL);
    ctx.fillStyle = "rgba(125,242,155,.35)";
    ctx.fillRect(last[0] * CELL, last[1] * CELL, CELL, CELL);
    ctx.font = "700 13px system-ui,sans-serif";
    ctx.textAlign = "center";
    ctx.fillStyle = "#cfd8ea";
    ctx.fillText("IN", first[0] * CELL + CELL / 2, first[1] * CELL + CELL / 2 + 4);
    ctx.fillText("BASE", last[0] * CELL + CELL / 2, last[1] * CELL + CELL / 2 + 4);

    // build preview
    if (hover && !pathSet.has(hover.col + "," + hover.row) && !over) {
      const spec = init.towers[pick];
      const afford = cur && cur.gold >= spec.cost;
      ctx.fillStyle = afford ? "rgba(92,225,255,.16)" : "rgba(255,107,138,.16)";
      ctx.fillRect(hover.col * CELL, hover.row * CELL, CELL, CELL);
      ctx.beginPath();
      ctx.arc(hover.col * CELL + CELL / 2, hover.row * CELL + CELL / 2, spec.range, 0, Math.PI * 2);
      ctx.strokeStyle = afford ? "rgba(92,225,255,.35)" : "rgba(255,107,138,.35)";
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    // towers, and their shots as a brief line to the target
    for (const tw of (cur ? cur.tw : [])) {
      const [k, c, r, tx, ty, firing] = tw;
      const x = c * CELL + CELL / 2, y = r * CELL + CELL / 2;
      if (firing && tx) {
        ctx.strokeStyle = TCOL[k];
        ctx.lineWidth = 2;
        ctx.globalAlpha = 0.8;
        ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(tx, ty); ctx.stroke();
        ctx.globalAlpha = 1;
      }
      ctx.fillStyle = "#1a2440";
      ctx.fillRect(c * CELL + 6, r * CELL + 6, CELL - 12, CELL - 12);
      ctx.fillStyle = TCOL[k];
      ctx.beginPath(); ctx.arc(x, y, CELL * 0.26, 0, Math.PI * 2); ctx.fill();
    }

    // creeps
    for (const c of (cur ? cur.c : [])) {
      const [x, y, hpPct, armoured, slowed] = c;
      ctx.beginPath();
      ctx.arc(x, y, armoured ? 13 : 10, 0, Math.PI * 2);
      ctx.fillStyle = slowed ? "#9bd4ff" : armoured ? "#c75c5c" : "#e07c4a";
      ctx.fill();
      if (armoured) { ctx.strokeStyle = "#ffd166"; ctx.lineWidth = 2; ctx.stroke(); }
      ctx.fillStyle = "rgba(0,0,0,.6)";
      ctx.fillRect(x - 12, y - 19, 24, 3.5);
      ctx.fillStyle = hpPct > 50 ? "#7df29b" : hpPct > 25 ? "#ffd166" : "#ff6b8a";
      ctx.fillRect(x - 12, y - 19, 24 * (hpPct / 100), 3.5);
    }
    ctx.restore();

    /* ---- HUD ---- */
    ctx.font = "700 16px 'Courier New',monospace";
    ctx.textAlign = "left";
    ctx.fillStyle = "#f3c969";
    ctx.fillText(`GOLD ${cur ? cur.gold : 0}`, 20, 32);
    ctx.fillStyle = cur && cur.lives <= 5 ? "#ff6b8a" : "#7df29b";
    ctx.fillText(`LIVES ${cur ? cur.lives : 0}`, 170, 32);
    ctx.fillStyle = "#cfd8ea";
    ctx.fillText(`WAVE ${cur ? cur.wave : 0} / ${init.waves}`, 320, 32);
    if (cur && cur.next > 0) {
      ctx.fillStyle = "#8b94b0";
      ctx.fillText(`NEXT IN ${cur.next}s`, 500, 32);
    }
    ctx.textAlign = "right";
    ctx.fillStyle = "#55607a";
    ctx.font = "700 12px 'Courier New',monospace";
    ctx.fillText("shared gold · click to build · 1-4 to pick", W - 20, 32);

    // toolbar
    for (const r of toolbarRects()) {
      const afford = cur && cur.gold >= r.t.cost;
      ctx.fillStyle = r.i === pick ? "rgba(92,225,255,.18)" : "rgba(18,22,38,.95)";
      ctx.fillRect(r.x, r.y, r.w, r.h);
      ctx.strokeStyle = r.i === pick ? "#5ce1ff" : "#232a44";
      ctx.lineWidth = r.i === pick ? 2 : 1;
      ctx.strokeRect(r.x, r.y, r.w, r.h);
      ctx.textAlign = "left";
      ctx.font = "700 13px system-ui,sans-serif";
      ctx.fillStyle = TCOL[r.i];
      ctx.fillText(`${r.i + 1}. ${r.t.name}`, r.x + 10, r.y + 19);
      ctx.font = "700 12px 'Courier New',monospace";
      ctx.fillStyle = afford ? "#f3c969" : "#55607a";
      ctx.fillText(`${r.t.cost}g`, r.x + 10, r.y + 35);
    }

    if (over) {
      ctx.fillStyle = "rgba(6,9,16,.88)";
      ctx.fillRect(0, 0, W, H);
      ctx.textAlign = "center";
      ctx.font = "800 36px system-ui,sans-serif";
      ctx.fillStyle = over.won ? "#7df29b" : "#ff6b8a";
      ctx.fillText(over.won ? "The base holds" : "The base fell", W / 2, H / 2 - 70);
      ctx.font = "600 15px system-ui,sans-serif";
      ctx.fillStyle = "#cfd8ea";
      ctx.fillText(over.won
        ? `All ${init.waves} waves cleared with ${over.lives} lives left`
        : `Overrun on wave ${over.wave} of ${init.waves}`, W / 2, H / 2 - 38);
      ctx.fillStyle = "#8b94b0";
      ctx.font = "700 12px 'Courier New',monospace";
      ctx.fillText("EVERYONE WINS OR NOBODY DOES — CONTRIBUTIONS BELOW", W / 2, H / 2 - 10);
      ctx.font = "600 14px system-ui,sans-serif";
      ctx.fillStyle = "#cfd8ea";
      (over.standings || []).slice(0, 8).forEach((s, i) => {
        ctx.fillText(`${s.name} — ${s.built} towers, ${s.spent}g spent, ${s.dmg} damage`,
                     W / 2, H / 2 + 20 + i * 22);
      });
    }
  }

  function frame() {
    if (!running) return;
    draw();
    raf = requestAnimationFrame(frame);
  }
  raf = requestAnimationFrame(frame);

  return {
    onState, onOver,
    teardown() {
      running = false;
      cancelAnimationFrame(raf);
      removeEventListener("resize", resize);
      removeEventListener("keydown", kd);
      canvas.removeEventListener("mousemove", mm);
      canvas.removeEventListener("click", click);
    },
  };
};
