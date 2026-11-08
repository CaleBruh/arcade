# Arcade — Sprint Map

Twenty single-file games, a hub, a validating bundler (`build-arcade.py`), and a
shared runtime (`shared.js`) injected into every game. The foundation pass is
done: manifest-driven hub, scoped save export, HiDPI rendering, audio suspend on
hidden, git. This map is what comes next.

Debug handles: every game exposes `window.arcade` (store, reducedMotion,
clampDt). The hub exposes `window.arcadeRefresh()`. The bundle exposes the same
plus the overlay (`#game-overlay`, `#game-frame`).

---

## Status

All six sprints are done — every task, no deferrals — and each is a commit on
`main`. Shipped and verified: smoke harness (the pre-commit ritual), touch
controls in every game, shared settings panel with an arcade-wide master
volume, reduced-motion override, play-time-aware hub with
filters/favorites/random, seven daily challenges + the Day Shift meta-trophy,
raycaster resolution options, a gzip-compressed bundle (714 KB), and a clean
heap audit of the three heaviest games.

## Sprint 1 — Smoke harness — DONE

**Why:** 36k lines of hand-maintained JS across 21 files and the only regression
check is "click every card and look." Every later sprint edits all 20 games at
once; this sprint is the seatbelt.

| # | Task | Acceptance |
|---|---|---|
| 1.1 | `smoke.html`: boots every game sequentially in an iframe, game list fetched from `index.html`'s cards (single source of truth) | Opening it runs all 20 with no manual input |
| 1.2 | Error capture that cannot miss early throws: fetch each game, prepend a reporter script, load via `srcdoc` — `onerror`, `unhandledrejection`, `console.error` all post to the parent | A `throw` in a game's first line is caught and attributed |
| 1.3 | Light input tickle per game (keydown, click) after boot so start screens and first-frame code paths run | Games that only crash after "press any key" are still caught |
| 1.4 | Pass/fail board plus machine-readable `window.SMOKE` (`{done, pass, results[]}`); `?game=` runs one game | Automatable from any driver; a human gets a red/green table |
| 1.5 | All 20 games green; README documents the harness as the pre-commit ritual | `SMOKE.pass === true` |

**Also done during the work:** `build-arcade.py` excludes `smoke.html` from the
card/file validation (it is a tool, not a game); `?secs=` tunes the per-game
budget.

## Sprint 2 — Touch everywhere — DONE

**Why:** four games (roguelike, neon-swarm, artillery, miner) need a physical
keyboard; seven more have partial touch. A phone opens the hub fine and then
hits a wall.

| # | Task | Result |
|---|---|---|
| 2.1 | Shared on-screen control primitives in `shared.js`: d-pad, buttons, virtual stick — created on demand, only shown on coarse pointers (`?touch=1` forces them for testing) | `arcade.touch.{button,key,dpad,arrowDpad,stick,sendKey}`; key buttons synthesize keydown/keyup with both `.key` and `.code` so game handlers are untouched |
| 2.2 | Roguelike: d-pad + wait/quaff/zap/inventory/descend + item 1–4 buttons | Verified: run started and turns taken by touch alone |
| 2.3 | Neon Swarm: left stick move, right stick aim/fire, dash button | Verified: ship thrusts with left stick while firing along right-stick direction |
| 2.4 | Artillery: drag-to-aim already works — fire/weapon/OK buttons, d-pad with 90 ms repeat for angle/power | Verified: power stepped up by held ▲, shell fired by FIRE |
| 2.5 | Miner: d-pad + E (shop) + OK + R (rescue) | Verified: expedition started and rig responds by touch |
| 2.6 | Remove the DESKTOP badges; hub cards state touch controls | No keyboard-only games left |

**Also needed, discovered during the work:** a game-over-glue `var T` collided
with miner's top-level `const T` — top-level `let/const` in a classic script is
a *page-global lexical binding*, so the collision was a parse-time SyntaxError
that silently killed the whole glue script. All glue now runs inside IIFEs.

## Sprint 3 — One set of manners — DONE

**Why:** `arcade_volume` is honored by 13 games, `M` mutes some, `P` pauses
most, Escape does nothing predictable. Players feel the seams the moment they
play a second game.

| # | Task | Result |
|---|---|---|
| 3.1 | Shared settings panel in `shared.js` (master volume, mute, motion override), gear chip on the right edge; Escape closes and keys are swallowed while it is open | Same panel everywhere. Opening on Escape was dropped on purpose: roguelike/miner already bind Escape to close their own menus |
| 3.2 | Arcade-wide master volume with zero per-game wiring: every `AudioContext`'s `.destination` is rerouted through a shared gain node at construction | Verified: `ctx.destination instanceof GainNode`; games' own sliders keep working underneath |
| 3.3 | `P` pauses every realtime game | Audit found this already true — all 13 realtime audio games bind P; the three without (pet, farm-sim, idle-clicker) are persistent sims where pause is meaningless. No code change needed |
| 3.4 | `arcade.reducedMotion()` gates screen shake in missile-command, neon-swarm, horde, ski; the flag respects an `arcade_rm` override (auto/on/off) from the panel on top of the OS setting | Verified: toggle flips the flag; CSS animation collapse now tracks the override dynamically |

## Sprint 4 — The hub knows you — DONE

**Why:** records exist but the hub is a static poster. Twenty games deserve
wayfinding.

| # | Task | Result |
|---|---|---|
| 4.1 | Last-played and play-time per game (heartbeat from shared runtime → `arcade_meta_v1`; the bundle stamps `data-arcade-game` on its iframe, smoke-harness frames are unstamped so tests never pollute it) | Verified: playing ski put it second in "Recently played" (after a faved card) |
| 4.2 | Filter chips on the hub: All / Action / Brainy / Faves / Touch / With record (`kind` + `touch` fields in the manifest) | Verified: Brainy shows the 8 thinking games |
| 4.3 | Favorites (star on card, `arcade_favs_v1`, always sorted first, in the export allowlist) | Verified: fave → Faves filter shows it, sorts first in All |
| 4.4 | "Random" chip with a card-hopping slot flourish; instant pick under reduced motion | Verified: landed on horde after the spin |

## Sprint 5 — Daily arcade — DONE (5.3 deferred)

**Why:** four games already have `*_daily` keys (atc, ski, roguelike,
lunar-lander) but nothing surfaces them. Dailies are the cheapest retention
loop this kind of collection can have.

| # | Task | Result |
|---|---|---|
| 5.1 | Shared daily helpers: `arcade.dailyKey()` (date string matching the games' convention), `arcade.dailySeed()`, `arcade.seededRand(seed)` (mulberry32) | Same seed all day, everywhere |
| 5.2 | Hub shows today's daily status on the four daily-capable cards: "Daily ✓ <result>" / "Daily —" chip next to Play | Verified with simulated records; formats match each game's metric |
| 5.3 | Daily mode added to missile-command, horde, solitaire | **Done.** mc/horde: `D` on the title toggles daily; the run swaps `Math.random` for `arcade.seededRand(dailySeed())` and restores it at game over; records in `mc_daily` (score) / `hs_daily` (seconds). Solitaire: DAILY toolbar button deals a seeded draw-1 Klondike (`shuffle` takes an rng param); best win time in `sol_daily`. Verified: solitaire's daily deal is byte-identical across clicks while NEW deals differ; mc shows the dated banner with the seeded RNG installed; horde's `D` toggles without starting. Hub shows seven daily chips; Day Shift unlocks at 7/7, not 6/7 |
| 5.4 | Trophy wall gains the "Day Shift" meta-trophy: finish every daily in one day | Verified: locked at 3/4 dailies, unlocks at 4/4; wall shows 21 trophies |

## Sprint 6 — Performance and polish — DONE (6.2 deferred)

| # | Task | Result |
|---|---|---|
| 6.1 | Raycaster: internal-resolution cycle on `G` — 320×200 / 480×300 / 640×400, persisted as `rc_res` | Verified: canvas resizes through all three steps and wraps; baked backgrounds draw scaled; HUD intact at 480×300 |
| 6.2 | Audit per-frame allocations in horde, neon-swarm, ski | **Done.** Measured `performance.memory.usedJSHeapSize` at 1 Hz over ~9 s of active play (firing / carving): horde flat at 3.0 MB, neon-swarm flat at 2.7 MB, ski flat at 2.6 MB — zero measurable growth. Horde already pools via `alloc()`. Verdict: no allocation churn worth touching. (Caveat: the API's granularity is coarse; sub-threshold churn is invisible, but nothing GC-visible accumulates.) |
| 6.3 | Bundle: payload gzipped at build (base64-embedded, inflated with `DecompressionStream` on first open; friendly error on pre-2023 browsers) | 1816 KB → **712 KB**; verified a game opens from the compressed bundle |
| 6.4 | Hub paint cost | Audited: every hub animation is transform/opacity (compositor-friendly), the starfield layers use `translate3d`, and all of it collapses under reduced motion. No action needed |

---

## Ordering rationale

1 first because every other sprint edits all twenty games and needs a tripwire.
2 before 3 because touch unlocks new players while consistency only comforts
existing ones. 4 and 5 ride on the shared runtime matured by 2–3. 6 runs last,
informed by whatever the harness and dailies shake loose.
