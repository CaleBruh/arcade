/* Bomber Grid client. */
window.MPGAMES = window.MPGAMES || {};
window.MPGAMES.bomber = function (canvas, net, init) {
  "use strict";
  const ctx = canvas.getContext("2d");
  const DPR = Math.min(window.devicePixelRatio || 1, 2);
  const GW = init.w, GH = init.h;
  const meta = new Map(init.players.map((p) => [p.id, p]));
  let st = null, over = null, raf = 0, running = true, t = 0, grid = init.grid;

  function resize() {
    canvas.width = Math.round(innerWidth * DPR);
    canvas.height = Math.round(innerHeight * DPR);
    canvas.style.width = innerWidth + "px";
    canvas.style.height = innerHeight + "px";
  }
  resize(); addEventListener("resize", resize);

  const KEY = { arrowup:"up", w:"up", arrowdown:"down", s:"down",
                arrowleft:"left", a:"left", arrowright:"right", d:"right" };
  const held = Object.create(null);
  const kd = (e) => {
    const k = e.key.toLowerCase();
    if (k === " ") { net.input({ bomb: true }); e.preventDefault(); return; }
    if (KEY[k]) { held[KEY[k]] = true; e.preventDefault(); }
  };
  const ku = (e) => { const k = e.key.toLowerCase(); if (KEY[k]) held[KEY[k]] = false; };
  addEventListener("keydown", kd); addEventListener("keyup", ku);
  setInterval(() => {
    if (!running) return;
    const dir = ["up","down","left","right"].find((d) => held[d]);
    if (dir) net.input({ dir });
  }, 70);

  canvas.addEventListener("touchstart", (e) => {
    const p = e.touches[0]; if (!p) return;
    const g = geom();
    if (p.clientY > innerHeight - 90) { net.input({ bomb: true }); return; }
    const cx = g.x0 + GW * g.c / 2, cy = g.y0 + GH * g.c / 2;
    const dx = p.clientX - cx, dy = p.clientY - cy;
    net.input({ dir: Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? "right" : "left") : (dy > 0 ? "down" : "up") });
    e.preventDefault();
  }, { passive: false });

  function geom() {
    const c = Math.min((innerWidth - 24) / GW, (innerHeight - 110) / GH);
    return { c, x0: (innerWidth - GW * c) / 2, y0: (innerHeight - GH * c) / 2 + 18 };
  }

  function draw() {
    t += 0.04;
    const g = geom(), c = g.c;
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.fillStyle = "#070a12"; ctx.fillRect(0, 0, innerWidth, innerHeight);
    const G = st ? st.g : grid;
    for (let y = 0; y < GH; y++) for (let x = 0; x < GW; x++) {
      const v = G[y * GW + x];
      const px = g.x0 + x * c, py = g.y0 + y * c;
      ctx.fillStyle = v === 1 ? "#39445e" : v === 2 ? "#7a5236" : "#121a2b";
      ctx.fillRect(px, py, c - 1, c - 1);
      if (v === 2) { ctx.strokeStyle = "rgba(0,0,0,.25)"; ctx.lineWidth = 1;
                     ctx.strokeRect(px + 3, py + 3, c - 7, c - 7); }
    }
    if (st) {
      st.i.forEach(([x, y, kind]) => {
        ctx.fillStyle = kind ? "#ff9f45" : "#5ce1ff";
        ctx.beginPath(); ctx.arc(g.x0 + x * c + c/2, g.y0 + y * c + c/2, c * 0.22, 0, 7); ctx.fill();
      });
      st.b.forEach(([x, y, tt]) => {
        const pulse = 0.68 + Math.sin(t * 10) * 0.12 * (tt < 10 ? 2 : 1);
        ctx.fillStyle = "#1b2030";
        ctx.beginPath(); ctx.arc(g.x0 + x*c + c/2, g.y0 + y*c + c/2, c * 0.33 * pulse, 0, 7); ctx.fill();
        ctx.strokeStyle = "#ff5c6e"; ctx.lineWidth = 2; ctx.stroke();
      });
      st.f.forEach(([x, y]) => {
        ctx.fillStyle = `rgba(255,${140 + Math.sin(t*20)*60|0},60,.85)`;
        ctx.fillRect(g.x0 + x*c + 2, g.y0 + y*c + 2, c - 5, c - 5);
      });
      st.p.forEach(([id, x, y, alive]) => {
        if (!alive) return;
        const m = meta.get(id) || { hue: 200 };
        ctx.fillStyle = `hsl(${m.hue} 75% 58%)`;
        ctx.beginPath(); ctx.arc(g.x0 + x*c + c/2, g.y0 + y*c + c/2, c * 0.36, 0, 7); ctx.fill();
        if (id === net.id) { ctx.strokeStyle = "#fff"; ctx.lineWidth = 2.5; ctx.stroke(); }
      });
      const me = st.p.find((p) => p[0] === net.id);
      ctx.font = "700 13px 'Courier New',monospace"; ctx.textAlign = "left";
      ctx.fillStyle = me && me[3] ? "#cfd8ea" : "#ff6b8a";
      ctx.fillText(me ? (me[3] ? `BOMBS ${me[4]}  RANGE ${me[5]}  KILLS ${me[6]}` : "ELIMINATED") : "", 16, 22);
      ctx.textAlign = "right";
      ctx.fillStyle = "#55607a";
      ctx.fillText(`ALIVE ${st.p.filter(p=>p[3]).length}`, innerWidth - 16, 22);
    }
    ctx.textAlign = "center"; ctx.font = "600 12px system-ui,sans-serif";
    ctx.fillStyle = "#55607a";
    ctx.fillText("WASD / arrows · SPACE to drop a bomb", innerWidth / 2, innerHeight - 46);
    if (over) {
      ctx.fillStyle = "rgba(6,9,16,.85)"; ctx.fillRect(0, 0, innerWidth, innerHeight);
      ctx.fillStyle = "#5ce1ff"; ctx.font = "800 28px system-ui,sans-serif";
      const w = over.standings && over.standings[0];
      ctx.fillText(w ? `${w.name} wins` : "Round over", innerWidth/2, innerHeight/2 - 20);
      ctx.font = "600 14px system-ui,sans-serif"; ctx.fillStyle = "#cfd8ea";
      (over.standings||[]).forEach((s,i)=>ctx.fillText(`${s.place}. ${s.name} — ${s.kills} kills`,
        innerWidth/2, innerHeight/2 + 12 + i*20));
    }
  }
  function frame(){ if(!running) return; draw(); raf=requestAnimationFrame(frame); }
  raf = requestAnimationFrame(frame);
  return { onState(s){ st=s; }, onOver(m){ over=m.result; },
    teardown(){ running=false; cancelAnimationFrame(raf);
      removeEventListener("keydown",kd); removeEventListener("keyup",ku);
      removeEventListener("resize",resize); } };
};
