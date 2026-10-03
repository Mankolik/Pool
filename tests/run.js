// Headless sanity tests for tours, racks, physics and rules.  Run with: node tests/run.js
const path = require('path');
const fs = require('fs');
for (const f of ['util', 'worlds', 'table', 'physics', 'rules', 'ai']) require(path.join(__dirname, '..', 'js', f + '.js'));
const Pool = globalThis.Pool;
const { physics: P, rules: Rules } = Pool;
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
const pub = Pool.WORLDS.pub.env;
const table = T.buildTable(pub);
const run = (balls, shot, env = pub, tb = table) => P.simulateShot(tb, env, balls, shot);
const finite = (b) => [b.x, b.y, b.vx, b.vy, b.wx, b.wy, b.wz].every(Number.isFinite);
const onTable = (tb, b) => b.pocketed || (Math.abs(b.x) <= tb.hw - R + 1e-6 && Math.abs(b.y) <= tb.hl - R + 1e-6);

// --- Tours and racks ------------------------------------------------------------------------------
for (const seed of ['alpha', 'bravo', 'charlie', 'delta', 'echo', '12345', 'heron7']) {
  const t = Pool.generateTour(seed);
  check(t.racks.length === 9 && t.pars.every((p) => p >= 4), `${seed}: nine racks with sensible pars`);
  check(Pool.generateTour(seed).name === t.name && Pool.generateTour(seed.toUpperCase()).world.id === t.world.id, `${seed}: deterministic, case-insensitive`);
  check(t.racks.some((r) => r.type === 'eight') || t.racks.some((r) => r.type === 'nine'), `${seed}: a full rack in every tour`);
  for (let i = 0; i < 9; i++) {
    const rack = t.getRack(i);
    const tag = `${seed} rack ${i + 1} (${rack.type})`;
    const want = { eight: 15, nine: 9, six: 6 }[rack.type] ?? t.racks[i].count;
    check(rack.balls.length === want, `${tag}: ${rack.balls.length} balls, expected ${want}`);
    const nums = rack.balls.map((b) => b.n).sort((a, b) => a - b);
    check(nums.every((n, k) => n === k + 1), `${tag}: balls numbered 1..${want}`);
    for (let a = 0; a < rack.balls.length; a++) {
      const p = rack.balls[a];
      check(onTable(rack.table, p), `${tag}: ball ${p.n} on the cloth`);
      for (let b = a + 1; b < rack.balls.length; b++) {
        const q = rack.balls[b];
        check(Math.hypot(p.x - q.x, p.y - q.y) >= 2 * R - 1e-6, `${tag}: balls ${p.n} and ${q.n} overlap`);
      }
    }
    check(T.placeOk(rack.table, rack.balls, rack.cueStart.x, rack.cueStart.y, rack.hand), `${tag}: cue ball starts on a legal spot`);
    if (rack.type === 'eight') {
      const apex = rack.balls.reduce((m, b) => (b.y > m.y ? b : m));
      check(apex.n === 1 && Math.abs(apex.y - T.FOOT_Y) < 0.002, `${tag}: 1 on the foot spot`);
    }
    if (rack.type === 'nine') check(rack.moneyBall === 9 && rack.order === 'lowest', `${tag}: nine-ball rules`);
  }
}
{
  const found = {};
  for (let k = 0; k < 300 && Object.keys(found).length < Pool.WORLD_ORDER.length; k++) {
    const w = Pool.worldForSeed('w' + k);
    found[w.id] = found[w.id] || 'w' + k;
  }
  check(Object.keys(found).length === Pool.WORLD_ORDER.length, `every venue reachable from seeds (${Object.keys(found).join(', ')})`);
  const casino = Pool.generateTour(found.casino).getRack(0);
  check(casino.table.lucky >= 0 && casino.table.lucky < 6, 'casino racks have a lucky pocket');
  const saloon = Pool.generateTour(found.saloon);
  check(saloon.tilt && Math.hypot(saloon.tilt.x, saloon.tilt.y) > 0, 'the saloon table leans');
  const beach = Pool.generateTour(found.beach).getRack(0);
  check(beach.table.sand.length >= 3 && beach.table.sand.some((s) => beach.table.sandAt(s.x, s.y) > 0), 'the beach has sand on the cloth');
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
  // Low gravity: the same stroke rolls much further in space.
  const tbS = T.buildTable(Pool.WORLDS.space.env);
  const t1 = run([B(0, 0, 1.0)], { angle: -Math.PI / 2, power: 0.08 }).time;
  const t2 = run([B(0, 0, 1.0)], { angle: -Math.PI / 2, power: 0.08 }, Pool.WORLDS.space.env, tbS).time;
  check(t2 > t1 * 1.6, `low gravity: balls run longer (${t1.toFixed(1)} s vs ${t2.toFixed(1)} s)`);
  // Sand: a ball rolling through a sand patch stops sooner.
  const tbB = T.buildTable(Pool.WORLDS.beach.env, { sand: [{ x: 0, y: 0.75, rx: 0.3, ry: 0.3, c: 1, s: 0, k: 3 }] });
  const yb = run([B(0, 0, 1.0)], { angle: -Math.PI / 2, power: 0.12 }, Pool.WORLDS.beach.env, tbB).balls[0].y;
  const yn = run([B(0, 0, 1.0)], { angle: -Math.PI / 2, power: 0.12 }, Pool.WORLDS.beach.env, T.buildTable(Pool.WORLDS.beach.env)).balls[0].y;
  check(yb > yn + 0.05, `sand slows the ball (${yb.toFixed(2)} vs ${yn.toFixed(2)})`);
  // Lean: a resting ball stays put; a dying ball drifts downhill.
  const tbL = T.buildTable(Pool.WORLDS.saloon.env, { tilt: { x: 0.003, y: 0 } });
  const rest = run([B(0, 0, 0), B(1, 0.3, 0.5)], { angle: -Math.PI / 2, power: 0.02 }, Pool.WORLDS.saloon.env, tbL).balls[1];
  check(rest.x === 0.3 && rest.y === 0.5, 'balls at rest stay put on a leaning table');
  const drift = run([B(0, 0, 1.0)], { angle: -Math.PI / 2, power: 0.12 }, Pool.WORLDS.saloon.env, tbL).balls[0].x;
  check(drift > 0.004, `a slow roll drifts with the lean (${(drift * 1000).toFixed(0)} mm)`);
}
{
  // Fuzz: random shots on real racks never lose a ball off the table or produce NaNs.
  const rng = new Pool.RNG(99);
  let bad = 0, shots = 0;
  for (const w of Pool.WORLD_ORDER) {
    const tour = Pool.generateTour('fuzz-' + w);
    for (let i = 0; i < 9; i += 2) {
      const rack = tour.getRack(i);
      let balls = rack.balls.map((b) => B(b.n, b.x, b.y));
      balls.unshift(B(0, rack.cueStart.x, rack.cueStart.y));
      for (let k = 0; k < 4; k++) {
        const cue = balls.find((b) => b.n === 0);
        if (cue.pocketed) Object.assign(cue, T.nearestPlace(rack.table, balls, 0, 0.8, 'anywhere'), { pocketed: false });
        const r = P.simulateShot(rack.table, tour.world.env, balls, { angle: rng.float(0, 6.283), power: rng.float(0.1, 1), a: rng.float(-0.5, 0.5), b: rng.float(-0.5, 0.5) }, { maxT: 60 });
        balls = r.balls;
        shots++;
        for (const b of balls) if (!finite(b) || !onTable(rack.table, b) || b.moving) bad++;
      }
    }
  }
  check(bad === 0, `fuzz: ${bad} bad ball states over ${shots} random shots`);
}

// --- Rules ----------------------------------------------------------------------------------------
{
  const tour = Pool.generateTour('rules');
  const mk = (type, extra = {}) => ({ order: type === 'nine' || type === 'rotation' ? 'lowest' : 'any', lastBall: type === 'eight' ? 8 : null, moneyBall: type === 'nine' ? 9 : null, table: { lucky: -1 }, ...extra });
  let j = Rules.judge(mk('six'), [1, 2, 3], { first: null, pocketed: [], scratch: false });
  check(j.foul === 'miss' && j.penalty === 1, 'missing everything is a foul');
  j = Rules.judge(mk('nine'), [2, 5, 9], { first: 5, pocketed: [], scratch: false });
  check(j.foul === 'wrong' && j.penalty === 1, 'rotation: wrong ball first is a foul');
  j = Rules.judge(mk('nine'), [2, 5, 9], { first: 2, pocketed: [{ n: 9, pocket: 1 }], scratch: false });
  check(j.cleared && j.early && j.penalty === 0, 'nine-ball: a legal 9 clears the rack');
  j = Rules.judge(mk('nine'), [2, 5, 9], { first: 5, pocketed: [{ n: 9, pocket: 1 }], scratch: false });
  check(!j.cleared && j.respot.includes(9), 'nine-ball: the 9 on a foul is respotted');
  j = Rules.judge(mk('eight'), [3, 8, 12], { first: 3, pocketed: [{ n: 8, pocket: 2 }], scratch: false });
  check(j.penalty === 2 && j.respot.includes(8) && !j.cleared, 'eight-ball: the 8 early costs two and comes back');
  j = Rules.judge(mk('eight'), [8], { first: 8, pocketed: [{ n: 8, pocket: 2 }], scratch: false });
  check(j.cleared && j.penalty === 0, 'eight-ball: the 8 last clears the rack');
  j = Rules.judge(mk('six'), [4], { first: 4, pocketed: [{ n: 4, pocket: 0 }, { n: 0, pocket: 3 }], scratch: true });
  check(j.cleared && j.penalty === 1 && j.cueInHand, 'scratch on the last ball still clears, with the penalty');
  j = Rules.judge(mk('six', { table: { lucky: 3 } }), [1, 4], { first: 4, pocketed: [{ n: 4, pocket: 3 }], scratch: false });
  check(j.bonus === 1, 'casino: the lucky pocket gives a shot back');
  j = Rules.judge(mk('six', { table: { lucky: 3 } }), [1, 4], { first: null, pocketed: [{ n: 4, pocket: 3 }], scratch: false });
  check(j.bonus === 0, 'casino: no bonus on a foul');
  check(Rules.scoreName(7, 8) === 'Birdie!' && Rules.scoreName(8, 8) === 'Par' && Rules.capFor(8) === 18, 'score names and shot cap');
  check(tour.pars.length === 9, 'rules tour builds');
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
