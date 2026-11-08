/* Slime Volleyball client — left/right and jump. */
window.MPGAMES = window.MPGAMES || {};
window.MPGAMES.volley = function (canvas, net, init) {
  "use strict";
  const ctx = canvas.getContext("2d");
  const DPR = Math.min(window.devicePixelRatio || 1, 2);
  const W = init.w, H = init.h;
  let st = null, over = null, raf = 0, running = true;
  const keys = Object.create(null);
  let lastSent = 0;

  function resize() {
    canvas.width = Math.round(innerWidth * DPR);
    canvas.height = Math.round(innerHeight * DPR);
    canvas.style.width = innerWidth + "px";
    canvas.style.height = innerHeight + "px";
  }
  resize();
  addEventListener("resize", resize);

  const kd = (e) => {
    const k = e.key.toLowerCase();
    keys[k] = true;
    if ([" ", "arrowup", "arrowleft", "arrowright"].includes(k)) e.preventDefault();
    if (k === " " || k === "arrowup" || k === "w") net.input({ dir: dirNow(), jump: true });
  };
  const ku = (e) => { keys[e.key.toLowerCase()] = false; };
  addEventListener("keydown", kd);
  addEventListener("keyup", ku);
  function dirNow() {
    let d = 0;
    if (keys.a || keys.arrowleft) d -= 1;
    if (keys.d || keys.arrowright) d += 1;
    return d;
  }
  // touch: left/right halves move, tap upper area jumps
  let touchDir = 0;
  canvas.addEventListener("touchstart", (e) => {
    const p = e.touches[0]; if (!p) return;
    if (p.clientY < innerHeight * 0.45) net.input({ dir: touchDir, jump: true });
    else touchDir = p.clientX < innerWidth / 2 ? -1 : 1;
    e.preventDefault();
  }, { passive: false });
  canvas.addEventListener("touchend", () => { touchDir = 0; });

  function view() {
    const s = Math.min((innerWidth - 24) / W, (innerHeight - 110) / H);
    return { s, x0: (innerWidth - W * s) / 2, y0: (innerHeight - H * s) / 2 + 20 };
  }

  function draw() {
    const now = performance.now();
    if (now - lastSent > 50) { lastSent = now; net.input({ dir: touchDir || dirNow() }); }

    const v = view();
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.fillStyle = "#070a12";
    ctx.fillRect(0, 0, innerWidth, innerHeight);

    const X = (x) => v.x0 + x * v.s, Y = (y) => v.y0 + y * v.s;
    ctx.fillStyle = "#121a2e";
    ctx.fillRect(v.x0, v.y0, W * v.s, H * v.s);
    ctx.fillStyle = "#1d2742";
    ctx.fillRect(v.x0, Y(init.ground), W * v.s, (H - init.ground) * v.s);
    ctx.fillStyle = "#cfd8ea";
    ctx.fillRect(X(W / 2 - init.netW / 2), Y(init.ground - init.netH),
                 init.netW * v.s, init.netH * v.s);

    if (st) {
      st.s.forEach(([id, x, y]) => {
        ctx.beginPath();
        ctx.arc(X(x), Y(y), init.slimeR * v.s, Math.PI, 0);
        ctx.closePath();
        ctx.fillStyle = id === net.id ? "#5ce1ff" : "#ff5c8a";
        ctx.fill();
        // eye, looking at the ball
        const bx = st.b[0], by = st.b[1];
        const a = Math.atan2(by - y, bx - x);
        ctx.fillStyle = "#fff";
        ctx.beginPath();
        ctx.arc(X(x) + Math.cos(a) * 12 * v.s, Y(y) - 18 * v.s + Math.sin(a) * 6 * v.s,
                7 * v.s, 0, 7);
        ctx.fill();
      });
      ctx.beginPath();
      ctx.arc(X(st.b[0]), Y(st.b[1]), init.ballR * v.s, 0, 7);
      ctx.fillStyle = "#ffd166"; ctx.fill();

      ctx.textAlign = "center";
      ctx.font = "800 26px 'Courier New',monospace";
      ctx.fillStyle = "#cfd8ea";
      const mine = init.seats.indexOf(net.id);
      const a2 = st.sc[mine < 0 ? 0 : mine], b2 = st.sc[mine === 1 ? 0 : 1];
      ctx.fillText(`${a2} — ${b2}`, innerWidth / 2, 34);
    }

    ctx.textAlign = "center";
    ctx.font = "600 12px system-ui,sans-serif";
    ctx.fillStyle = "#55607a";
    ctx.fillText("A / D or arrows to move · W / Space to jump", innerWidth / 2, innerHeight - 50);

    if (over) {
      ctx.fillStyle = "rgba(6,9,16,.85)";
      ctx.fillRect(0, 0, innerWidth, innerHeight);
      const win = over.winner === net.id;
      ctx.fillStyle = win ? "#7df29b" : "#ff6b8a";
      ctx.font = "800 30px system-ui,sans-serif";
      ctx.fillText(win ? "You win!" : `${over.names[over.winner] || "Opponent"} wins`,
                   innerWidth / 2, innerHeight / 2);
      ctx.font = "700 20px 'Courier New',monospace";
      ctx.fillStyle = "#cfd8ea";
      ctx.fillText(over.score.join(" — "), innerWidth / 2, innerHeight / 2 + 32);
    }
  }

  function frame() { if (!running) return; draw(); raf = requestAnimationFrame(frame); }
  raf = requestAnimationFrame(frame);

  return {
    onState(s) { st = s; },
    onOver(m) { over = m.result; },
    teardown() {
      running = false;
      cancelAnimationFrame(raf);
      removeEventListener("keydown", kd);
      removeEventListener("keyup", ku);
      removeEventListener("resize", resize);
    },
  };
};
