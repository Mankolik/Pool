// Headless sanity tests for the rack, the table styles and the physics.  Run with: node tests/run.js
const path = require('path');
const fs = require('fs');
for (const f of ['util', 'themes', 'table', 'physics']) require(path.join(__dirname, '..', 'js', f + '.js'));
const Pool = globalThis.Pool;
const { physics: P, themes: TH } = Pool;
const T = Pool.table;
const R = T.R;

let failures = 0, checks = 0;
function check(cond, msg) {
  checks++;
  if (!cond) {
    failures++;
    console.error('FAIL:', msg);
  }
}
const B = (n, x, y) => P.createBall(n, x, y);
const pub = TH.ENV;
const table = T.buildTable(pub);
const run = (balls, shot, env = pub, tb = table) => P.simulateShot(tb, env, balls, shot);
const finite = (b) => [b.x, b.y, b.vx, b.vy, b.wx, b.wy, b.wz].every(Number.isFinite);
const onTable = (tb, b) => b.pocketed || (Math.abs(b.x) <= tb.hw - R + 1e-6 && Math.abs(b.y) <= tb.hl - R + 1e-6);

// --- Rack and styles -----------------------------------------------------------------------------
for (let seed = 1; seed <= 30; seed++) {
  const balls = T.rackBalls(new Pool.RNG(seed));
  const nums = balls.map((b) => b.n).sort((a, b) => a - b);
  check(balls.length === 15 && nums.every((n, k) => n === k + 1), `rack ${seed}: balls 1..15`);
  const apex = balls.reduce((m, b) => (b.y > m.y ? b : m));
  check(apex.n === 1 && Math.abs(apex.y - T.FOOT_Y) < 0.002, `rack ${seed}: the 1 on the foot spot`);
  const eight = balls.find((b) => b.n === 8);
  check(Math.abs(eight.x) < 0.002 && Math.abs(eight.y - (T.FOOT_Y - 2 * (R * Math.sqrt(3) + 0.0004))) < 0.002, `rack ${seed}: the 8 in the middle`);
  const back = balls.filter((b) => b.y < T.FOOT_Y - 0.19).sort((a, b) => a.x - b.x);
  check(back.length === 5 && (back[0].n < 8) !== (back[4].n < 8), `rack ${seed}: a solid and a stripe in the back corners`);
  for (let a = 0; a < 15; a++) {
    for (let b = a + 1; b < 15; b++) check(Math.hypot(balls[a].x - balls[b].x, balls[a].y - balls[b].y) >= 2 * R - 1e-6, `rack ${seed}: balls ${balls[a].n} and ${balls[b].n} overlap`);
  }
  check(T.placeOk(table, balls, 0, T.L * 0.34, 'kitchen') && !T.placeOk(table, balls, 0, 0, 'kitchen'), `rack ${seed}: ball in hand only behind the head string for the break`);
}
{
  let n = 0;
  for (const c of Object.keys(TH.CLOTHS)) for (const r of Object.keys(TH.RAILS)) for (const m of Object.keys(TH.ROOMS)) {
    const look = TH.makeLook({ cloth: c, rail: r, room: m });
    const colours = [look.cloth, look.clothDark, look.cushion, look.rail, look.railDark, look.diamond, look.pocketColor, look.floorA, look.floorB, look.lamp];
    if (colours.every((col) => Array.isArray(col) && col.length === 3 && col.every(Number.isFinite)) && look.music && look.floor && look.pocket) n++;
  }
  const total = Object.keys(TH.CLOTHS).length * Object.keys(TH.RAILS).length * Object.keys(TH.ROOMS).length;
  check(n === total, `every style combination is complete (${n}/${total})`);
  check(TH.makeLook({ cloth: 'nope', rail: 'nope', room: 'nope' }).cloth.length === 3, 'unknown style settings fall back to defaults');
}

// --- Physics --------------------------------------------------------------------------------------
{
  // Rolling: a soft centre-ball shot ends up rolling and stops; harder goes further.
  const d = (p) => { const r = run([B(0, 0, 1.0)], { angle: -Math.PI / 2, power: p }); return 1.0 - r.balls[0].y; };
  check(d(0.05) < d(0.1) && d(0.1) > 0.05, `soft shots go further with more pace (${d(0.05).toFixed(2)} < ${d(0.1).toFixed(2)})`);
  const lo = P.speedFor(0), hi = P.speedFor(1);
  check(lo >= 0.05 && hi > 7 && Math.abs(P.powerFor(P.speedFor(0.37)) - 0.37) < 1e-6, 'pace mapping is monotonic and invertible');
}
{
  // Straight in: stun stops near the contact point, follow runs through, draw comes back.
  const shoot = (b) => {
    const bs = [B(0, 0, 0.6), B(1, 0, 0.2)];
    const sim = P.createSim(table, pub, bs);
    P.strike(bs[0], -Math.PI / 2, P.speedFor(0.3), 0, b);
    let after = null;
    while (P.anyMoving(sim) && sim.time < 30) {
      const ev = P.step(sim, 1 / 240);
      if (ev.some((e) => e.type === 'ball') && !after) after = sim.time;
      if (after && sim.time > after + 0.8) break;
    }
    return bs[0].y - (0.2 + 2 * R); // + = came back towards the shooter
  };
  const follow = shoot(0.45), stun = shoot(-0.25), draw = shoot(-0.5);
  check(follow < -0.2, `follow runs through (${follow.toFixed(2)})`);
  check(draw > 0.05, `draw screws back (${draw.toFixed(2)})`);
  check(draw > stun && stun > follow, 'stun sits between follow and draw');
}
{
  // Pots: down the diagonal into a corner, straight across into a side pocket.
  const ang = Math.atan2(-table.hl, -table.hw);
  const r1 = run([B(0, 0, 0), B(1, Math.cos(ang) * 0.3, Math.sin(ang) * 0.3)], { angle: ang, power: 0.3 });
  check(r1.pocketed.some((p) => p.n === 1 && p.pocket === 0), 'diagonal pot into the top-left corner');
  check(r1.first === 1, 'first contact recorded');
  const r2 = run([B(0, 0, 0.3), B(1, 0.3, 0)], { angle: Math.atan2(-0.3, 0.3), power: 0.18 });
  check(r2.first === 1, 'cut shot makes contact');
  const r3 = run([B(0, -0.3, 0), B(1, 0.2, 0)], { angle: 0, power: 0.25 });
  check(r3.pocketed.some((p) => p.n === 1 && table.pockets[p.pocket].kind === 'side'), 'straight pot into the side pocket');
  // A ball rolling along the cushion runs past the side pocket into the corner.
  const r4 = run([B(0, table.hw - R - 0.0005, 0.4)], { angle: -Math.PI / 2, power: 0.25 });
  check(r4.pocketed.length === 1 && table.pockets[r4.pocketed[0].pocket].kind === 'corner', 'a rail-hugging ball passes the side pocket');
}
{
  // Side spin off a cushion: right english kicks the ball to the shooter's right.
  const end = (a) => run([B(0, 0, 0.3)], { angle: -Math.PI / 2, power: 0.3, a }).balls[0].x;
  check(end(0.45) > 0.1 && end(-0.45) < -0.1 && Math.abs(end(0)) < 0.02, `english bends the rebound (${end(-0.45).toFixed(2)}, ${end(0).toFixed(2)}, ${end(0.45).toFixed(2)})`);
}
{
  // Cut-induced throw pulls the object ball a little towards the cue ball's path (a few degrees).
  const bs = [B(0, 0, 0.6), B(1, 2 * R * Math.sin(Math.PI / 6), 0.2)];
  const sim = P.createSim(table, pub, bs);
  P.strike(bs[0], -Math.PI / 2, P.speedFor(0.15), 0, 0);
  let dir = null;
  while (P.anyMoving(sim) && sim.time < 5 && dir == null) {
    if (P.step(sim, 1 / 240).some((e) => e.type === 'ball')) dir = (Math.atan2(bs[1].vy, bs[1].vx) * 180) / Math.PI;
  }
  check(dir != null && dir < -60.5 && dir > -64, `30° cut thrown slightly (${dir && dir.toFixed(1)}° vs −60°)`);
}
{
  // Determinism: the same stroke always plays out exactly the same.
  const shot = { angle: -Math.PI / 2 + 0.01, power: 1, a: 0.2, b: -0.3 };
  const rack = () => [B(0, 0.05, 0.85), ...T.rackBalls(new Pool.RNG(4)).map((b) => B(b.n, b.x, b.y))];
  const r1 = run(rack(), shot), r2 = run(rack(), shot);
  check(r1.balls.every((b, i) => b.x === r2.balls[i].x && b.y === r2.balls[i].y && b.pocketed === r2.balls[i].pocketed), 'shots are deterministic');
}
{
  // Fuzz: random shots on real racks never lose a ball off the table or produce NaNs.
  const rng = new Pool.RNG(99);
  let bad = 0, shots = 0;
  for (let g = 0; g < 12; g++) {
    let balls = [B(0, rng.float(-0.4, 0.4), T.L * 0.34), ...T.rackBalls(rng).map((b) => B(b.n, b.x, b.y))];
    for (let k = 0; k < 6; k++) {
      const cue = balls.find((b) => b.n === 0);
      if (cue.pocketed) Object.assign(cue, T.nearestPlace(table, balls, 0, 0.8, 'anywhere'), { pocketed: false });
      const r = P.simulateShot(table, pub, balls, { angle: rng.float(0, 6.283), power: rng.float(0.1, 1), a: rng.float(-0.5, 0.5), b: rng.float(-0.5, 0.5) }, { maxT: 60 });
      balls = r.balls;
      shots++;
      for (const b of balls) if (!finite(b) || !onTable(table, b) || b.moving) bad++;
    }
  }
  check(bad === 0, `fuzz: ${bad} bad ball states over ${shots} random shots`);
}

// --- Offline cache matches the page ---------------------------------------------------------------
{
  const root = path.join(__dirname, '..');
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const sw = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
  const listed = [...sw.matchAll(/'([^']+)'/g)].map((m) => m[1]).filter((s) => /\.(js|css|svg|png|webmanifest|html)$/.test(s) && !s.startsWith('fore'));
  const used = [...html.matchAll(/(?:src|href)="([^"#:]+)"/g)].map((m) => m[1]);
  for (const u of used) check(listed.includes(u), `sw.js caches ${u}`);
  for (const f of listed) check(fs.existsSync(path.join(root, f)), `cached file exists: ${f}`);
}

console.log(failures ? `${failures} of ${checks} checks failed` : `All ${checks} checks passed`);
process.exit(failures ? 1 : 0);
