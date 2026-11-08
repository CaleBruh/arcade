/* Light Cycles client. Trails are accumulated locally from the per-tick
   'add' list so the server never has to resend the whole wall. */
window.MPGAMES = window.MPGAMES || {};
window.MPGAMES.lightcycles = function (canvas, net, init) {
  "use strict";
  const ctx = canvas.getContext("2d");
  const DPR = Math.min(window.devicePixelRatio || 1, 2);
  const GW = init.w, GH = init.h;
  const meta = new Map(init.players.map((p) => [p.id, p]));
  const trails = new Map(init.players.map((p) => [p.id, []]));

  let snap = null, over = null, raf = 0, running = true, t = 0;

  function resize() {
    canvas.width = Math.round(innerWidth * DPR);
    canvas.height = Math.round(innerHeight * DPR);
    canvas.style.width = innerWidth + "px";
    canvas.style.height = innerHeight + "px";
  }
  resize();
  addEventListener("resize", resize);

  const KEYMAP = { arrowup: "up", w: "up", arrowdown: "down", s: "down",
                   arrowleft: "left", a: "left", arrowright: "right", d: "right" };
  const kd = (e) => {
    const dir = KEYMAP[e.key.toLowerCase()];
    if (dir) { net.input({ dir }); e.preventDefault(); }
  };
  addEventListener("keydown", kd);

  // swipe to turn on touch
  let tx = 0, ty = 0;
  canvas.addEventListener("touchstart", (e) => { const p = e.touches[0]; tx = p.clientX; ty = p.clientY; }, { passive: true });
  canvas.addEventListener("touchend", (e) => {
    const p = e.changedTouches[0]; if (!p) return;
    const dx = p.clientX - tx, dy = p.clientY - ty;
    if (Math.abs(dx) < 18 && Math.abs(dy) < 18) return;
    net.input({ dir: Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? "right" : "left") : (dy > 0 ? "down" : "up") });
  });

  function geom() {
    const s = Math.min((innerWidth - 24) / GW, (innerHeight - 90) / GH);
    return { s, x0: (innerWidth - GW * s) / 2, y0: (innerHeight - GH * s) / 2 + 20 };
  }

  function draw() {
    t += 0.03;
    const g = geom();
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.fillStyle = "#05070e";
    ctx.fillRect(0, 0, innerWidth, innerHeight);

    ctx.fillStyle = "#0a0e1a";
    ctx.fillRect(g.x0, g.y0, GW * g.s, GH * g.s);
    ctx.strokeStyle = "rgba(92,225,255,.45)";
    ctx.lineWidth = 2;
    ctx.strokeRect(g.x0, g.y0, GW * g.s, GH * g.s);

    const cell = Math.max(1, g.s);
    for (const [id, cells] of trails) {
      const m = meta.get(id) || { hue: 200 };
      const alive = snap ? (snap.p.find((p) => p[0] === id) || [])[3] === 1 : true;
      ctx.fillStyle = `hsl(${m.hue} ${alive ? 85 : 25}% ${alive ? 55 : 30}%)`;
      for (const [cx, cy] of cells) {
        ctx.fillRect(g.x0 + cx * g.s, g.y0 + cy * g.s, cell, cell);
      }
    }
    if (snap) {
      for (const p of snap.p) {
        if (p[3] !== 1) continue;
        const m = meta.get(p[0]) || { hue: 200 };
        ctx.fillStyle = "#fff";
        ctx.shadowColor = `hsl(${m.hue} 90% 60%)`;
        ctx.shadowBlur = 12;
        ctx.fillRect(g.x0 + p[1] * g.s - cell * 0.5, g.y0 + p[2] * g.s - cell * 0.5, cell * 2, cell * 2);
        ctx.shadowBlur = 0;
      }
    }

    ctx.font = "700 14px 'Courier New',monospace";
    ctx.textAlign = "left";
    let y = 24;
    for (const [id, m] of meta) {
      const p = snap ? snap.p.find((q) => q[0] === id) : null;
      const alive = p ? p[3] === 1 : true;
      ctx.fillStyle = alive ? `hsl(${m.hue} 80% 60%)` : "#3a4258";
      ctx.fillText(`${m.name}${id === net.id ? " (you)" : ""}${alive ? "" : " — out"}`, 16, y);
      y += 18;
    }

    if (over) {
      ctx.fillStyle = "rgba(5,7,14,.85)";
      ctx.fillRect(0, 0, innerWidth, innerHeight);
      ctx.textAlign = "center";
      ctx.fillStyle = "#5ce1ff";
      ctx.font = "800 30px system-ui,sans-serif";
      const w = over.standings && over.standings[0];
      ctx.fillText(w ? `${w.name} survives` : "Round over", innerWidth / 2, innerHeight / 2 - 20);
      ctx.font = "600 14px system-ui,sans-serif";
      ctx.fillStyle = "#cfd8ea";
      (over.standings || []).forEach((s, i) =>
        ctx.fillText(`${s.place}. ${s.name}`, innerWidth / 2, innerHeight / 2 + 14 + i * 20));
    }
  }

  function frame() { if (!running) return; draw(); raf = requestAnimationFrame(frame); }
  raf = requestAnimationFrame(frame);

  return {
    onState(s) {
      snap = s;
      (s.add || []).forEach(([id, x, y]) => {
        const arr = trails.get(id);
        if (arr) arr.push([x, y]);
      });
    },
    onOver(m) { over = m.result; },
    teardown() {
      running = false;
      cancelAnimationFrame(raf);
      removeEventListener("keydown", kd);
      removeEventListener("resize", resize);
    },
  };
};
