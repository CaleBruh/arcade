#!/usr/bin/env python3
"""Sync the shared runtime into every game and bundle everything into arcade.html.

Rerun this after editing any game or shared.js:  python3 build-arcade.py

What it does:
  1. Reads the game list straight from index.html's cards (single source of truth).
  2. Validates the list: every card's file must exist on disk, every game file on
     disk must have a card. A mismatch aborts the build.
  3. Injects/refreshes shared.js into each game between the arcade-shared markers.
  4. Writes arcade.html, a single self-contained file embedding the hub + all games.

All string replacements are checked: a pattern that no longer matches the source
aborts the build instead of silently producing a wrong bundle.
"""
import base64
import gzip
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).parent

# where the parent back-button goes while each game is open (clear of its HUD)
CHIP_POS = {
    "missile-command.html": "top:64px;left:12px",
    "neon-swarm.html": "top:12px;left:50%;transform:translateX(-50%)",
    "rhythm-jumper.html": "bottom:14px;left:14px",
    "platformer.html": "bottom:14px;left:14px",
    "racer.html": "bottom:14px;left:14px",
    "solitaire.html": "bottom:14px;left:14px",
    "lunar-lander.html": "bottom:14px;left:14px",
    "horde.html": "bottom:14px;left:14px",
    "ski.html": "bottom:14px;left:14px",
    "artillery.html": "top:64px;left:12px",
    "atc.html": "bottom:14px;left:14px",
    "deckbuilder.html": "bottom:14px;left:14px",
    "miner.html": "top:12px;left:50%;transform:translateX(-50%)",
    "slingshot-physics.html": "bottom:14px;left:14px",   # HUD owns the top-left
    "farm-sim.html": "bottom:14px;left:14px",            # title owns the top-left
}
DEFAULT_POS = "top:12px;left:14px"

SHARED_START = "<!-- arcade-shared:start -->"
SHARED_END = "<!-- arcade-shared:end -->"


def fail(msg: str):
    sys.exit(f"build-arcade: ERROR: {msg}")


def checked_replace(text: str, old: str, new: str, where: str) -> str:
    """Replace exactly one occurrence; abort if the pattern has drifted."""
    n = text.count(old)
    if n != 1:
        fail(f"expected exactly 1 occurrence of {old!r} in {where}, found {n}")
    return text.replace(old, new)


# ---- 1. game list comes from the hub's cards --------------------------------
hub = (ROOT / "index.html").read_text(encoding="utf-8")
games = re.findall(r'<a class="card" href="([^"#]+\.html)"', hub)
if not games:
    fail("no game cards found in index.html")

# ---- 2. validate cards vs disk ----------------------------------------------
# non-game pages: the hub, the generated bundle, and the smoke-test harness
on_disk = {p.name for p in ROOT.glob("*.html")} - {"index.html", "arcade.html", "smoke.html"}
missing = [g for g in games if g not in on_disk]
uncarded = sorted(on_disk - set(games))
if missing:
    fail(f"index.html links games that do not exist on disk: {missing}")
if uncarded:
    fail(f"game files on disk with no card in index.html: {uncarded}")
if len(set(games)) != len(games):
    fail("duplicate card hrefs in index.html")

# ---- 3. inject/refresh the shared runtime in every game ---------------------
shared_js = (ROOT / "shared.js").read_text(encoding="utf-8")
shared_block = f"{SHARED_START}\n<script>\n{shared_js}</script>\n{SHARED_END}"
marker_re = re.compile(re.escape(SHARED_START) + r".*?" + re.escape(SHARED_END), re.S)

synced = 0
for name in games:
    path = ROOT / name
    src = path.read_text(encoding="utf-8")
    if SHARED_START in src:
        updated = marker_re.sub(lambda _: shared_block, src)
    else:
        # before the game's own first script so the AudioContext wrap sees it
        idx = src.find("<script")
        if idx == -1:
            fail(f"{name}: no <script> tag to anchor the shared runtime")
        updated = src[:idx] + shared_block + "\n" + src[idx:]
    if updated != src:
        path.write_text(updated, encoding="utf-8")
        synced += 1
print(f"shared runtime synced into {synced} game(s)")

# ---- 4. build the all-in-one bundle ------------------------------------------
# cards open the in-page overlay instead of navigating
bundle_hub, n = re.subn(r'<a class="card" href="([^"]+)"',
                        r'<a class="card" href="#" data-src="\1"', hub)
if n != len(games):
    fail(f"rewrote {n} card hrefs, expected {len(games)}")
bundle_hub = checked_replace(bundle_hub, "<title>Arcade — Game Hub</title>",
                             "<title>Arcade — All-In-One</title>", "index.html")
bundle_hub = checked_replace(bundle_hub, "one folder", "one file", "index.html")
bundle_hub = checked_replace(
    bundle_hub,
    "CLICK A CARD TO PLAY &middot; YOUR BROWSER'S BACK BUTTON RETURNS HERE",
    "CLICK A CARD TO PLAY &middot; EVERYTHING LIVES IN THIS ONE FILE",
    "index.html")

sources = {}
for name in games:
    src = (ROOT / name).read_text(encoding="utf-8")
    # hide the game's own back link; the bundle draws its own close chip
    src = checked_replace(src, "</body>",
                          "<style>.hub-link{display:none}</style></body>", name)
    sources[name] = src

# JSON-encode, then gzip+base64 the payload: the sources are ~1.8 MB of
# repetitive HTML and compress ~4:1 even after the base64 tax. Base64 contains
# no "<", so no </script> escaping is needed.
payload = json.dumps({"sources": sources, "chipPos": CHIP_POS}, ensure_ascii=False)
payload_b64 = base64.b64encode(gzip.compress(payload.encode("utf-8"), 9)).decode("ascii")

overlay = """
<div id="game-overlay" style="display:none;position:fixed;inset:0;z-index:20000;background:#000">
  <iframe id="game-frame" style="width:100%;height:100%;border:0;display:block"></iframe>
  <a href="#" id="overlay-close" class="chip">&lt; ARCADE</a>
</div>
<style>
#game-overlay .chip{position:fixed;z-index:20001;font:700 11px/1 "Courier New",monospace;
letter-spacing:2px;color:#cfd8ea;background:rgba(10,12,20,.72);
border:1px solid rgba(140,160,210,.4);padding:8px 12px;border-radius:999px;
text-decoration:none;opacity:.55;transition:opacity .15s;cursor:pointer;}
#game-overlay .chip:hover{opacity:1;color:#fff;}
</style>
<script id="game-data" type="application/gzip-base64">__PAYLOAD__</script>
<script>
(function () {
  "use strict";
  var data = null;
  var dataReady = (function () {
    if (typeof DecompressionStream === "undefined")
      return Promise.reject(new Error("this browser is missing DecompressionStream (needs a 2023+ browser)"));
    var b64 = document.getElementById("game-data").textContent.trim();
    var bytes = Uint8Array.from(atob(b64), function (c) { return c.charCodeAt(0); });
    var stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
    return new Response(stream).text().then(function (t) { data = JSON.parse(t); });
  })();
  var overlay = document.getElementById("game-overlay");
  var frame = document.getElementById("game-frame");
  var chip = document.getElementById("overlay-close");
  var DEFAULT_POS = "__DEFAULT_POS__";

  function openGame(src) {
    if (!data) {
      dataReady.then(function () { openGame(src); },
                     function (e) { alert("Cannot unpack the bundle: " + e.message); });
      return;
    }
    if (!data.sources[src]) { alert("Game not bundled: " + src); return; }
    chip.setAttribute("style", data.chipPos[src] || DEFAULT_POS);
    frame.dataset.arcadeGame = src;   // identifies the game to the shared runtime's heartbeat
    frame.srcdoc = data.sources[src];
    overlay.style.display = "block";
    frame.addEventListener("load", function () { try { frame.contentWindow.focus(); } catch (e) {} }, { once: true });
  }
  function closeGame() {
    overlay.style.display = "none";
    frame.srcdoc = "";
    if (window.arcadeRefresh) window.arcadeRefresh();
  }

  document.querySelectorAll("a.card[data-src]").forEach(function (card) {
    card.addEventListener("click", function (e) {
      e.preventDefault();
      openGame(card.dataset.src);
    });
  });
  chip.addEventListener("click", function (e) { e.preventDefault(); closeGame(); });
})();
</script>
</body>"""

overlay = overlay.replace("__PAYLOAD__", payload_b64).replace("__DEFAULT_POS__", DEFAULT_POS)
bundle = checked_replace(bundle_hub, "</body>", overlay, "index.html (bundle tail)")

out = ROOT / "arcade.html"
out.write_text(bundle, encoding="utf-8")
print(f"wrote {out.name} ({out.stat().st_size // 1024} KB, {len(games)} games)")
