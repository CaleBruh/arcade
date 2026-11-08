/* Sumo Arena — client view.
   The server owns every position; this draws snapshots and sends intent.
   Snapshots arrive at 20Hz, so positions are interpolated between the last
   two to keep motion smooth at display rate. */
window.MPGAMES = window.MPGAMES || {};
window.MPGAMES.sumo = function (canvas, net, init) {
  "use strict";
  const ctx = canvas.getContext("2d");
  const DPR = Math.min(window.devicePixelRatio || 1, 2);
  const PR = init.pr || 16;

  const meta = new Map();                    // id -> {name, hue}
  init.players.forEach((p) => meta.set(p.id, p));

  let prev = null, cur = null, prevT = 0, curT = 0;
  let radius = init.r0, over = null;
  const keys = Object.create(null);
  let touch = null, raf = 0, running = true;

  function resize() {
    canvas.width = Math.round(innerWidth * DPR);
    canvas.height = Math.round(innerHeight * DPR);
    canvas.style.width = innerWidth + "px";
    canvas.style.height = innerHeight + "px";
  }
  resize();
  addEventListener("resize", resize);

  /* ---------- input ---------- */
  const kd = (e) => {
    keys[e.key.toLowerCase()] = true;
    if ([" ", "arrowup", "arrowdown", "arrowleft", "arrowright"].includes(e.key.toLowerCase())) e.preventDefault();
  };
  const ku = (e) => { keys[e.key.toLowerCase()] = false; };
  addEventListener("keydown", kd);
  addEventListener("keyup", ku);

  function touchVec(e) {
    const t = e.touches[0];
    if (!t) return null;
    const cx = innerWidth / 2, cy = innerHeight / 2;
    let x = (t.clientX - cx) / (innerWidth * 0.3), y = (t.clientY - cy) / (innerHeight * 0.3);
    const m = Math.hypot(x, y);
    if (m > 1) { x /= m; y /= m; }
    return { x, y };
  }
  const ts = (e) => { touch = touchVec(e); e.preventDefault(); };
  const te = () => { touch = null; };
  canvas.addEventListener("touchstart", ts, { passive: false });
  canvas.addEventListener("touchmove", ts, { passive: false });
  canvas.addEventListener("touchend", te);

  let lastSent = 0, wantDash = false;
  addEventListener("keydown", (e) => { if (e.key === "Shift" || e.key === " ") wantDash = true; });

  function sendInput(now) {
    if (now - lastSent < 50) return;            // 20Hz, matching the server
    lastSent = now;
    let x = 0, y = 0;
    if (keys.a || keys.arrowleft) x -= 1;
    if (keys.d || keys.arrowright) x += 1;
    if (keys.w || keys.arrowup) y -= 1;
    if (keys.s || keys.arrowdown) y += 1;
    if (touch) { x = touch.x; y = touch.y; }
    const m = Math.hypot(x, y);
    if (m > 1) { x /= m; y /= m; }
    net.input({ x, y, dash: wantDash });
    wantDash = false;
  }

  /* ---------- state ---------- */
  function onState(s) {
    prev = cur; prevT = curT;
    cur = s; curT = performance.now();
    radius = s.r;
    if (!prev) { prev = s; prevT = curT - 50; }
  }
  function onOver(m) { over = m.result; }

  function lerpPlayers() {
    if (!cur) return [];
    const span = Math.max(1, curT - prevT);
    const a = Math.min(1, (performance.now() - curT) / span);
    const pmap = new Map();
    if (prev) prev.p.forEach((p) => pmap.set(p[0], p));
    return cur.p.map((p) => {
      const q = pmap.get(p[0]);
      return {
        id: p[0],
        x: q ? q[1] + (p[1] - q[1]) * a : p[1],
        y: q ? q[2] + (p[2] - q[2]) * a : p[2],
        alive: p[3] === 1, dash: p[4], kills: p[5],
      };
    });
  }

  /* ---------- render ---------- */
  function draw() {
    const W = innerWidth, H = innerHeight;
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = "#070a12";
    ctx.fillRect(0, 0, W, H);

    const players = lerpPlayers();
    const me = players.find((p) => p.id === net.id);
    // camera keeps the whole disc in frame
    const scale = Math.min(W, H) / ((init.r0 + 60) * 2);
    ctx.save();
    ctx.translate(W / 2, H / 2);
    ctx.scale(scale, scale);

    // danger ring: where the floor used to be
    ctx.beginPath(); ctx.arc(0, 0, init.r0, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(255,70,90,0.05)"; ctx.fill();

    // the live platform
    const g = ctx.createRadialGradient(0, 0, radius * 0.2, 0, 0, radius);
    g.addColorStop(0, "#182134"); g.addColorStop(1, "#0e1422");
    ctx.beginPath(); ctx.arc(0, 0, radius, 0, Math.PI * 2);
    ctx.fillStyle = g; ctx.fill();
    ctx.lineWidth = 4; ctx.strokeStyle = "#5ce1ff";
    ctx.shadowColor = "#5ce1ff"; ctx.shadowBlur = 22; ctx.stroke(); ctx.shadowBlur = 0;

    for (const p of players) {
      if (!p.alive) continue;
      const m = meta.get(p.id) || { hue: 200, name: "?" };
      ctx.beginPath(); ctx.arc(p.x, p.y, PR, 0, Math.PI * 2);
      ctx.fillStyle = `hsl(${m.hue} 70% 55%)`;
      ctx.fill();
      if (p.id === net.id) {
        ctx.lineWidth = 3.5; ctx.strokeStyle = "#fff";
        ctx.shadowColor = "#fff"; ctx.shadowBlur = 14; ctx.stroke(); ctx.shadowBlur = 0;
      }
      if (p.dash === 0) {                          // dash ready pip
        ctx.beginPath(); ctx.arc(p.x, p.y - PR - 7, 2.6, 0, Math.PI * 2);
        ctx.fillStyle = "#ffd166"; ctx.fill();
      }
      ctx.font = "600 13px system-ui,sans-serif";
      ctx.textAlign = "center";
      ctx.fillStyle = "rgba(232,236,248,.75)";
      ctx.fillText(m.name, p.x, p.y + PR + 15);
    }
    ctx.restore();

    // HUD
    const alive = players.filter((p) => p.alive).length;
    ctx.font = "700 15px 'Courier New',monospace";
    ctx.textAlign = "left";
    ctx.fillStyle = "#cfd8ea";
    ctx.fillText(`ALIVE ${alive}`, 18, 28);
    ctx.fillText(`RING  ${Math.round(radius)}`, 18, 50);
    if (me) {
      ctx.fillStyle = me.alive ? "#7df29b" : "#ff6b8a";
      ctx.fillText(me.alive ? `KILLS ${me.kills}` : "ELIMINATED", 18, 72);
      if (me.alive) {
        ctx.fillStyle = me.dash === 0 ? "#ffd166" : "#55607a";
        ctx.fillText(me.dash === 0 ? "DASH READY" : `DASH ${(me.dash / 10).toFixed(1)}s`, 18, 94);
      }
    }
    ctx.textAlign = "right";
    ctx.fillStyle = "#55607a";
    ctx.fillText("WASD / drag · SHIFT dash", innerWidth - 18, 28);

    if (over) {
      ctx.fillStyle = "rgba(6,9,16,.82)";
      ctx.fillRect(0, 0, W, H);
      ctx.textAlign = "center";
      ctx.fillStyle = "#5ce1ff";
      ctx.font = "800 34px system-ui,sans-serif";
      const win = over.standings && over.standings[0];
      ctx.fillText(win ? `${win.name} wins` : "Round over", W / 2, H / 2 - 40);
      ctx.font = "600 15px system-ui,sans-serif";
      ctx.fillStyle = "#cfd8ea";
      (over.standings || []).slice(0, 8).forEach((s, i) => {
        ctx.fillText(`${s.place}. ${s.name}  ${s.kills} kills`, W / 2, H / 2 + i * 22);
      });
    }
  }

  function frame(now) {
    if (!running) return;
    sendInput(now);
    draw();
    raf = requestAnimationFrame(frame);
  }
  raf = requestAnimationFrame(frame);

  return {
    onState, onOver,
    teardown() {
      running = false;
      cancelAnimationFrame(raf);
      removeEventListener("keydown", kd);
      removeEventListener("keyup", ku);
      removeEventListener("resize", resize);
      canvas.removeEventListener("touchstart", ts);
      canvas.removeEventListener("touchmove", ts);
      canvas.removeEventListener("touchend", te);
    },
  };
};
