# Arcade Multiplayer

Networked rooms for the arcade. One Node process serves the static arcade
**and** hosts the games, so deployment is a single service.

```sh
node server/server.js          # defaults to :8743
node server/server.js 9000     # or pick a port
PORT=9000 node server/server.js
```

Then open `http://localhost:8743/` — it redirects to the lobby.

## No dependencies

`ws.js` is a ~150-line WebSocket server (RFC 6455 handshake, frame codec,
fragmentation, ping/pong). The arcade's whole premise is zero dependencies and
the framing code is small enough that `npm install ws` would cost more than it
saves. Nothing here needs `npm install`.

## Architecture

```
browser ──WebSocket──► server.js ──► games.js (authoritative sim)
   │                       │
 net.js                 rooms, lobby, resume
   │
 games/<id>.js  (render + input only — never owns state)
```

The **server is authoritative**. Clients send intent (`move` / `input`) and
render snapshots; they never send positions. A modified client can misreport
what it wants to do, not what happened.

Two sync models, declared per game in `games.js`:

| Model | Server does | Right for |
|---|---|---|
| `relay` | validates each move, decides turn order | board games — tiny traffic |
| `tick` | runs the sim at 20 Hz, broadcasts snapshots | action games, anti-cheat |

## Adding a game

1. Write the sim in `server/games.js` and register it in `GAMES`:
   `{ name, min, max, sync, blurb, make }`.
   - `relay`: implement `init() view() move(id,d) finished() result()`
   - `tick`: implement `init() input(id,d) step(dt) finished() result()`
   - both: `addPlayer(id,name)` and `removePlayer(id)`
2. Write the client as `multiplayer/games/<id>.js`, assigning
   `window.MPGAMES.<id> = function (canvas, net, init) { ... }` and returning
   `{ onState, onOver, teardown }`.
3. Add a `<script>` tag for it in `multiplayer/lobby.html`.

The game id must match in all three places.

## Things worth knowing

- **Games render inside the lobby page.** Navigating to a separate page would
  drop the socket, and the server refuses rejoins to a started room. The lobby
  swaps views instead.
- **Session resume.** Every client gets a token. If the socket drops, the
  server holds the seat for 45 s (`RESUME_GRACE_MS`); reconnecting with the
  token restores the same player id, room and running match. Other players see
  them as `away` meanwhile. Phones sleep and wifi hiccups — without this, a
  two-second blip would cost someone their game.
- **Host migration.** If the host leaves, the next player in the room inherits
  it, so a room never becomes unstartable.
- **Idle rooms** are swept after 5 minutes.

## Measured limits

Taken on a laptop with 50 real WebSocket clients in one Sumo room:

| | |
|---|---|
| Tick rate held | 19.8 / 20 Hz |
| Snapshot size | ~1.0 KB for 50 players |
| Per-client traffic | ~33 KB/s |
| **Server upstream** | **~1.6 MB/s (≈13 Mbps)** |
| 50 clients connected in | 84 ms |

**The upstream figure is the thing to plan around.** One 50-player room is
~13 Mbps out; several concurrent rooms multiply that and will outgrow a small
VPS's bandwidth allowance before they trouble its CPU. If that becomes the
limit, in rough order of payoff: cut the tick rate to 15 Hz with client
interpolation, send deltas instead of full snapshots, or pack positions
binary instead of JSON. None of that is needed for a single room.
