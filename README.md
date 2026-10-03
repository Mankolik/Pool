<p align="center"><img src="logo.svg" alt="Pool!" width="420"></p>

# Pool!

A mobile-first solo pool game for the browser: real ball physics with full spin, a hold-release-tap stroke
meter and endless seeded nine-rack tours, scored against par like golf.
No build step and no dependencies, so it runs straight from GitHub Pages.

## Play offline / install as an app

Pool! is an installable web app (PWA): after the first visit everything is cached on the device, so it
plays with no connection and launches full-screen from the home screen.

- **iPhone / iPad (Safari):** open the site, tap **Share → Add to Home Screen**.
- **Android (Chrome):** tap **📲 Install app** in the menu (or ⋮ → **Install app**).

Updates download in the background when you're online and apply on the next launch. Bump `VERSION` in
`sw.js` when adding or removing files (the test suite checks the cache list matches what the page loads).

## Play

Enable GitHub Pages for the `main` branch (Settings → Pages) and the game is live at
**https://mankolik.github.io/Pool/**. Share a tour by its seed: `https://mankolik.github.io/Pool/?seed=heron7`.
To run it locally, serve the folder with any static web server (e.g. `npx http-server`).

**Goal:** clear each rack in as few shots as you can. Every rack has a par; a tour is nine racks and your
total is shown against par (birdies, bogeys and all).

**Controls (touch)**
- **Ball in hand:** each rack starts with the cue ball in hand — drag it (behind the head string for a break,
  anywhere on an open table), then tap **PLACE**. After a scratch it's ball in hand anywhere.
- **Aim:** drag anywhere on the table; ⟲ ⟳ fine-tune (hold to repeat). Each turn the cue starts lined up on the
  easiest pot the game can see — like Fore!'s suggested club.
- **Guide:** ghost ball where the cue ball makes contact; the object ball's line turns green when it's heading for
  a pocket (red if that ball isn't legal to hit first); the blue line is the cue ball's path after contact,
  bent by follow or draw.
- **Spin:** drag the tip on the little cue ball, or pick Centre, Follow, Stun, Draw or side. The further from
  centre, the bigger the miscue risk (shown under the picker).
- **Stroke:** hold **SHOOT** to draw the cue back, release to set the pace, then tap again as the marker crosses the
  white line. Early pushes the shot right, late pulls it left.
- The red **pot** mark on the meter is the slowest pace that still drops the ball you're aiming at (simulated, so
  it includes spin, the table's lean and sand — but not other balls in the way).
- Pinch, scroll or 🔍 to zoom. Hold the button while the balls run to fast-forward.
- ☰ opens the quick menu: scorecard, rack rules, sound effects, music, next track, main menu.

**Desktop:** mouse to aim, click or Space to shoot, ←/→ fine aim, W/S follow/draw, A/D side, X centre, Enter to
place, Z zoom, C scorecard, M mute, N next track.

## Racks and rules

| Rack | Balls | Rule |
| --- | --- | --- |
| Six-pack | 6, triangle | Any order |
| Open table | 4–8, spread | Ball in hand anywhere, any order (with the odd cluster and ball frozen to a cushion) |
| Rotation | 5–8, spread | Always hit the lowest ball first |
| Nine-ball | 9, diamond | Lowest ball first; pot the 9 on a legal shot to clear the rack early |
| Eight-ball | 15, triangle | Any order, but the 8 goes last (sunk early: respotted, +2) |

Fouls cost a penalty stroke: scratching (then ball in hand anywhere), hitting nothing, or the wrong ball first
in rotation racks. A rack ends at twice its par plus two. Pars come from `node tests/autoplay.js`, a balance
harness where a position-blind AI with human-like aim and pace noise plays hundreds of racks.

## Venues

Every seed plays in one venue (the menu preview shows which; roll the dice for another):

| Venue | Look | Twist |
| --- | --- | --- |
| 🍺 Pub | Green baize, oak rails, floorboards, a pint on the rail | — |
| 🏆 Tournament hall | Blue cloth, black rails, carpet | Fast cloth, lively cushions, tight pockets (par +18%) |
| 🎰 Casino | Red velvet, brass trim, chips on the rail | A lucky ★ pocket each rack: pot into it for −1 shot |
| 🤠 Saloon | Worn olive cloth, pine rails, sawdust | Slow cloth, dead cushions, big pockets — and the table leans |
| 🚀 Space station | Glowing grid cloth, chrome rails, deck plates | 0.45 g: balls slide and roll much further, spin lasts |
| 🌴 Beach bar | Teal cloth, bamboo rails, sand | Drifts of sand on the cloth slow the balls |

Each venue has two procedurally synthesised tracks (Web Audio, no audio files): pub blues and swing with a
walking bass, tournament ambience, casino big-band swing and bossa nova, saloon honky-tonk and a harmonica
waltz, space synthwave, beach calypso steel drums and reggae.

## What's simulated

- **Sliding and rolling:** the cue ball is a sphere with full 3D spin. Kinetic friction acts on the contact
  patch until the ball rolls (slip decays at 7/2·μg), then rolling resistance takes over. So stun shots stop
  dead, draw screws back and follow runs through — naturally, not scripted.
- **Cue strike:** the tip offset sets the spin (½ R above centre is natural roll). Side spin squirts the cue ball
  slightly the other way; extreme offsets and bad timing risk a miscue.
- **Ball–ball:** near-elastic collisions with friction between the balls, so cut shots and side spin *throw* the
  object ball a couple of degrees (not shown by the guide).
- **Cushions:** speed-dependent restitution, friction at the nose that turns side spin into running or reverse
  english, and most of the roll absorbed by the nose sitting above the ball's centre.
- **Pockets:** real geometry — corner jaws angled like a pro table, narrower side pockets, rounded jaw points that
  rattle balls out, and capture only once the ball is past the throat.
- **Venues:** gravity scales every friction (space), sand patches add drag, and the saloon table's lean adds a
  5/7·g·slope pull on rolling balls (balls at rest stay put).
- **Looks:** the room, rails (wood grain or brushed metal), cushions and cloth are rasterised per pixel and lit by
  the three lamps over the table. Balls are shaded per pixel each frame and really roll: numbers, stripes and the
  cue ball's red dots turn with the spin. Every ball casts a soft shadow from each lamp.

## Code layout

| File | Purpose |
| --- | --- |
| `js/util.js` | Seeded RNG, value noise, math helpers |
| `js/worlds.js` | Venue definitions: colours, room, lamps, cloth physics, twists, names |
| `js/table.js` | Table geometry (cushions, jaws, pockets), rack layouts, tours and pars |
| `js/physics.js` | Ball and spin physics, collisions, pockets, aim tracing, headless shot simulation |
| `js/rules.js` | Fouls, respots, early 8 / legal 9, lucky pocket, score names |
| `js/ai.js` | Shot finder (suggested aim, balance harness) |
| `js/render.js` | Table/room rasteriser, rolling ball shader, cue, guides, particles |
| `js/audio.js` | Synthesised sound effects (WebAudio) |
| `js/music.js` | Procedural music sequencer, instruments and the 12 venue tracks |
| `js/game.js` | State machine, stroke meter, ball in hand, input, camera, HUD, save/resume, records |

Run the headless checks with `node tests/run.js` and the balance harness with `node tests/autoplay.js`.

Made in the style of its sister game [Fore!](https://github.com/Mankolik/Fore).
