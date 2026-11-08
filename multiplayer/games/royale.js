/* Battle Royale — client view.
   Same contract as Arena: the server owns positions, loot and damage. The
   extras here are the storm ring and a minimap, because the map is 2200px
   square and you cannot see the ring edge from the middle of it. */
window.MPGAMES = window.MPGAMES || {};
window.MPGAMES.royale = function (canvas, net, init) {
  "use strict";
  const ctx = canvas.getContext("2d");
  const DPR = Math.min(window.devicePixelRatio || 1, 2);
  const PR = init.pr || 15;
  const GUN_COLOUR = ["#8b94b0", "#7df29b", "#5ce1ff", "#ffa94d"];

  const meta = new Map();
  init.players.forEach((p) => meta.set(p.id, p));

  let prev = null, cur = null, prevT = 0, curT = 0, over = null;
  const keys = Object.create(null);
  let mouse = { x: 0, y: 0 }, firing = false, raf = 0, running = true;
  let cam = { x: init.w / 2, y: init.h / 2 };

  function resize() {
    canvas.width = Math.round(innerWidth * DPR);
    canvas.height = Math.round(innerHeight * DPR);
    canvas.style.width = innerWidth + "px";
    canvas.style.height = innerHeight + "px";
  }
  resize();
  addEventListener("resize", resize);

  const kd = (e) => {
    keys[e.key.toLowerCase()] = true;
    if ([" ", "arrowup", "arrowdown", "arrowleft", "arrowright"].includes(e.key.toLowerCase())) e.preventDefault();
  };
  const ku = (e) => { keys[e.key.toLowerCase()] = false; };
  addEventListener("keydown", kd);
  addEventListener("keyup", ku);

  const mm = (e) => { mouse = { x: e.clientX, y: e.clientY }; };
  const md = (e) => { firing = true; mouse = { x: e.clientX, y: e.clientY }; e.preventDefault(); };
  const mu = () => { firing = false; };
  canvas.addEventListener("mousemove", mm);
  canvas.addEventListener("mousedown", md);
  addEventListener("mouseup", mu);

  let moveTouch = null, aimTouch = null;
  const tstart = (e) => {
    for (const t of e.changedTouches) {
      if (t.clientX < innerWidth / 2 && moveTouch === null) moveTouch = { id: t.identifier, x0: t.clientX, y0: t.clientY, x: t.clientX, y: t.clientY };
      else if (aimTouch === null) aimTouch = { id: t.identifier, x: t.clientX, y: t.clientY };
    }
    e.preventDefault();
  };
  const tmove = (e) => {
    for (const t of e.changedTouches) {
      if (moveTouch && t.identifier === moveTouch.id) { moveTouch.x = t.clientX; moveTouch.y = t.clientY; }
      if (aimTouch && t.identifier === aimTouch.id) { aimTouch.x = t.clientX; aimTouch.y = t.clientY; }
    }
    e.preventDefault();
  };
  const tend = (e) => {
    for (const t of e.changedTouches) {
      if (moveTouch && t.identifier === moveTouch.id) moveTouch = null;
      if (aimTouch && t.identifier === aimTouch.id) aimTouch = null;
    }
  };
  canvas.addEventListener("touchstart", tstart, { passive: false });
  canvas.addEventListener("touchmove", tmove, { passive: false });
  canvas.addEventListener("touchend", tend);
  canvas.addEventListener("touchcancel", tend);

  function myRow() { return cur ? cur.p.find((p) => p[0] === net.id) : null; }

  let lastSent = 0;
  function sendInput(now) {
    if (now - lastSent < 50) return;
    lastSent = now;
    let x = 0, y = 0;
    if (keys.a || keys.arrowleft) x -= 1;
    if (keys.d || keys.arrowright) x += 1;
    if (keys.w || keys.arrowup) y -= 1;
    if (keys.s || keys.arrowdown) y += 1;
    if (moveTouch) { x = (moveTouch.x - moveTouch.x0) / 60; y = (moveTouch.y - moveTouch.y0) / 60; }
    const m = Math.hypot(x, y);
    if (m > 1) { x /= m; y /= m; }

    const r = myRow();
    let aim = 0;
    if (r) {
      const sx = innerWidth / 2 + (r[1] - cam.x);
      const sy = innerHeight / 2 + (r[2] - cam.y);
      const ax = aimTouch ? aimTouch.x : mouse.x;
      const ay = aimTouch ? aimTouch.y : mouse.y;
      aim = Math.atan2(ay - sy, ax - sx);
    }
    net.input({ x, y, aim, fire: firing || !!aimTouch || !!keys[" "] });
  }

  function onState(s) {
    prev = cur; prevT = curT;
    cur = s; curT = performance.now();
    if (!prev) { prev = s; prevT = curT - 50; }
  }
  function onOver(m) { over = m.result; }

  function lerpPlayers() {
    if (!cur) return [];
    const span = Math.max(1, curT - prevT);
    const a = Math.min(1, (performance.now() - curT) / span);
    const pm = new Map();
    if (prev) prev.p.forEach((p) => pm.set(p[0], p));
    return cur.p.map((p) => {
      const q = pm.get(p[0]);
      return {
        id: p[0],
        x: q ? q[1] + (p[1] - q[1]) * a : p[1],
        y: q ? q[2] + (p[2] - q[2]) * a : p[2],
        aim: p[3], hp: p[4], gun: p[5], kills: p[6],
      };
    });
  }

  function draw() {
    const W = innerWidth, H = innerHeight;
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.fillStyle = "#060910";
    ctx.fillRect(0, 0, W, H);
    if (!cur) return;

    const players = lerpPlayers();
    const mine = players.find((p) => p.id === net.id);
    if (mine) { cam.x += (mine.x - cam.x) * 0.18; cam.y += (mine.y - cam.y) * 0.18; }
    const halfW = Math.min(W, init.w) / 2, halfH = Math.min(H, init.h) / 2;
    cam.x = Math.max(halfW, Math.min(init.w - halfW, cam.x));
    cam.y = Math.max(halfH, Math.min(init.h - halfH, cam.y));

    ctx.save();
    ctx.translate(W / 2 - cam.x, H / 2 - cam.y);

    ctx.fillStyle = "#0c1220";
    ctx.fillRect(0, 0, init.w, init.h);
    ctx.strokeStyle = "rgba(92,225,255,.05)";
    ctx.lineWidth = 1;
    for (let x = 0; x <= init.w; x += 100) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, init.h); ctx.stroke(); }
    for (let y = 0; y <= init.h; y += 100) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(init.w, y); ctx.stroke(); }

    // everything outside the ring is tinted: the storm is the clock
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, init.w, init.h);
    ctx.arc(cur.cx, cur.cy, cur.r, 0, Math.PI * 2, true);
    ctx.fillStyle = "rgba(160,40,90,.26)";
    ctx.fill("evenodd");
    ctx.restore();
    ctx.beginPath();
    ctx.arc(cur.cx, cur.cy, cur.r, 0, Math.PI * 2);
    ctx.strokeStyle = "#ff6b8a";
    ctx.lineWidth = 3;
    ctx.shadowColor = "#ff6b8a"; ctx.shadowBlur = 16; ctx.stroke(); ctx.shadowBlur = 0;

    // crates
    for (const c of cur.c) {
      const kind = c[2];
      ctx.fillStyle = kind === 0 ? "#ff6b8a" : GUN_COLOUR[kind] || "#ffd166";
      ctx.fillRect(c[0] - 8, c[1] - 8, 16, 16);
      ctx.strokeStyle = "rgba(255,255,255,.65)";
      ctx.lineWidth = 1.5;
      ctx.strokeRect(c[0] - 8, c[1] - 8, 16, 16);
    }

    ctx.fillStyle = "#ffd166";
    for (const b of cur.b) { ctx.beginPath(); ctx.arc(b[0], b[1], 3.5, 0, Math.PI * 2); ctx.fill(); }

    for (const p of players) {
      if (p.hp <= 0) continue;
      const m = meta.get(p.id) || { hue: 200, name: "?" };
      ctx.strokeStyle = GUN_COLOUR[p.gun] || "#cfd8ea";
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(p.x + Math.cos(p.aim) * (PR + 11), p.y + Math.sin(p.aim) * (PR + 11));
      ctx.stroke();

      ctx.beginPath(); ctx.arc(p.x, p.y, PR, 0, Math.PI * 2);
      ctx.fillStyle = `hsl(${m.hue} 70% 55%)`; ctx.fill();
      if (p.id === net.id) {
        ctx.lineWidth = 3; ctx.strokeStyle = "#fff";
        ctx.shadowColor = "#fff"; ctx.shadowBlur = 12; ctx.stroke(); ctx.shadowBlur = 0;
      }
      const hw = PR * 2;
      ctx.fillStyle = "rgba(0,0,0,.55)";
      ctx.fillRect(p.x - hw / 2, p.y - PR - 11, hw, 4);
      ctx.fillStyle = p.hp > 50 ? "#7df29b" : p.hp > 25 ? "#ffd166" : "#ff6b8a";
      ctx.fillRect(p.x - hw / 2, p.y - PR - 11, hw * (p.hp / 100), 4);
      ctx.font = "600 12px system-ui,sans-serif";
      ctx.textAlign = "center";
      ctx.fillStyle = "rgba(232,236,248,.8)";
      ctx.fillText(m.name, p.x, p.y + PR + 14);
    }
    ctx.restore();

    /* ---- HUD ---- */
    const r = myRow();
    ctx.font = "700 15px 'Courier New',monospace";
    ctx.textAlign = "left";
    ctx.fillStyle = "#cfd8ea";
    ctx.fillText(`ALIVE ${cur.alive}`, 18, 28);
    if (r) {
      const hp = r[4];
      ctx.fillStyle = hp > 0 ? (hp > 40 ? "#7df29b" : "#ff6b8a") : "#ff6b8a";
      ctx.fillText(hp > 0 ? `HP ${hp}` : "ELIMINATED", 18, 50);
      if (hp > 0) {
        ctx.fillStyle = GUN_COLOUR[r[5]] || "#cfd8ea";
        ctx.fillText(init.guns[r[5]].toUpperCase(), 18, 72);
        // warn when you are standing in the storm
        const d = Math.hypot(r[1] - cur.cx, r[2] - cur.cy);
        if (d > cur.r) {
          ctx.fillStyle = "#ff6b8a";
          ctx.fillText("IN THE STORM — MOVE", 18, 94);
        }
      }
      ctx.fillStyle = "#8b94b0";
      ctx.fillText(`KILLS ${r[6]}`, 18, 116);
    }

    // minimap: the ring is bigger than the screen, so position matters
    const MM = 150, pad = 18;
    const mx = W - MM - pad, my = pad;
    const sc = MM / init.w;
    ctx.fillStyle = "rgba(8,12,22,.8)";
    ctx.fillRect(mx, my, MM, MM);
    ctx.strokeStyle = "#33436b";
    ctx.lineWidth = 1;
    ctx.strokeRect(mx, my, MM, MM);
    ctx.beginPath();
    ctx.arc(mx + cur.cx * sc, my + cur.cy * sc, cur.r * sc, 0, Math.PI * 2);
    ctx.strokeStyle = "#ff6b8a";
    ctx.lineWidth = 1.5;
    ctx.stroke();
    for (const p of players) {
      if (p.hp <= 0) continue;
      const self = p.id === net.id;
      ctx.beginPath();
      ctx.arc(mx + p.x * sc, my + p.y * sc, self ? 3.5 : 2, 0, Math.PI * 2);
      ctx.fillStyle = self ? "#fff" : "rgba(92,225,255,.6)";
      ctx.fill();
    }

    ctx.textAlign = "right";
    ctx.fillStyle = "#55607a";
    ctx.font = "700 13px 'Courier New',monospace";
    ctx.fillText("WASD move · mouse aim · click fire", W - 18, H - 16);

    if (over) {
      ctx.fillStyle = "rgba(6,9,16,.85)";
      ctx.fillRect(0, 0, W, H);
      ctx.textAlign = "center";
      ctx.fillStyle = "#5ce1ff";
      ctx.font = "800 34px system-ui,sans-serif";
      const win = over.standings && over.standings[0];
      ctx.fillText(win ? `${win.name} takes it` : "Round over", W / 2, H / 2 - 50);
      ctx.font = "600 15px system-ui,sans-serif";
      ctx.fillStyle = "#cfd8ea";
      (over.standings || []).slice(0, 8).forEach((s, i) => {
        ctx.fillText(`${s.place}. ${s.name}  ${s.kills} kills`, W / 2, H / 2 - 10 + i * 22);
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
      removeEventListener("mouseup", mu);
      canvas.removeEventListener("mousemove", mm);
      canvas.removeEventListener("mousedown", md);
      canvas.removeEventListener("touchstart", tstart);
      canvas.removeEventListener("touchmove", tmove);
      canvas.removeEventListener("touchend", tend);
      canvas.removeEventListener("touchcancel", tend);
    },
  };
};
