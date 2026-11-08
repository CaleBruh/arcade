/* Air Hockey client — drag your mallet; the server clamps it to your half. */
window.MPGAMES = window.MPGAMES || {};
window.MPGAMES.airhockey = function (canvas, net, init) {
  "use strict";
  const ctx = canvas.getContext("2d");
  const DPR = Math.min(window.devicePixelRatio || 1, 2);
  const W = init.w, H = init.h;
  let st = null, over = null, raf = 0, running = true, last = 0;

  function resize() {
    canvas.width = Math.round(innerWidth * DPR);
    canvas.height = Math.round(innerHeight * DPR);
    canvas.style.width = innerWidth + "px";
    canvas.style.height = innerHeight + "px";
  }
  resize();
  addEventListener("resize", resize);

  const mySeat = () => (st ? st0().indexOf(net.id) : -1);
  function st0() { return init.seats; }

  function view() {
    const s = Math.min((innerWidth - 24) / W, (innerHeight - 90) / H);
    return { s, x0: (innerWidth - W * s) / 2, y0: (innerHeight - H * s) / 2 + 16 };
  }
  // seat 1 defends the bottom; flip so "your end" is always nearest you
  const flip = () => init.seats.indexOf(net.id) === 0;
  function toWorld(px, py) {
    const v = view();
    let x = (px - v.x0) / v.s, y = (py - v.y0) / v.s;
    if (flip()) { x = W - x; y = H - y; }
    return { x, y };
  }
  function toScreen(x, y) {
    const v = view();
    const fx = flip() ? W - x : x, fy = flip() ? H - y : y;
    return { x: v.x0 + fx * v.s, y: v.y0 + fy * v.s };
  }

  function send(px, py) {
    const now = performance.now();
    if (now - last < 40) return;
    last = now;
    const w = toWorld(px, py);
    net.input({ x: w.x, y: w.y });
  }
  const mm = (e) => send(e.clientX, e.clientY);
  canvas.addEventListener("mousemove", mm);
  canvas.addEventListener("touchmove", (e) => { const p = e.touches[0]; if (p) send(p.clientX, p.clientY); e.preventDefault(); }, { passive: false });

  function draw() {
    const v = view();
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.fillStyle = "#070a12";
    ctx.fillRect(0, 0, innerWidth, innerHeight);

    ctx.fillStyle = "#101828";
    ctx.fillRect(v.x0, v.y0, W * v.s, H * v.s);
    ctx.strokeStyle = "rgba(140,170,220,.5)";
    ctx.lineWidth = 3;
    ctx.strokeRect(v.x0, v.y0, W * v.s, H * v.s);
    // centre line + circle
    ctx.beginPath();
    ctx.moveTo(v.x0, v.y0 + H / 2 * v.s); ctx.lineTo(v.x0 + W * v.s, v.y0 + H / 2 * v.s);
    ctx.strokeStyle = "rgba(140,170,220,.25)"; ctx.lineWidth = 2; ctx.stroke();
    ctx.beginPath();
    ctx.arc(v.x0 + W / 2 * v.s, v.y0 + H / 2 * v.s, 70 * v.s, 0, 7); ctx.stroke();
    // goal mouths
    const gw = init.goal * v.s;
    ctx.strokeStyle = "#5ce1ff"; ctx.lineWidth = 5;
    [0, H].forEach((yy) => {
      const p = toScreen(W / 2, yy);
      ctx.beginPath(); ctx.moveTo(p.x - gw / 2, p.y); ctx.lineTo(p.x + gw / 2, p.y); ctx.stroke();
    });

    if (st) {
      st.pads.forEach(([id, x, y]) => {
        const p = toScreen(x, y);
        ctx.beginPath(); ctx.arc(p.x, p.y, init.mallet * v.s, 0, 7);
        ctx.fillStyle = id === net.id ? "#5ce1ff" : "#ff5c8a";
        ctx.fill();
        ctx.strokeStyle = "rgba(255,255,255,.5)"; ctx.lineWidth = 2; ctx.stroke();
      });
      const p = toScreen(st.puck[0], st.puck[1]);
      ctx.beginPath(); ctx.arc(p.x, p.y, init.puck * v.s, 0, 7);
      ctx.fillStyle = "#f4f7ff"; ctx.fill();

      ctx.textAlign = "center";
      ctx.font = "800 26px 'Courier New',monospace";
      const mine = init.seats.indexOf(net.id);
      const a = st.score[mine < 0 ? 0 : mine], b = st.score[mine === 1 ? 0 : 1];
      ctx.fillStyle = "#cfd8ea";
      ctx.fillText(`${a} — ${b}`, innerWidth / 2, 34);
      if (st.serving) {
        ctx.font = "700 15px system-ui,sans-serif";
        ctx.fillStyle = "#8b94b0";
        ctx.fillText("serving…", innerWidth / 2, 56);
      }
    }

    if (over) {
      ctx.fillStyle = "rgba(6,9,16,.85)";
      ctx.fillRect(0, 0, innerWidth, innerHeight);
      ctx.textAlign = "center";
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
      removeEventListener("resize", resize);
      canvas.removeEventListener("mousemove", mm);
    },
  };
};
