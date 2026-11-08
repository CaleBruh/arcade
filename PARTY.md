# Party runbook

The five-minute version of everything you need on the day. Nothing here
requires an internet connection — the whole arcade runs off this Mac.

## Start it

```sh
cd ~/Desktop/FA/GAME
caffeinate -dis npm run party
```

`caffeinate` stops macOS from sleeping, which would otherwise kill every
running game the moment the screen locks. Leave the lid open, plugged in.

The banner prints the address to share, e.g.:

```
share one of these with everyone on the same wifi:
    http://192.168.50.56:8080/        (en0)
```

**The number changes per network.** Whatever it prints at the venue is the
real one — don't reuse the one from home. Paste it into the group chat
rather than reading it aloud.

## Players

- Phones and laptops both work; everything has touch controls.
- `/` → the hub: 20 single-player games, daily gauntlet, tournament.
- **Multiplayer Lobby → Quick match → "Play anything"** is the zero-friction
  path: nobody types a room code, the server groups whoever is waiting.
  It holds ~8 seconds to gather players, so a crowd pressing it together
  lands in the same game.
- Hosting a specific game: create a room, read out the 4-letter code.
- A dropped phone (screen lock, wifi blip) has **45 seconds** to reopen the
  page and resume with its seat and score intact.

## Before people arrive — the two-phone test

1. Start the server, open the printed address on **two phones**.
2. Quick match on both → they should land in one game together.

If pages load but games never start, the venue wifi has **client isolation**
(devices can see the router but not each other). Fixes, in order: use a
different SSID (not the "guest" one), ask for the isolation setting to be
turned off, or hotspot one phone and put the Mac + players on it.

## Your own quiz questions

Edit `server/quizbank.js` — the format is one line per question:

```js
['The question?', ['A', 'B', 'C', 'D'], 2, 'Category'],   // 2 = C is correct
```

Add as many as you like, then restart the server. Don't worry about which
position holds the right answer — options are shuffled every game, so a
lopsided bank can't be exploited.

## Scores

Everything (leaderboards, tournament points, ghosts, daily runs) lives in
one file: `data/arcade.json`. It survives restarts. Copy that file if you
want to keep the night's results; delete it for a clean slate.

## If something breaks

| Symptom | Likely cause → fix |
|---|---|
| Nobody can load the page | Mac asleep (use `caffeinate`), or firewall prompt unanswered — click **Allow** on the macOS popup for node |
| Pages load, games don't connect | Client isolation — see two-phone test above |
| One game crashed | It can't take the server down; that room ends, everyone else keeps playing. Rejoin from the lobby |
| Everything frozen | Ctrl-C the server and start it again — scores are safe on disk, and players auto-reconnect to the lobby |

Stop the server with Ctrl-C. It saves scores on the way out.
