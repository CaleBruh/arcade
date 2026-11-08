# Deploying the arcade

One Node process serves the single-player arcade **and** hosts multiplayer
rooms. There are no dependencies, so there is no install step, no lockfile,
and nothing to audit.

```sh
npm test        # exercises every sim headlessly — run this before deploying
npm start       # defaults to :8743, or set PORT
```

## Running it on a local network (no host at all)

If everyone is in the same room, this is the best option by a wide margin —
not a fallback. No account, no cost, no registration, and the 20 Hz games
play better than they ever will over the internet.

```sh
npm run party
```

It prints the address to share:

```
  share one of these with everyone on the same wifi:
      http://192.168.50.56:8080/        (en0)
```

Everyone opens that on their phone. Paste it into the group chat rather than
reading it out. Notes:

- **Everyone must be on the same wifi.** Guest networks on many routers
  isolate clients from each other and will not work.
- **macOS may prompt** to allow incoming connections the first time. Allow it,
  or nothing else can reach the machine.
- **The address changes** when the laptop rejoins a different network, so run
  the command again at the venue rather than sharing an address from home.
- Scores persist to `./data/arcade.json` as usual, so a laptop restart does
  not wipe the leaderboards.

## Players in mainland China

Worth knowing before you pick a region: no major Western host has a mainland
presence, so every player crosses the border on a long-lived WebSocket.
International bandwidth into China is throttled and jittery at peak hours.

The turn-based games are unaffected — chess sends a few hundred bytes per
move. The 20 Hz games (Sumo, Arena, Battle Royale, Light Cycles) push ~33 KB/s
per client, which is exactly the traffic shape that suffers. Expect the 45
second resume grace to be doing real work.

In rough order of how well they work from the mainland:

| | ICP filing | Notes |
|---|---|---|
| Same-room LAN | no | Best latency available, see above |
| Alibaba / Tencent **Hong Kong** | no | Optimised mainland routes; the best cloud compromise |
| Alibaba / Tencent **mainland** | **yes** | Best performance, but 备案 is a multi-day registration and ports 80/443 stay blocked until it clears |
| Fly.io `hkg` | no | Easiest to deploy, weakest routes of the three |

## Before you pick a host

Two properties decide everything:

**1. Rooms live in memory.** There is no database. Two instances would not
share rooms — half your players would create room `ABCD` on machine A and the
other half would fail to find it on machine B. So: **run exactly one
instance**, or add sticky sessions plus a shared store first. Every config
here pins one instance deliberately.

**2. Bandwidth is the limit, not CPU.** Measured with 50 real clients in one
Sumo room:

| | |
|---|---|
| Tick rate held | 19.6 / 20 Hz |
| Per-client traffic | ~33 KB/s |
| **Server upstream** | **~1.6 MB/s (≈13 Mbps)** |
| Memory | ~57 MB RSS |

One 50-player realtime room is ~13 Mbps out. Turn-based games are a rounding
error by comparison — chess sends a few hundred bytes per move. If you are
running one arena at a time, almost anything will do. If you expect several
concurrent realtime rooms, check the host's bandwidth allowance before its
CPU spec.

## Persistence — read this before deploying

Leaderboards, win records and ghosts live in a single JSON file at
`$DATA_DIR/arcade.json` (default `./data`). It is deliberately not a database:
the data is small, read-mostly, and the arcade has no dependencies.

**The failure mode to avoid:** on Fly, Render and plain Docker the container
filesystem is ephemeral. Without a mounted volume everything resets on *every
deploy* — silently, with no error. The committed configs all mount one. On Fly
you must also create it once:

```sh
fly volumes create arcade_data --size 1 --region lhr
```

What is already handled:

- **Atomic writes.** Written to a temp file and renamed, so a crash mid-write
  cannot leave a half-written file. Readers see the old copy or the new one.
- **Debounced.** A busy minute is one disk write, not hundreds.
- **SIGTERM flushes synchronously.** Hosts send SIGTERM on every deploy;
  without this you would lose the last few seconds of play each release.
  Verified by killing a process with unsaved scores and reading them back.
- **A corrupt file recovers.** It is moved aside as `arcade.json.corrupt.<ts>`
  and the server starts clean, rather than crash-looping on boot. The bad file
  is kept so you can look at it.
- **Bounded.** 50 scores per game, 20 ghosts per game, 5000 profiles, 200
  events. Disk use cannot grow without limit.

`npm test` covers all of this, including spawning real processes to prove
data outlives a restart.

## Options

### Fly.io
```sh
fly launch --no-deploy      # keeps the committed fly.toml
fly deploy
fly open
```
`fly.toml` sets `idle_timeout = 900` so WebSockets are not cut mid-game, and
`min_machines_running = 1` so the room state never evaporates.

### Render
Point Render at the repo; it reads `render.yaml`. Use **starter**, not free —
free instances sleep, and a sleeping instance drops every room.

### Docker (any VPS)
```sh
docker build -t arcade .
docker run -d --restart=unless-stopped -p 80:8080 --name arcade arcade
```

### Plain VPS, no Docker
```sh
PORT=8080 node server/server.js
```
Put nginx or Caddy in front for TLS. nginx needs the WebSocket upgrade headers:
```nginx
location / {
    proxy_pass http://127.0.0.1:8080;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_read_timeout 900s;          # or long games get cut off
}
```

## HTTPS

Serve over HTTPS and the client switches to `wss://` on its own — `net.js`
derives the socket scheme from `location.protocol`. Mixed content (an HTTPS
page opening a `ws://` socket) is blocked by browsers, so there is nothing to
configure but nothing to forget either.

## What is already hardened

Verified, not assumed:

- **A failing game cannot take the server down.** Every sim call is isolated;
  a throw ends that one room, tells its players, and leaves everyone else
  playing. This was tested by deliberately crashing a sim — before the fix the
  whole process died.
- **Malformed input is survivable.** `npm test` throws junk at every sim
  (nulls, NaN, absurd coordinates, unknown player ids) and requires no throws.
- **Caps**: 200 rooms, 400 clients, 64 KB per message, 60 messages/second per
  connection. Oversized frames close the socket; bursts are dropped.
- **Dropped players keep their seat for 45 s** and can resume into a running
  game with the same identity.
- **Authoritative state.** Clients send intent, never positions. Battleship
  additionally uses per-player views so the enemy fleet never crosses the wire.
- **`/healthz`** returns uptime, room count, client count and RSS for the
  host's health checks.

## Health check

```sh
curl https://your-host/healthz
# {"ok":true,"uptime":812,"rooms":3,"clients":17,"rss":61,
#  "store":{"schema":1,"games":6,"scores":41,"profiles":88,"dirty":false,
#           "file":"/data/arcade.json"}}
```

If `store.file` is not on your mounted volume, the data is ephemeral — fix
that before anyone plays.

## If you outgrow one instance

In order of effort: drop the tick rate to 15 Hz with client interpolation;
send deltas instead of full snapshots; pack positions as binary rather than
JSON. Only then reach for multiple instances, which means moving room state
into Redis and routing by room code.
