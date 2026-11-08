/* Battleship client — placement phase, then dual grids.
   The enemy grid only ever shows what the server has revealed. */
window.MPGAMES = window.MPGAMES || {};
window.MPGAMES.battleship2 = function (canvas, net, init) {
  "use strict";
  const ctx = canvas.getContext("2d");
  const DPR = Math.min(window.devicePixelRatio || 1, 2);
  const N = init.size, FLEET = init.fleet;

  let st = null;
  let place = { i: 0, horiz: true, ships: [], hover: null };
  let raf = 0, running = true, t = 0, msg = "";

  function resize() {
    canvas.width = Math.round(innerWidth * DPR);
    canvas.height = Math.round(innerHeight * DPR);
    canvas.style.width = innerWidth + "px";
    canvas.style.height = innerHeight + "px";
  }
  resize();
  addEventListener("resize", resize);

  const placing = () => !st || st.phase === "place";
  const myTurn = () => st && st.phase === "battle" && st.seats[st.turn] === net.id;

  function geom() {
    const stacked = innerWidth < 760;
    const pad = 16;
    const cell = stacked
      ? Math.min((innerWidth - pad * 2) / N, (innerHeight - 220) / (N * 2))
      : Math.min((innerWidth - pad * 3) / (N * 2), (innerHeight - 170) / N);
    const bw = cell * N;
    if (stacked) {
      const totalH = bw * 2 + 54;
      const y0 = (innerHeight - totalH) / 2 + 20;
      return { stacked, cell, bw, foe: { x: (innerWidth - bw) / 2, y: y0 },
               mine: { x: (innerWidth - bw) / 2, y: y0 + bw + 54 } };
    }
    const y0 = (innerHeight - bw) / 2 + 16;
    const gap = pad;
    const totalW = bw * 2 + gap;
    const x0 = (innerWidth - totalW) / 2;
    return { stacked, cell, bw, foe: { x: x0, y: y0 }, mine: { x: x0 + bw + gap, y: y0 } };
  }

  function cellAt(px, py, origin) {
    const g = geom();
    const x = Math.floor((px - origin.x) / g.cell), y = Math.floor((py - origin.y) / g.cell);
    return (x >= 0 && x < N && y >= 0 && y < N) ? { x, y } : null;
  }

  function currentShipCells(x, y) {
    const len = FLEET[place.i] ? FLEET[place.i].len : 0;
    const out = [];
    for (let i = 0; i < len; i++) out.push(place.horiz ? { x: x + i, y } : { x, y: y + i });
    return out;
  }
  function placementOK(cells) {
    const taken = new Set();
    place.ships.forEach((s, si) => {
      const l = FLEET[si].len;
      for (let i = 0; i < l; i++) taken.add(s.horiz ? `${s.x + i},${s.y}` : `${s.x},${s.y + i}`);
    });
    return cells.every((c) => c.x >= 0 && c.x < N && c.y >= 0 && c.y < N && !taken.has(`${c.x},${c.y}`));
  }

  const onMove = (e) => {
    const g = geom();
    place.hover = placing() ? cellAt(e.clientX, e.clientY, g.mine) : cellAt(e.clientX, e.clientY, g.foe);
  };
  const onClick = (e) => {
    const g = geom();
    if (placing()) {
      if (place.i >= FLEET.length) return;
      const c = cellAt(e.clientX, e.clientY, g.mine);
      if (!c) return;
      const cells = currentShipCells(c.x, c.y);
      if (!placementOK(cells)) { msg = "that ship will not fit there"; return; }
      place.ships.push({ x: c.x, y: c.y, horiz: place.horiz });
      place.i++;
      msg = "";
      if (place.i >= FLEET.length) net.move({ place: place.ships });
      return;
    }
    if (!myTurn()) return;
    const c = cellAt(e.clientX, e.clientY, g.foe);
    if (c && st.foe.hits[c.y][c.x] === -1) net.move({ x: c.x, y: c.y });
  };
  const onKey = (e) => {
    if (e.key.toLowerCase() === "r" && placing()) place.horiz = !place.horiz;
  };
  canvas.addEventListener("mousemove", onMove);
  canvas.addEventListener("click", onClick);
  addEventListener("keydown", onKey);
  canvas.addEventListener("touchend", (e) => {
    const tc = e.changedTouches[0];
    if (tc) onClick({ clientX: tc.clientX, clientY: tc.clientY });
  });

  function grid(origin, cell, label) {
    ctx.fillStyle = "#0b1020";
    ctx.fillRect(origin.x, origin.y, cell * N, cell * N);
    ctx.strokeStyle = "rgba(140,160,210,.2)";
    ctx.lineWidth = 1;
    for (let i = 0; i <= N; i++) {
      ctx.beginPath();
      ctx.moveTo(origin.x + i * cell, origin.y); ctx.lineTo(origin.x + i * cell, origin.y + cell * N);
      ctx.moveTo(origin.x, origin.y + i * cell); ctx.lineTo(origin.x + cell * N, origin.y + i * cell);
      ctx.stroke();
    }
    ctx.fillStyle = "#8b94b0";
    ctx.font = "700 12px system-ui,sans-serif";
    ctx.textAlign = "left";
    ctx.fillText(label, origin.x, origin.y - 8);
  }

  function draw() {
    t += 0.04;
    const g = geom();
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.fillStyle = "#070a12";
    ctx.fillRect(0, 0, innerWidth, innerHeight);

    // ---- enemy waters ----
    grid(g.foe, g.cell, "ENEMY WATERS");
    if (st && st.foe && st.foe.hits) {
      for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
        const v = st.foe.hits[y][x];
        if (v === -1) continue;
        const cx = g.foe.x + x * g.cell + g.cell / 2, cy = g.foe.y + y * g.cell + g.cell / 2;
        if (v === 1) {
          ctx.fillStyle = "#ff5c6e";
          ctx.beginPath(); ctx.arc(cx, cy, g.cell * 0.3, 0, 7); ctx.fill();
        } else {
          ctx.strokeStyle = "rgba(160,180,220,.55)"; ctx.lineWidth = 2;
          ctx.beginPath(); ctx.arc(cx, cy, g.cell * 0.17, 0, 7); ctx.stroke();
        }
      }
      (st.foe.sunk || []).forEach((s) => {
        ctx.strokeStyle = "#ff5c6e"; ctx.lineWidth = 3;
        s.cells.forEach((c) => ctx.strokeRect(g.foe.x + c.x * g.cell + 2, g.foe.y + c.y * g.cell + 2,
                                              g.cell - 4, g.cell - 4));
      });
      if (myTurn() && place.hover && st.foe.hits[place.hover.y][place.hover.x] === -1) {
        ctx.fillStyle = `rgba(92,225,255,${0.2 + Math.sin(t * 4) * 0.1})`;
        ctx.fillRect(g.foe.x + place.hover.x * g.cell, g.foe.y + place.hover.y * g.cell, g.cell, g.cell);
      }
    }

    // ---- my fleet ----
    grid(g.mine, g.cell, "YOUR FLEET");
    const myShips = st && st.you ? st.you.ships : null;
    if (myShips) {
      myShips.forEach((s) => {
        ctx.fillStyle = s.sunk ? "rgba(255,92,110,.45)" : "rgba(140,170,220,.55)";
        s.cells.forEach((c) => ctx.fillRect(g.mine.x + c.x * g.cell + 1, g.mine.y + c.y * g.cell + 1,
                                            g.cell - 2, g.cell - 2));
      });
      if (st.you.shots) {
        for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
          if (!st.you.shots[y][x]) continue;
          const onShip = myShips.some((s) => s.cells.some((c) => c.x === x && c.y === y));
          const cx = g.mine.x + x * g.cell + g.cell / 2, cy = g.mine.y + y * g.cell + g.cell / 2;
          if (onShip) { ctx.fillStyle = "#ff5c6e"; ctx.beginPath(); ctx.arc(cx, cy, g.cell * 0.28, 0, 7); ctx.fill(); }
          else { ctx.strokeStyle = "rgba(160,180,220,.5)"; ctx.lineWidth = 2;
                 ctx.beginPath(); ctx.arc(cx, cy, g.cell * 0.15, 0, 7); ctx.stroke(); }
        }
      }
    } else if (placing()) {
      // ships committed locally but not yet sent
      place.ships.forEach((s, si) => {
        const l = FLEET[si].len;
        ctx.fillStyle = "rgba(140,170,220,.5)";
        for (let i = 0; i < l; i++) {
          const cx = s.horiz ? s.x + i : s.x, cy = s.horiz ? s.y : s.y + i;
          ctx.fillRect(g.mine.x + cx * g.cell + 1, g.mine.y + cy * g.cell + 1, g.cell - 2, g.cell - 2);
        }
      });
      if (place.hover && place.i < FLEET.length) {
        const cells = currentShipCells(place.hover.x, place.hover.y);
        ctx.fillStyle = placementOK(cells) ? "rgba(92,225,255,.45)" : "rgba(255,92,110,.45)";
        cells.forEach((c) => {
          if (c.x < N && c.y < N) {
            ctx.fillRect(g.mine.x + c.x * g.cell + 1, g.mine.y + c.y * g.cell + 1, g.cell - 2, g.cell - 2);
          }
        });
      }
    }

    // ---- status ----
    ctx.textAlign = "center";
    ctx.font = "700 17px system-ui,sans-serif";
    let s1, col;
    if (st && st.winner !== null && st.winner !== undefined) {
      const win = st.winner === net.id;
      s1 = win ? "Victory — their fleet is sunk" : `${st.names[st.winner] || "Opponent"} wins`;
      col = win ? "#7df29b" : "#ff6b8a";
    } else if (placing()) {
      s1 = place.i < FLEET.length
        ? `Place your ${FLEET[place.i].name} (${FLEET[place.i].len}) — R to rotate`
        : "Fleet deployed — waiting for your opponent";
      col = "#5ce1ff";
    } else if (st && st.spectator) { s1 = "Spectating"; col = "#8b94b0"; }
    else { s1 = myTurn() ? "Your shot" : "Incoming…"; col = myTurn() ? "#5ce1ff" : "#8b94b0"; }
    ctx.fillStyle = col;
    ctx.fillText(s1, innerWidth / 2, 28);

    if (msg) {
      ctx.fillStyle = "#ff6b8a";
      ctx.font = "600 13px system-ui,sans-serif";
      ctx.fillText(msg, innerWidth / 2, 50);
    }
    if (st && st.log && st.log.length && !placing()) {
      ctx.font = "600 12px system-ui,sans-serif";
      ctx.fillStyle = "#55607a";
      const last = st.log[st.log.length - 1];
      const who = last.by === net.id ? "You" : (st.names[last.by] || "They");
      const cols = "ABCDEFGHIJ"[last.x] + (last.y + 1);
      ctx.fillText(`${who} fired at ${cols} — ${last.sunk ? "SUNK the " + last.sunk : last.hit ? "hit" : "miss"}`,
                   innerWidth / 2, innerHeight - 54);
    }
  }

  function frame() { if (!running) return; draw(); raf = requestAnimationFrame(frame); }
  raf = requestAnimationFrame(frame);

  return {
    onState(s) { st = s; if (s && s.phase !== "place") msg = ""; },
    onOver(m) { if (m.result && st) st.winner = m.result.winner; },
    teardown() {
      running = false;
      cancelAnimationFrame(raf);
      removeEventListener("resize", resize);
      removeEventListener("keydown", onKey);
      canvas.removeEventListener("mousemove", onMove);
      canvas.removeEventListener("click", onClick);
    },
  };
};
