# Arcade

Twenty self-contained HTML5 games plus a neon hub page. No frameworks, no build
dependencies, no assets — every game is a single `.html` file with inline CSS and JS.

## Run it

```sh
python3 -m http.server 8742
# open http://localhost:8742/
```

(Any static server works; opening `index.html` directly from disk works too.)

- `index.html` — the hub. Game cards, per-game record pills, trophy wall, and
  save export/import.
- `arcade.html` — **generated** all-in-one bundle: the hub plus every game
  embedded in one file (game sources are gzipped at build time and inflated in
  the browser via `DecompressionStream`, so it needs a 2023+ browser). Never
  edit it by hand.

## Editing games

After editing any game, `shared.js`, or `index.html`, rerun the build and the
smoke test:

```sh
python3 build-arcade.py
# then open http://localhost:8742/smoke.html and wait for PASS
```

`smoke.html` boots every game from the hub's card list in sequence, injects an
error reporter ahead of each game's first script (so even a first-line throw is
caught and attributed), tickles keyboard/mouse input to run the start-screen
code paths, and renders a red/green board. `window.SMOKE` holds machine-readable
results (`{done, pass, results[]}`) for automation. Options: `?game=foo.html`
runs one file (carded or not — works for WIP games), `?secs=N` sets the
per-game time budget (default 3).

It also pumps each game's `requestAnimationFrame` callback by hand. A hidden
iframe throttles rAF to nothing, so without this a game whose render loop
throws every frame still looks clean — which is exactly how two shipped
render crashes went unnoticed. **Add a cache-busting param** (e.g.
`smoke.html?t=123`) after editing the harness; a stale cached copy will
happily report a green run.

The build:

1. Reads the game list from `index.html`'s cards (that is the single source of
   truth) and aborts if a card points at a missing file or a game file has no card.
2. Syncs `shared.js` into every game between the `<!-- arcade-shared:start/end -->`
   markers. Don't edit inside the markers — edit `shared.js`.
3. Regenerates `arcade.html`.

## Shared runtime (`shared.js`)

Injected into every game as `window.arcade`:

- `arcade.store` — `get/set/remove/num/json` localStorage helpers that never throw
  (Safari private mode, disabled storage).
- Audio auto-suspend: every `AudioContext` a game creates is suspended while the
  tab is hidden and resumed when it is visible again.
- `prefers-reduced-motion`: decorative CSS animation is collapsed; games can check
  `arcade.reducedMotion()` for canvas effects.
- `arcade.clampDt(dt, max)` — clamp a rAF delta after a background-tab gap.

## Adding a game

1. Create `my-game.html` (copy an existing game for the house style).
2. Add a card for it in `index.html`'s grid **and** an entry in the `GAMES`
   manifest in the hub's script (slug, localStorage keys, record reader, trophy).
   The manifest drives the record pills, the trophy wall, and the export/import
   key allowlist.
3. Run `python3 build-arcade.py` — it will refuse to build until card and file agree.

### Conventions

- localStorage keys: prefix with a short game slug (`mc_`, `ski_`, …) and suffix
  versioned saves with `_v1`. Use `arcade.store`, not raw `localStorage`.
- Volume is shared across games under the `arcade_volume` key.
- Each game renders crisply on HiDPI displays (devicePixelRatio-scaled backing
  store, capped at 2×). Exception: `raycaster.html` renders at 320×200 by
  default on purpose — its per-column renderer pays per pixel. Press `G`
  in-game to cycle 320×200 / 480×300 / 640×400 (persisted).
- Keep a `.hub-link` back-to-arcade link in each game; the bundle hides it and
  draws its own close chip.

## Notes

- `LUMO-SPRINTS.md` documents Lumo, a Three.js game kept outside this arcade
  (`~/Documents/lumo-wilds.html`). It is intentionally not in the hub.
