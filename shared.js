/* Arcade shared runtime.
   Single source of truth for cross-game boilerplate. build-arcade.py injects
   this into every game between the arcade-shared markers (and keeps the copies
   in sync on each run) — edit THIS file, then run: python3 build-arcade.py */
(function () {
  "use strict";

  /* ---- safe storage: never throws (Safari private mode, disabled storage) ---- */
  var store = {
    get: function (k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set: function (k, v) { try { localStorage.setItem(k, String(v)); return true; } catch (e) { return false; } },
    remove: function (k) { try { localStorage.removeItem(k); } catch (e) {} },
    num: function (k) { var n = parseFloat(store.get(k)); return isFinite(n) ? n : 0; },
    json: function (k) { try { return JSON.parse(store.get(k)); } catch (e) { return null; } }
  };

  /* ---- audio: one wrap of the AudioContext constructor gives us both
     a tab-hidden auto-suspend and an arcade-wide master volume ----
     Every context's .destination is rerouted through a shared gain node, so
     the settings panel's master volume applies to every game with no per-game
     wiring; the games' own volume sliders keep working underneath it.
     Only contexts *we* suspended are resumed, so a game's own
     mute-by-suspend behaviour is left alone. */
  var contexts = [];
  var autoSuspended = [];
  var masters = [];
  function masterLevel() {
    if (store.get("arcade_master_muted") === "1") return 0;
    var v = parseFloat(store.get("arcade_master"));
    return isFinite(v) ? Math.min(Math.max(v, 0), 1) : 1;
  }
  function applyMaster() {
    var lvl = masterLevel();
    masters.forEach(function (g) {
      try { g.gain.setTargetAtTime(lvl, g.context.currentTime, 0.02); } catch (e) {}
    });
  }
  ["AudioContext", "webkitAudioContext"].forEach(function (name) {
    var Orig = window[name];
    if (!Orig) return;
    function Patched() {
      var ctx = arguments.length
        ? new (Function.prototype.bind.apply(Orig, [null].concat([].slice.call(arguments))))()
        : new Orig();
      contexts.push(ctx);
      try {
        var realDest = ctx.destination;
        var master = ctx.createGain();
        master.gain.value = masterLevel();
        master.connect(realDest);
        Object.defineProperty(ctx, "destination", {
          get: function () { return master; },
          configurable: true
        });
        masters.push(master);
      } catch (e) { /* master volume is best-effort */ }
      return ctx;
    }
    Patched.prototype = Orig.prototype;
    window[name] = Patched;
  });
  document.addEventListener("visibilitychange", function () {
    if (document.hidden) {
      contexts.forEach(function (ctx) {
        if (ctx.state === "running") {
          autoSuspended.push(ctx);
          ctx.suspend().catch(function () {});
        }
      });
    } else {
      autoSuspended.splice(0).forEach(function (ctx) {
        if (ctx.state === "suspended") ctx.resume().catch(function () {});
      });
    }
  });

  /* ---- reduced motion: tame decorative CSS animation, expose a flag the
     games consult for canvas effects (shake, flashes, particles). The OS
     setting is the default; the settings panel can override it either way
     (arcade_rm: "auto" | "on" | "off"). ---- */
  var rmQuery = window.matchMedia ? matchMedia("(prefers-reduced-motion: reduce)") : null;
  function reducedMotion() {
    var o = store.get("arcade_rm");
    if (o === "on") return true;
    if (o === "off") return false;
    return !!(rmQuery && rmQuery.matches);
  }
  var rmStyle = document.createElement("style");
  (document.head || document.documentElement).appendChild(rmStyle);
  function syncRMStyle() {
    rmStyle.textContent = reducedMotion()
      ? "*,*::before,*::after{animation-duration:.01ms !important;" +
        "animation-iteration-count:1 !important;transition-duration:.01ms !important;" +
        "scroll-behavior:auto !important}"
      : "";
  }
  syncRMStyle();
  if (rmQuery && rmQuery.addEventListener) rmQuery.addEventListener("change", syncRMStyle);

  /* ---- on-screen touch controls ----
     Created on demand by a game calling arcade.touch.* at the end of its own
     script. Nothing is shown unless the pointer is coarse (or ?touch=1 forces
     them for testing). Key buttons synthesize keydown/keyup on window+document
     with both .key and .code set, so games keep their existing handlers. */
  var touchOn = (window.matchMedia && matchMedia("(pointer: coarse)").matches) ||
                /[?&]touch=1\b/.test(location.search);
  var touchLayer = null;
  function ensureLayer() {
    if (!touchLayer) {
      touchLayer = document.createElement("div");
      touchLayer.id = "arcade-touch";
      touchLayer.style.cssText =
        "position:fixed;inset:0;z-index:15000;pointer-events:none;" +
        "user-select:none;-webkit-user-select:none";
      (document.body || document.documentElement).appendChild(touchLayer);
    }
    return touchLayer;
  }
  function mkEl(style, size) {
    var el = document.createElement("div");
    el.style.cssText =
      "position:absolute;pointer-events:auto;touch-action:none;box-sizing:border-box;" +
      "width:" + size + "px;height:" + size + "px;border-radius:50%;" +
      "background:rgba(140,160,210,.13);border:1px solid rgba(140,160,210,.45);" +
      "color:rgba(232,236,248,.85);display:flex;align-items:center;justify-content:center;" +
      "font:700 13px/1 system-ui,sans-serif;letter-spacing:1px;" + (style || "");
    return el;
  }
  function sendKey(type, key, code) {
    var ev = new KeyboardEvent(type, { key: key, code: code, bubbles: true, cancelable: true });
    window.dispatchEvent(ev);
    document.dispatchEvent(ev);
  }
  function touchButton(o) {
    if (!touchOn) return null;
    var el = mkEl(o.style, o.size || 54);
    el.textContent = o.label || "";
    if (o.label) el.dataset.k = o.label;
    var timer = 0;
    function down(e) {
      e.preventDefault();
      try { el.setPointerCapture(e.pointerId); } catch (err) {}
      el.style.background = "rgba(140,160,210,.34)";
      if (o.onDown) o.onDown();
      if (o.repeat) timer = setInterval(function () { if (o.onDown) o.onDown(); }, o.repeat);
    }
    function up() {
      el.style.background = "rgba(140,160,210,.13)";
      if (timer) { clearInterval(timer); timer = 0; }
      if (o.onUp) o.onUp();
    }
    el.addEventListener("pointerdown", down);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
    ensureLayer().appendChild(el);
    return el;
  }
  function keyButton(o) {
    var held = false;
    return touchButton({
      label: o.label, style: o.style, size: o.size, repeat: o.repeat,
      onDown: function () { held = true; sendKey("keydown", o.key, o.code || o.key); },
      onUp: function () { if (held) { held = false; sendKey("keyup", o.key, o.code || o.key); } }
    });
  }
  function dpad(o) {
    if (!touchOn) return;
    var s = o.size || 52, g = o.gap || 6;
    var bx = o.left != null ? o.left : 16, by = o.bottom != null ? o.bottom : 16;
    function at(cx, cy) { return "left:" + cx + "px;bottom:" + cy + "px"; }
    var m = o.map;
    keyButton({ label: "▲", key: m.up.key, code: m.up.code, size: s, repeat: o.repeat, style: at(bx + s + g, by + 2 * (s + g)) });
    keyButton({ label: "◀", key: m.left.key, code: m.left.code, size: s, repeat: o.repeat, style: at(bx, by + s + g) });
    keyButton({ label: "▶", key: m.right.key, code: m.right.code, size: s, repeat: o.repeat, style: at(bx + 2 * (s + g), by + s + g) });
    keyButton({ label: "▼", key: m.down.key, code: m.down.code, size: s, repeat: o.repeat, style: at(bx + s + g, by) });
  }
  function arrowDpad(o) {
    o = o || {};
    o.map = {
      up: { key: "ArrowUp", code: "ArrowUp" }, down: { key: "ArrowDown", code: "ArrowDown" },
      left: { key: "ArrowLeft", code: "ArrowLeft" }, right: { key: "ArrowRight", code: "ArrowRight" }
    };
    return dpad(o);
  }
  function stick(o) {
    if (!touchOn) return null;
    var size = o.size || 124;
    var base = mkEl(o.style, size);
    if (o.label) base.dataset.k = o.label;
    var knob = document.createElement("div");
    knob.style.cssText =
      "position:absolute;width:44%;height:44%;border-radius:50%;pointer-events:none;" +
      "background:rgba(140,160,210,.4);left:50%;top:50%;transform:translate(-50%,-50%)";
    base.appendChild(knob);
    var active = false;
    function setKnob(nx, ny) {
      knob.style.left = (50 + nx * 32) + "%";
      knob.style.top = (50 + ny * 32) + "%";
    }
    function report(e) {
      var r = base.getBoundingClientRect();
      var dx = (e.clientX - (r.left + r.width / 2)) / (r.width / 2);
      var dy = (e.clientY - (r.top + r.height / 2)) / (r.height / 2);
      var mag = Math.hypot(dx, dy);
      if (mag > 1) { dx /= mag; dy /= mag; }
      setKnob(dx, dy);
      if (o.onMove) o.onMove(dx, dy, true);
    }
    base.addEventListener("pointerdown", function (e) {
      e.preventDefault();
      try { base.setPointerCapture(e.pointerId); } catch (err) {}
      active = true;
      report(e);
    });
    base.addEventListener("pointermove", function (e) { if (active) report(e); });
    function end() {
      if (!active) return;
      active = false;
      setKnob(0, 0);
      if (o.onMove) o.onMove(0, 0, false);
    }
    base.addEventListener("pointerup", end);
    base.addEventListener("pointercancel", end);
    ensureLayer().appendChild(base);
    return base;
  }

  /* ---- play-time heartbeat: the hub sorts and labels cards from this ----
     Standalone pages identify themselves by filename; inside the all-in-one
     bundle the overlay stamps data-arcade-game on the iframe. The smoke
     harness's srcdoc frames carry no stamp, so test runs never pollute it. */
  var GAME_ID = (function () {
    try {
      if (window.frameElement && window.frameElement.dataset.arcadeGame)
        return window.frameElement.dataset.arcadeGame;
      if (window.frameElement) return null; /* unstamped frame (smoke harness) */
    } catch (e) { return null; }
    var p = location.pathname.split("/").pop();
    return /\.html$/.test(p) && ["index.html", "arcade.html", "smoke.html"].indexOf(p) === -1 ? p : null;
  })();
  if (GAME_ID) {
    var visSince = document.hidden ? 0 : Date.now();
    var metaFlush = function () {
      var add = 0, now = Date.now();
      if (visSince) { add = (now - visSince) / 1000; visSince = document.hidden ? 0 : now; }
      else if (add === 0) return; /* hidden and idle: not "playing" */
      var meta = store.json("arcade_meta_v1") || {};
      var g = meta[GAME_ID] || (meta[GAME_ID] = { secs: 0 });
      g.secs = Math.round((g.secs || 0) + add);
      g.last = now;
      store.set("arcade_meta_v1", JSON.stringify(meta));
    };
    metaFlush();
    setInterval(metaFlush, 15000);
    document.addEventListener("visibilitychange", function () {
      if (document.hidden) { metaFlush(); visSince = 0; }
      else visSince = Date.now();
    });
    window.addEventListener("pagehide", metaFlush);
  }

  /* ---- settings panel: gear chip on the right edge; Escape closes.
     Master volume and motion apply to every game through the shared
     runtime, so this is the same panel with the same behaviour everywhere. */
  var panel = null, chip = null;
  function settingsOpen() { return !!(panel && panel.style.display !== "none"); }
  function motionLabel() {
    var o = store.get("arcade_rm");
    return o === "on" ? "MOTION: REDUCED" : o === "off" ? "MOTION: FULL" : "MOTION: AUTO";
  }
  function buildPanel() {
    if (panel) return;
    panel = document.createElement("div");
    panel.id = "arcade-settings";
    panel.style.cssText =
      "position:fixed;inset:0;z-index:16000;display:none;" +
      "background:rgba(4,6,12,.55);user-select:none;-webkit-user-select:none";
    var card = document.createElement("div");
    card.style.cssText =
      "position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);" +
      "min-width:260px;padding:22px 26px;border-radius:14px;" +
      "background:rgba(14,17,30,.96);border:1px solid rgba(140,160,210,.4);" +
      "color:#e8ecf8;font:13px/1.5 system-ui,sans-serif";
    card.innerHTML =
      '<div style="font:700 13px/1 system-ui;letter-spacing:3px;margin-bottom:16px">ARCADE SETTINGS</div>' +
      '<label style="font-size:11px;letter-spacing:2px;color:#8b94b0">MASTER VOLUME</label><br>' +
      '<input id="arc-set-vol" type="range" min="0" max="100" style="width:100%;margin:6px 0 14px">' +
      '<button id="arc-set-mute" style="' + btnCss() + '"></button> ' +
      '<button id="arc-set-rm" style="' + btnCss() + '"></button>' +
      '<div style="font-size:11px;color:#8b94b0;margin-top:14px">Applies to every game. ' +
      'Per-game volume controls still work underneath.<br>Esc closes.</div>';
    panel.appendChild(card);
    panel.addEventListener("pointerdown", function (e) { if (e.target === panel) toggleSettings(false); });
    (document.body || document.documentElement).appendChild(panel);

    var vol = card.querySelector("#arc-set-vol");
    var mute = card.querySelector("#arc-set-mute");
    var rm = card.querySelector("#arc-set-rm");
    function syncUI() {
      var v = parseFloat(store.get("arcade_master"));
      vol.value = Math.round((isFinite(v) ? Math.min(Math.max(v, 0), 1) : 1) * 100);
      mute.textContent = store.get("arcade_master_muted") === "1" ? "UNMUTE" : "MUTE";
      rm.textContent = motionLabel();
    }
    vol.addEventListener("input", function () {
      store.set("arcade_master", vol.value / 100);
      store.set("arcade_master_muted", "0");
      applyMaster(); syncUI();
    });
    mute.addEventListener("click", function () {
      store.set("arcade_master_muted", store.get("arcade_master_muted") === "1" ? "0" : "1");
      applyMaster(); syncUI();
    });
    rm.addEventListener("click", function () {
      var o = store.get("arcade_rm");
      store.set("arcade_rm", o === "on" ? "off" : o === "off" ? "auto" : "on");
      syncRMStyle(); syncUI();
    });
    panel.syncUI = syncUI;
  }
  function btnCss() {
    return "font:700 11px/1 system-ui;letter-spacing:2px;color:#cfd8ea;cursor:pointer;" +
      "background:rgba(140,160,210,.12);border:1px solid rgba(140,160,210,.4);" +
      "padding:8px 12px;border-radius:999px";
  }
  function toggleSettings(show) {
    buildPanel();
    var to = show != null ? show : !settingsOpen();
    panel.style.display = to ? "block" : "none";
    if (to) panel.syncUI();
  }
  function mountChip() {
    if (chip || !document.body) return;
    chip = document.createElement("div");
    chip.id = "arcade-settings-chip";
    chip.title = "Arcade settings";
    chip.textContent = "⚙";
    chip.style.cssText =
      "position:fixed;right:8px;top:50%;transform:translateY(-50%);z-index:15990;" +
      "width:30px;height:30px;border-radius:50%;display:flex;align-items:center;" +
      "justify-content:center;cursor:pointer;font-size:15px;color:#cfd8ea;" +
      "background:rgba(10,12,20,.6);border:1px solid rgba(140,160,210,.35);" +
      "opacity:.4;transition:opacity .15s;user-select:none;-webkit-user-select:none";
    chip.addEventListener("mouseenter", function () { chip.style.opacity = "1"; });
    chip.addEventListener("mouseleave", function () { chip.style.opacity = ".4"; });
    chip.addEventListener("click", function () { toggleSettings(); });
    document.body.appendChild(chip);
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mountChip);
  } else {
    mountChip();
  }
  /* capture-phase: while the panel is open, keys belong to the panel */
  window.addEventListener("keydown", function (e) {
    if (!settingsOpen()) return;
    if (e.key === "Escape") toggleSettings(false);
    e.stopImmediatePropagation();
    e.preventDefault();
  }, true);
  window.addEventListener("keyup", function (e) {
    if (settingsOpen()) e.stopImmediatePropagation();
  }, true);

  window.arcade = {
    store: store,
    reducedMotion: reducedMotion,
    settings: { open: function () { toggleSettings(true); }, close: function () { toggleSettings(false); } },
    /* clamp a rAF delta so a backgrounded tab doesn't produce a huge step */
    clampDt: function (dt, max) { return Math.min(Math.max(dt, 0), max || 0.1); },
    /* daily-challenge helpers: one date key and one seed, stable all day,
       shared by every game so "today's run" means the same thing everywhere */
    dailyKey: function () {
      var d = new Date(), m = d.getMonth() + 1, da = d.getDate();
      return d.getFullYear() + "-" + (m < 10 ? "0" : "") + m + "-" + (da < 10 ? "0" : "") + da;
    },
    dailySeed: function () {
      var d = new Date();
      return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
    },
    /* mulberry32: tiny deterministic PRNG for seeded runs */
    seededRand: function (seed) {
      var a = seed >>> 0;
      return function () {
        a = (a + 0x6D2B79F5) >>> 0;
        var t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
    },
    touch: {
      available: touchOn,
      sendKey: sendKey,
      button: touchButton,
      key: keyButton,
      dpad: dpad,
      arrowDpad: arrowDpad,
      stick: stick
    },
    /* Run recorder — shared by the ghost racer and replay trophies.

       A game calls start()/sample()/finish() and gets both a local ghost and,
       when the arcade server happens to be serving the page, a shared one.
       Every server call is best-effort: these games are static files that must
       keep working opened straight off the disk, so a failed fetch is silently
       ignored rather than surfaced. */
    run: (function () {
      var RATE_MS = 100;            // 10 Hz is plenty to interpolate a ghost
      var MAX_FRAMES = 4000;        // ~6.5 minutes; matches the server cap
      var cur = null;

      function localKey(game) { return 'arcade_ghost_' + game; }

      function post(path, body) {
        try {
          return fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' },
                               body: JSON.stringify(body) })
            .then(function (r) { return r.json(); })
            .catch(function () { return null; });
        } catch (e) { return Promise.resolve(null); }
      }

      return {
        start: function (game, seed) {
          cur = { game: game, seed: seed === undefined ? null : seed, frames: [], last: -1e9 };
        },
        /* Call every frame; it throttles itself. Pass the few numbers needed to
           redraw the ghost — position, lane, whatever the game interpolates. */
        sample: function (t) {
          if (!cur || cur.frames.length >= MAX_FRAMES) return;
          if (t - cur.last < RATE_MS / 1000) return;
          cur.last = t;
          cur.frames.push(Array.prototype.slice.call(arguments, 1).map(function (v) {
            return Math.round((Number(v) || 0) * 100) / 100;   // 2dp keeps ghosts small
          }));
        },
        recording: function () { return !!cur; },
        /* Keep the run if it beat the stored ghost, and offer it to the server. */
        finish: function (score, name) {
          if (!cur || !cur.frames.length) { cur = null; return Promise.resolve(null); }
          var ghost = { game: cur.game, seed: cur.seed, frames: cur.frames,
                        score: Number(score) || 0,
                        name: name || localStorage.getItem('arcade_name_v1') || 'player' };
          cur = null;
          try {
            var prevRaw = localStorage.getItem(localKey(ghost.game));
            var prev = prevRaw ? JSON.parse(prevRaw) : null;
            if (!prev || ghost.score > prev.score) {
              localStorage.setItem(localKey(ghost.game), JSON.stringify(ghost));
            }
          } catch (e) { /* quota or bad JSON — the server copy still matters */ }
          return post('/api/ghost', ghost);
        },
        discard: function () { cur = null; },
        /* Best available ghost: the server's if reachable, else the local one. */
        best: function (game) {
          var local = null;
          try {
            var raw = localStorage.getItem(localKey(game));
            if (raw) local = JSON.parse(raw);
          } catch (e) {}
          try {
            return fetch('/api/ghosts?game=' + encodeURIComponent(game))
              .then(function (r) { return r.json(); })
              .then(function (d) {
                var remote = d && d.list && d.list[0];
                if (remote && (!local || remote.score > local.score)) return remote;
                return local;
              })
              .catch(function () { return local; });
          } catch (e) { return Promise.resolve(local); }
        },
        /* Read a ghost at an arbitrary time, interpolating between samples. */
        at: function (ghost, t) {
          if (!ghost || !ghost.frames || !ghost.frames.length) return null;
          var f = ghost.frames, i = Math.floor(t / (RATE_MS / 1000));
          if (i >= f.length - 1) return f[f.length - 1];
          if (i < 0) return f[0];
          var a = f[i], b = f[i + 1], k = (t / (RATE_MS / 1000)) - i, out = [];
          for (var j = 0; j < a.length; j++) out.push(a[j] + (b[j] - a[j]) * k);
          return out;
        }
      };
    })()
  };
})();
