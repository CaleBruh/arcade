/* Quiz Buzzer — client view.

   Drawn on the canvas like every other game so it drops into the same lobby
   slot, but it is really a UI: a question, four hit-tested answer tiles, a
   draining timer and a scoreboard. The server never sends the correct answer
   until the reveal, so there is nothing here to peek at. */
window.MPGAMES = window.MPGAMES || {};
window.MPGAMES.quiz = function (canvas, net, init) {
  "use strict";
  const ctx = canvas.getContext("2d");
  const DPR = Math.min(window.devicePixelRatio || 1, 2);
  const KEYS = ["A", "B", "C", "D"];
  const TILE = ["#ff6b8a", "#5ce1ff", "#ffd166", "#7df29b"];

  const meta = new Map();
  init.players.forEach((p) => meta.set(p.id, p));

  let cur = null, over = null, myPick = null, lastRound = -1;
  let raf = 0, running = true, hover = -1;

  function resize() {
    canvas.width = Math.round(innerWidth * DPR);
    canvas.height = Math.round(innerHeight * DPR);
    canvas.style.width = innerWidth + "px";
    canvas.style.height = innerHeight + "px";
  }
  resize();
  addEventListener("resize", resize);

  /* Two columns on anything wide, one on a phone. The tiles are the entire
     interface, so they get the bottom two thirds of the screen. */
  function tiles() {
    const W = innerWidth, H = innerHeight;
    const narrow = W < 680;
    const top = H * 0.40;
    // the lobby draws its own Leave Game button bottom-right (roughly H-50 to
    // H-14), so the tiles stop well above it and the footer sits in between
    const bottom = H - 96;
    const gap = 12;
    const out = [];
    if (narrow) {
      const h = (bottom - top - gap * 3) / 4;
      for (let i = 0; i < 4; i++) out.push({ i, x: 24, y: top + i * (h + gap), w: W - 48, h });
    } else {
      const w = (W - 48 - gap) / 2;
      const h = (bottom - top - gap) / 2;
      for (let i = 0; i < 4; i++) {
        out.push({ i, x: 24 + (i % 2) * (w + gap), y: top + Math.floor(i / 2) * (h + gap), w, h });
      }
    }
    return out;
  }
  const hit = (x, y) => {
    for (const t of tiles()) if (x >= t.x && x <= t.x + t.w && y >= t.y && y <= t.y + t.h) return t.i;
    return -1;
  };

  function answer(i) {
    if (!cur || cur.phase !== "question" || myPick !== null || i < 0) return;
    myPick = i;
    net.input({ answer: i });
  }

  const mm = (e) => { hover = hit(e.clientX, e.clientY); };
  const click = (e) => answer(hit(e.clientX, e.clientY));
  const tap = (e) => {
    const t = e.changedTouches[0];
    if (t) answer(hit(t.clientX, t.clientY));
    e.preventDefault();
  };
  canvas.addEventListener("mousemove", mm);
  canvas.addEventListener("click", click);
  canvas.addEventListener("touchend", tap, { passive: false });

  // 1-4 and A-D both work, because people reach for either
  const kd = (e) => {
    const k = e.key.toUpperCase();
    const n = KEYS.indexOf(k);
    if (n >= 0) answer(n);
    const d = parseInt(e.key, 10);
    if (d >= 1 && d <= 4) answer(d - 1);
  };
  addEventListener("keydown", kd);

  function onState(s) {
    // a new round clears the local pick; the server has already cleared its own
    if (s.round !== lastRound) { lastRound = s.round; myPick = null; }
    cur = s;
  }
  function onOver(m) { over = m.result; }

  function wrapText(text, maxW, font) {
    ctx.font = font;
    const words = String(text).split(" ");
    const lines = [];
    let line = "";
    for (const w of words) {
      const test = line ? line + " " + w : w;
      if (ctx.measureText(test).width > maxW && line) { lines.push(line); line = w; }
      else line = test;
    }
    if (line) lines.push(line);
    return lines;
  }

  function draw() {
    const W = innerWidth, H = innerHeight;
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.fillStyle = "#070a12";
    ctx.fillRect(0, 0, W, H);
    if (!cur) return;

    if (over || cur.phase === "final") { drawFinal(W, H); return; }

    /* ---- header ---- */
    ctx.textAlign = "left";
    ctx.font = "700 13px 'Courier New',monospace";
    ctx.fillStyle = "#8b94b0";
    ctx.fillText(`QUESTION ${cur.round} / ${cur.rounds}`, 24, 30);
    if (cur.category) {
      ctx.textAlign = "center";
      ctx.fillStyle = "#5ce1ff";
      ctx.fillText(String(cur.category).toUpperCase(), W / 2, 30);
    }
    ctx.textAlign = "right";
    ctx.fillStyle = "#8b94b0";
    ctx.fillText(`${cur.answered} / ${cur.total} IN`, W - 24, 30);

    /* ---- timer bar: the whole tension of the game ---- */
    const frac = cur.phase === "question" ? cur.clock / init.ask : 1;
    ctx.fillStyle = "#151c30";
    ctx.fillRect(24, 42, W - 48, 6);
    ctx.fillStyle = frac > 0.5 ? "#7df29b" : frac > 0.25 ? "#ffd166" : "#ff6b8a";
    ctx.fillRect(24, 42, (W - 48) * Math.max(0, Math.min(1, frac)), 6);

    if (cur.phase === "intro") {
      ctx.textAlign = "center";
      ctx.fillStyle = "#5ce1ff";
      ctx.font = "800 42px system-ui,sans-serif";
      ctx.fillText("Get ready", W / 2, H / 2 - 20);
      ctx.fillStyle = "#cfd8ea";
      ctx.font = "700 72px 'Courier New',monospace";
      ctx.fillText(String(cur.clock), W / 2, H / 2 + 60);
      return;
    }

    /* ---- question ---- */
    const qFont = W < 680 ? "700 22px system-ui,sans-serif" : "700 30px system-ui,sans-serif";
    const lines = wrapText(cur.q, W - 80, qFont);
    ctx.textAlign = "center";
    ctx.fillStyle = "#e8ecf8";
    ctx.font = qFont;
    const lh = W < 680 ? 29 : 38;
    const startY = H * 0.40 / 2 - ((lines.length - 1) * lh) / 2 + 18;
    lines.forEach((l, i) => ctx.fillText(l, W / 2, startY + i * lh));

    if (cur.phase === "question") {
      ctx.font = "700 46px 'Courier New',monospace";
      ctx.fillStyle = cur.clock <= 5 ? "#ff6b8a" : "#8b94b0";
      ctx.fillText(String(cur.clock), W / 2, H * 0.40 - 16);
    }

    /* ---- answer tiles ---- */
    const revealing = cur.phase === "reveal";
    for (const t of tiles()) {
      const isMine = myPick === t.i;
      const isRight = revealing && cur.correct === t.i;
      const isWrongPick = revealing && isMine && cur.correct !== t.i;

      let fill = "rgba(18,22,38,.95)", stroke = "#232a44", alpha = 1;
      if (revealing) {
        if (isRight) { fill = "rgba(125,242,155,.18)"; stroke = "#7df29b"; }
        else if (isWrongPick) { fill = "rgba(255,107,138,.16)"; stroke = "#ff6b8a"; }
        else alpha = 0.4;
      } else if (isMine) {
        fill = "rgba(92,225,255,.18)"; stroke = "#5ce1ff";
      } else if (hover === t.i && myPick === null) {
        stroke = "#4a5578";
      }

      ctx.globalAlpha = alpha;
      ctx.fillStyle = fill;
      ctx.fillRect(t.x, t.y, t.w, t.h);
      ctx.strokeStyle = stroke;
      ctx.lineWidth = (isMine || isRight) ? 2.5 : 1;
      ctx.strokeRect(t.x, t.y, t.w, t.h);

      // letter chip
      ctx.fillStyle = TILE[t.i];
      ctx.fillRect(t.x + 1, t.y + 1, 38, t.h - 2);
      ctx.fillStyle = "#07101c";
      ctx.font = "800 18px 'Courier New',monospace";
      ctx.textAlign = "center";
      ctx.fillText(KEYS[t.i], t.x + 20, t.y + t.h / 2 + 6);

      // option text, wrapped inside the tile
      const oFont = W < 680 ? "600 15px system-ui,sans-serif" : "600 18px system-ui,sans-serif";
      const ol = wrapText(cur.options[t.i], t.w - 70, oFont);
      ctx.fillStyle = "#e8ecf8";
      ctx.font = oFont;
      ctx.textAlign = "left";
      const oy = t.y + t.h / 2 - ((ol.length - 1) * 21) / 2 + 6;
      ol.forEach((l, i) => ctx.fillText(l, t.x + 52, oy + i * 21));

      if (revealing && cur.counts) {
        ctx.textAlign = "right";
        ctx.font = "700 13px 'Courier New',monospace";
        ctx.fillStyle = isRight ? "#7df29b" : "#8b94b0";
        ctx.fillText(`${cur.counts[t.i]}`, t.x + t.w - 12, t.y + t.h - 12);
      }
      ctx.globalAlpha = 1;
    }

    /* ---- footer: your standing and the leaders ---- */
    const meRow = (cur.board || []).find((b) => b.id === net.id);
    ctx.textAlign = "left";
    ctx.font = "700 13px 'Courier New',monospace";
    const footY = H - 62;
    if (myPick === null && cur.phase === "question") {
      ctx.fillStyle = "#ffd166";
      ctx.fillText("PICK ONE — A/B/C/D OR 1-4", 24, footY);
    } else if (meRow) {
      ctx.fillStyle = "#5ce1ff";
      ctx.fillText(`YOU ${meRow.score} PTS${meRow.streak > 1 ? "  STREAK " + meRow.streak : ""}`, 24, footY);
    }
    ctx.textAlign = "right";
    ctx.fillStyle = "#8b94b0";
    const lead = (cur.board || []).slice(0, 3)
      .map((b) => `${b.name} ${b.score}`).join("   ");
    ctx.fillText(lead, W - 24, footY);
  }

  function drawFinal(W, H) {
    const rows = (over && over.standings) || (cur && cur.standings) || [];
    ctx.textAlign = "center";
    ctx.fillStyle = "#5ce1ff";
    ctx.font = "800 38px system-ui,sans-serif";
    const win = rows[0];
    ctx.fillText(win ? `${win.name} wins` : "Quiz over", W / 2, 90);
    ctx.font = "700 13px 'Courier New',monospace";
    ctx.fillStyle = "#8b94b0";
    ctx.fillText("FINAL STANDINGS", W / 2, 118);

    const top = rows.slice(0, 12);
    const rowH = Math.min(34, (H - 190) / Math.max(1, top.length));
    top.forEach((s, i) => {
      const y = 160 + i * rowH;
      const mine = s.id === net.id;
      ctx.fillStyle = mine ? "rgba(92,225,255,.12)" : i % 2 ? "rgba(255,255,255,.02)" : "transparent";
      ctx.fillRect(W / 2 - 300, y - rowH * 0.7, 600, rowH);
      ctx.textAlign = "left";
      ctx.font = "700 15px 'Courier New',monospace";
      ctx.fillStyle = i === 0 ? "#f3c969" : "#55607a";
      ctx.fillText(String(s.place).padStart(2, " "), W / 2 - 288, y);
      ctx.font = "600 16px system-ui,sans-serif";
      ctx.fillStyle = mine ? "#5ce1ff" : "#e8ecf8";
      ctx.fillText(s.name, W / 2 - 250, y);
      ctx.textAlign = "right";
      ctx.font = "700 14px 'Courier New',monospace";
      ctx.fillStyle = "#8b94b0";
      if (s.correct !== undefined) ctx.fillText(`${s.correct}/${s.rounds}`, W / 2 + 150, y);
      ctx.fillStyle = mine ? "#5ce1ff" : "#cfd8ea";
      ctx.fillText(`${s.score}`, W / 2 + 288, y);
    });
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
      canvas.removeEventListener("touchend", tap);
    },
  };
};
