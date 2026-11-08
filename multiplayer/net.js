/* Client netcode shared by every multiplayer game.

   Responsibilities: one reconnecting socket, room state, latency probe, and a
   tiny event bus. Games subscribe to what they need and never touch the
   socket directly. */
(function () {
  "use strict";

  function wsURL() {
    const proto = location.protocol === "https:" ? "wss:" : "ws:";
    return `${proto}//${location.host}/ws`;
  }

  const listeners = {};
  function on(type, fn) { (listeners[type] || (listeners[type] = [])).push(fn); return net; }
  function emit(type, payload) { (listeners[type] || []).forEach((f) => { try { f(payload); } catch (e) { console.error(e); } }); }

  let ws = null, retry = 0, closedByUs = false;

  const net = {
    id: null,
    name: localStorage.getItem("mp_name") || "",
    room: null,
    games: [],
    ping: 0,
    connected: false,
    on,

    connect() {
      closedByUs = false;
      ws = new WebSocket(wsURL());
      ws.onopen = () => {
        retry = 0;
        net.connected = true;
        // try to reclaim our seat before doing anything else; the server holds
        // it for ~45s so a wifi blip doesn't cost you the room
        const tok = sessionStorage.getItem("mp_token");
        if (tok) net.send({ t: "resume", token: tok });
        else net.send({ t: "resume", token: "" });
        if (net.name) net.send({ t: "name", name: net.name });
        emit("open");
      };
      ws.onclose = () => {
        net.connected = false;
        emit("close");
        if (closedByUs) return;
        retry = Math.min(retry + 1, 6);
        setTimeout(() => net.connect(), 400 * retry);   // backoff, caps at ~2.4s
      };
      ws.onerror = () => { /* onclose follows */ };
      ws.onmessage = (e) => {
        let m;
        try { m = JSON.parse(e.data); } catch (err) { return; }
        switch (m.t) {
          case "welcome":
            net.id = m.id;
            net.games = m.games;
            if (m.token) sessionStorage.setItem("mp_token", m.token);
            net.resumed = !!m.resumed;
            emit("ready", m);
            break;
          case "room":    net.room = m; emit("room", m); break;
          case "left":    net.room = null; emit("room", null); break;
          case "pong":    net.ping = Math.round(performance.now() - m.ts); break;
          default: break;
        }
        emit(m.t, m);
      };
      return net;
    },

    send(obj) {
      if (ws && ws.readyState === 1) { ws.send(JSON.stringify(obj)); return true; }
      return false;
    },

    setName(n) {
      net.name = String(n || "").slice(0, 16);
      localStorage.setItem("mp_name", net.name);
      net.send({ t: "name", name: net.name });
    },

    create(game, max) { net.send({ t: "create", game, max }); },
    join(code)        { net.send({ t: "join", code: String(code).toUpperCase() }); },
    leave()           { net.send({ t: "leave" }); },
    start()           { net.send({ t: "start" }); },
    move(d)           { net.send({ t: "move", d }); },
    input(d)          { net.send({ t: "input", d }); },
    listRooms()       { net.send({ t: "rooms" }); },
    queue(game)       { net.send({ t: "queue", game: game || "any" }); },
    unqueue()         { net.send({ t: "unqueue" }); },
    disconnect()      { closedByUs = true; if (ws) ws.close(); },
    forget()          { sessionStorage.removeItem("mp_token"); },
  };

  setInterval(() => { if (net.connected) net.send({ t: "ping", ts: performance.now() }); }, 2000);

  window.net = net;
})();
