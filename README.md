<p align="center"><img src="logo.svg" alt="Poolio" width="420"></p>

# Poolio

A mobile-first solo pool game for the browser: rack up 15 balls and clear the table in as few shots as you can.
Real ball physics with full spin, a precise strength slider, and a table you can restyle.
No build step and no dependencies, so it runs straight from GitHub Pages.

## Play offline / install as an app

Poolio is an installable web app (PWA): after the first visit everything is cached on the device, so it
plays with no connection and launches full-screen from the home screen.

- **iPhone / iPad (Safari):** open the site, tap **Share → Add to Home Screen**.
- **Android (Chrome):** tap **📲 Install app** in the menu (or ⋮ → **Install app**).

Updates download in the background when you're online and apply on the next launch. Bump `VERSION` in
`sw.js` when adding or removing files (the test suite checks the cache list matches what the page loads).

## Play

Enable GitHub Pages for the `main` branch (Settings → Pages) and the game is live at
**https://mankolik.github.io/Pool/**. To run it locally, serve the folder with any static web server
(e.g. `npx http-server`).

**Goal:** pot all 15 balls, in any order. Your score is shots + fouls (− lucky-pocket bonuses). The best
clearance is kept for each combination of table conditions.
A game in progress is saved, so you can close the app and continue later.

**Controls (touch)**
- **Ball in hand:** the break starts with the cue ball in hand behind the head string — drag it, then tap
  **PLACE**. After a scratch it's ball in hand anywhere.
- **Aim:** drag anywhere on the table; ⟲ ⟳ nudge it about 0.05° at a time (hold to repeat).
- **Strength:** drag the strength bar, then tap **SHOOT**. 100% is a hard break (7 m/s, about 25 km/h); half
  strength is a firm 2.5 m/s shot, and the low end is finely graded for touch shots. There's no timing and no randomness — the same aim,
  strength and spin always play the same shot.
- **Spin (optional):** tap the little cue ball to open the floating spin window and drag the pointer to where the
  tip should strike: high for follow, low for draw, left/right for side. Drag the window by its header to move it.
- **Guide:** ghost ball where the cue ball makes contact; the object ball's line turns green when it's heading for a
  pocket; the blue line is the cue ball's path after contact, bent by follow or draw. It can be set to Full,
  Short or Off.
- **Fouls (+1):** scratching or hitting no ball.
- Pinch, scroll or 🔍 to zoom. Hold **SHOOT** while the balls run to fast-forward. ☰ has new game, table style,
  sound, music and the main menu.

**Desktop:** drag to aim, ←/→ fine aim (Shift for bigger steps), ↑/↓ strength, Space/Enter to place and shoot,
S spin window, Z zoom, M mute, N next track.

## Table conditions

Before the break, **New game** opens a setup screen. Every condition is optional and independent, and fixed for
the whole game; **Standard table** resets them all.

| Condition | Options | Effect |
| --- | --- | --- |
| 🧶 Cloth speed | Slow / Normal / Fast | Rolling and sliding friction |
| 🛞 Cushions | Dead / Normal / Lively | How much speed the rails give back |
| 🕳️ Pockets | Tight / Normal / Generous | Pocket mouth and capture size |
| 🪐 Gravity | Normal / Low (0.45 g) | All friction scales with gravity: balls slide and roll much further, spin lasts |
| 📐 Table lean | Level / Leaning | A random slope each game; slow balls drift downhill (5/7·g·slope), resting balls stay put. A spirit level in the HUD shows which way |
| 🏖️ Sand on the cloth | Clean / Sandy | 3–5 random patches that add drag |
| ★ Lucky pocket | Off / On | One pocket glows gold; a ball potted there on a clean shot is −1, then the gold moves |

The random parts (lean direction, sand, the first lucky pocket) are drawn once at the start and saved with
the game, so shots stay deterministic. Each combination keeps its own best score; the menu shows the best on
the standard table and the best with your last-used conditions.

## Table style

🎨 (on the menu or in game) opens the style screen with a live preview:

- **Cloth:** classic green, tournament blue, casino red, burgundy, purple, teal, olive, slate grey, black.
- **Rails:** oak, walnut, mahogany & brass, black lacquer, maple, bamboo, chrome & neon — each with matching
  sights and pocket liners.
- **Room:** pub, tournament hall, casino, saloon, space station or beach bar — the floor, lamp light, props around
  the table and the music (two synthesised tracks per room) change with it.

The style is purely cosmetic: every combination plays exactly the same.

## What's simulated

- **Sliding and rolling:** the cue ball is a sphere with full 3D spin. Kinetic friction acts on the contact
  patch until the ball rolls (slip decays at 7/2·μg), then rolling resistance takes over, so stun shots stop
  dead, draw screws back and follow runs through — naturally, not scripted.
- **Ball–ball:** near-elastic collisions with friction between the balls, so cut shots and side spin *throw* the
  object ball a little (not shown by the guide).
- **Cushions:** speed-dependent restitution, friction at the nose that turns side spin into running or reverse
  english, and most of the roll absorbed by the nose sitting above the ball's centre.
- **Pockets:** corner jaws angled like a real table, narrower side pockets, rounded jaw points that can rattle a
  ball out, and capture only once the ball is past the throat.
- **Looks:** the room, rails, cushions and cloth are rasterised per pixel and lit by the lamps over the table.
  Balls are shaded per pixel and really roll: numbers, stripes and the cue ball's red dots turn with the spin.

## Code layout

| File | Purpose |
| --- | --- |
| `js/util.js` | Seeded RNG, value noise, math helpers |
| `js/themes.js` | Table style options: cloths, rails, rooms |
| `js/conditions.js` | Optional table conditions: physics settings, random extras, best-score keys |
| `js/table.js` | Table geometry (cushions, jaws, pockets), the rack, ball-in-hand placement |
| `js/physics.js` | Ball and spin physics, collisions, pockets, aim tracing, headless shot simulation |
| `js/render.js` | Table/room rasteriser, rolling ball shader, cue, guides, spin picker |
| `js/audio.js` | Synthesised sound effects (WebAudio) |
| `js/music.js` | Procedural music sequencer, instruments and the 12 room tracks |
| `js/game.js` | Game flow, setup and style screens, strength slider, spin window, input, camera, HUD, saving |

Run the headless checks with `node tests/run.js`.
