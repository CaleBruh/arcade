/* Arena — client view.
   Server owns every position, bullet and kill. This draws snapshots,
   interpolates between them at display rate, and sends move/aim/fire. */
window.MPGAMES = window.MPGAMES || {};
window.MPGAMES.arena = function (canvas, net, init) {
  "use strict";
  const ctx = canvas.getContext("2d");
  const DPR = Math.min(window.devicePixelRatio || 1, 2);
  const PR = init.pr || 15;

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

  // touch: drag the left half to move, tap/drag the right half to aim and fire
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

  function me() {
    if (!cur) return null;
    const row = cur.p.find((p) => p[0] === net.id);
    return row ? { x: row[1], y: row[2], hp: row[4], frags: row[5] } : null;
  }

  let lastSent = 0;
  function sendInput(now) {
    if (now - lastSent < 50) return;
    lastSent = now;
    let x = 0, y = 0;
    if (keys.a || keys.arrowleft) x -= 1;
    if (keys.d || keys.arrowright) x += 1;
    if (keys.w || keys.arrowup) y -= 1;
    if (keys.s || keys.arrowdown) y += 1;
    if (moveTouch) {
      x = (moveTouch.x - moveTouch.x0) / 60;
      y = (moveTouch.y - moveTouch.y0) / 60;
    }
    const m = Math.hypot(x, y);
    if (m > 1) { x /= m; y /= m; }

    // aim is a world angle from the player to the cursor
    const m0 = me();
    let aim = 0;
    if (m0) {
      const sx = innerWidth / 2 + (m0.x - cam.x);
      const sy = innerHeight / 2 + (m0.y - cam.y);
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
        aim: p[3], hp: p[4], frags: p[5],
      };
    });
  }

  function draw() {
    const W = innerWidth, H = innerHeight;
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.fillStyle = "#070a12";
    ctx.fillRect(0, 0, W, H);

    const players = lerpPlayers();
    const mine = players.find((p) => p.id === net.id);
    if (mine) { cam.x += (mine.x - cam.x) * 0.18; cam.y += (mine.y - cam.y) * 0.18; }

    // keep the camera inside the map so there is never dead space on screen
    const halfW = Math.min(W, init.w) / 2, halfH = Math.min(H, init.h) / 2;
    cam.x = Math.max(halfW, Math.min(init.w - halfW, cam.x));
    cam.y = Math.max(halfH, Math.min(init.h - halfH, cam.y));

    ctx.save();
    ctx.translate(W / 2 - cam.x, H / 2 - cam.y);

    // floor
    ctx.fillStyle = "#0d1322";
    ctx.fillRect(0, 0, init.w, init.h);
    ctx.strokeStyle = "rgba(92,225,255,.07)";
    ctx.lineWidth = 1;
    for (let x = 0; x <= init.w; x += 70) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, init.h); ctx.stroke(); }
    for (let y = 0; y <= init.h; y += 70) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(init.w, y); ctx.stroke(); }
    ctx.strokeStyle = "#5ce1ff";
    ctx.lineWidth = 3;
    ctx.strokeRect(0, 0, init.w, init.h);

    for (const w of init.walls) {
      ctx.fillStyle = "#1d2740";
      ctx.fillRect(w.x, w.y, w.w, w.h);
      ctx.strokeStyle = "#33436b";
      ctx.lineWidth = 2;
      ctx.strokeRect(w.x, w.y, w.w, w.h);
    }

    // bullets
    ctx.fillStyle = "#ffd166";
    for (const b of (cur ? cur.b : [])) {
      ctx.beginPath(); ctx.arc(b[0], b[1], 4, 0, Math.PI * 2); ctx.fill();
    }

    for (const p of players) {
      const m = meta.get(p.id) || { hue: 200, name: "?" };
      if (p.hp <= 0) {                       // respawning: faint marker only
        ctx.globalAlpha = 0.22;
        ctx.beginPath(); ctx.arc(p.x, p.y, PR, 0, Math.PI * 2);
        ctx.fillStyle = `hsl(${m.hue} 40% 40%)`; ctx.fill();
        ctx.globalAlpha = 1;
        continue;
      }
      // gun barrel
      ctx.strokeStyle = "#cfd8ea";
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(p.x + Math.cos(p.aim) * (PR + 10), p.y + Math.sin(p.aim) * (PR + 10));
      ctx.stroke();

      ctx.beginPath(); ctx.arc(p.x, p.y, PR, 0, Math.PI * 2);
      ctx.fillStyle = `hsl(${m.hue} 70% 55%)`; ctx.fill();
      if (p.id === net.id) {
        ctx.lineWidth = 3; ctx.strokeStyle = "#fff";
        ctx.shadowColor = "#fff"; ctx.shadowBlur = 12; ctx.stroke(); ctx.shadowBlur = 0;
      }
      // health pip
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

    // HUD
    const m0 = players.find((p) => p.id === net.id);
    ctx.font = "700 15px 'Courier New',monospace";
    ctx.textAlign = "left";
    ctx.fillStyle = "#cfd8ea";
    ctx.fillText(`TIME ${cur ? cur.left : 0}s`, 18, 28);
    if (m0) {
      ctx.fillStyle = m0.hp > 0 ? "#7df29b" : "#ff6b8a";
      ctx.fillText(m0.hp > 0 ? `HP ${m0.hp}` : "RESPAWNING", 18, 50);
      ctx.fillStyle = "#cfd8ea";
      ctx.fillText(`FRAGS ${m0.frags} / ${init.frags}`, 18, 72);
    }
    // top three
    const top = players.slice().sort((a, b) => b.frags - a.frags).slice(0, 3);
    ctx.textAlign = "right";
    top.forEach((p, i) => {
      const m = meta.get(p.id) || { name: "?" };
      ctx.fillStyle = p.id === net.id ? "#5ce1ff" : "#8b94b0";
      ctx.fillText(`${m.name} ${p.frags}`, innerWidth - 18, 28 + i * 20);
    });
    ctx.fillStyle = "#55607a";
    ctx.fillText("WASD move · mouse aim · click fire", innerWidth - 18, innerHeight - 16);

    if (over) {
      ctx.fillStyle = "rgba(6,9,16,.85)";
      ctx.fillRect(0, 0, W, H);
      ctx.textAlign = "center";
      ctx.fillStyle = "#5ce1ff";
      ctx.font = "800 34px system-ui,sans-serif";
      const win = over.standings && over.standings[0];
      ctx.fillText(win ? `${win.name} wins` : "Round over", W / 2, H / 2 - 50);
      ctx.font = "600 15px system-ui,sans-serif";
      ctx.fillStyle = "#cfd8ea";
      (over.standings || []).slice(0, 8).forEach((s, i) => {
        ctx.fillText(`${s.place}. ${s.name}  ${s.frags} frags / ${s.deaths} deaths`, W / 2, H / 2 - 10 + i * 22);
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
