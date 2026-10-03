// Balance harness: a simple AI with human-like aim and pace noise plays whole racks of every type in every
// venue, to check pars are fair.  Run with: node tests/autoplay.js [racksPerType] [aimSigmaDeg]
const path = require('path');
for (const f of ['util', 'worlds', 'table', 'physics', 'rules', 'ai']) require(path.join(__dirname, '..', 'js', f + '.js'));
const Pool = globalThis.Pool;
const { physics: P, ai: AI, rules: Rules } = Pool;
const T = Pool.table;

const N = +(process.argv[2] || 12);
const AIM_SIGMA = +(process.argv[3] || 0.32) * (Math.PI / 180);
const rng = new Pool.RNG(12345);

// Ball in hand: try a grid of spots and keep the one with the easiest pot.
function placeCue(rack, balls, zone) {
  const cue = balls.find((b) => b.n === 0);
  let best = null;
  for (let x = -0.55; x <= 0.55; x += 0.11) {
    for (let y = zone === 'kitchen' ? T.HEAD_Y + 0.05 : -1.2; y <= 1.2; y += 0.12) {
      if (!T.placeOk(rack.table, balls, x, y, zone)) continue;
      cue.x = x; cue.y = y;
      const s = AI.findShots(rack, balls)[0];
      const sc = s ? s.score : -1;
      if (!best || sc > best.sc) best = { x, y, sc };
    }
  }
  if (best) { cue.x = best.x; cue.y = best.y; }
  cue.pocketed = false;
}

function playRack(tour, i) {
  const rack = tour.getRack(i);
  const env = tour.world.env;
  let balls = rack.balls.map((b) => P.createBall(b.n, b.x, b.y));
  const cue = P.createBall(0, rack.cueStart.x, rack.cueStart.y);
  balls.unshift(cue);
  let strokes = 0, pen = 0, bonus = 0;
  if (!rack.isBreak) placeCue(rack, balls, 'anywhere');
  const cap = Rules.capFor(rack.par);
  let hand = null;
  for (let guard = 0; guard < 80; guard++) {
    if (hand) { placeCue(rack, balls, hand); hand = null; }
    let shot;
    if (rack.isBreak && strokes === 0) shot = { ...AI.breakShot(rack, balls), power: 1 };
    else {
      const s = AI.findShots(rack, balls)[0] || AI.fallbackShot(rack, balls);
      if (!s) shot = { angle: rng.float(0, Math.PI * 2), power: 0.4 };
      else if (s.pocket >= 0 && !s.combo) {
        const pp = P.potPower(rack.table, env, balls, 0, s.ball, s.pocket, s.angle, 0, 0);
        shot = { ...s, power: pp == null ? 0.45 : Math.min(1, P.powerFor(P.speedFor(pp) * 1.25 + 0.15)) };
      } else shot = { ...s, power: s.combo ? 0.5 : 0.35 };
    }
    const before = balls.filter((b) => b.n !== 0 && !b.pocketed).map((b) => b.n);
    const angle = shot.angle + rng.gauss() * AIM_SIGMA * (1 + shot.power * 0.5);
    const power = Math.max(0.03, Math.min(1, shot.power * (1 + rng.gauss() * 0.06)));
    const res = P.simulateShot(rack.table, env, balls, { angle, power, a: 0, b: 0 }, { maxT: 60 });
    balls = res.balls;
    strokes++;
    const j = Rules.judge(rack, before, res);
    pen += j.penalty;
    bonus += j.bonus;
    for (const n of j.respot) {
      const b = balls.find((q) => q.n === n);
      const sp = T.spotBall(rack.table, balls, n);
      Object.assign(b, { pocketed: false, x: sp.x, y: sp.y, vx: 0, vy: 0, moving: false });
    }
    if (j.cleared) return { score: Math.max(1, strokes + pen - bonus), strokes, pen, capped: false };
    if (strokes + pen - bonus >= cap) return { score: cap, strokes, pen, capped: true };
    if (j.cueInHand) hand = 'anywhere';
  }
  return { score: cap, strokes, pen, capped: true };
}

const t0 = Date.now();
const byType = {};
const byWorld = {};
const seeds = [];
for (let k = 0; seeds.length < N * 6 && k < 5000; k++) seeds.push('auto' + k);
let tours = 0;
const perWorld = {};
for (const seed of seeds) {
  const tour = Pool.generateTour(seed);
  if ((perWorld[tour.world.id] = (perWorld[tour.world.id] || 0) + 1) > Math.ceil(N / 1.5)) continue;
  tours++;
  for (let i = 0; i < 9; i++) {
    const r = playRack(tour, i);
    const spec = tour.racks[i];
    const key = spec.type === 'scatter' || spec.type === 'rotation' ? `${spec.type}-${spec.count}` : spec.type;
    (byType[key] = byType[key] || []).push({ ...r, par: spec.par });
    (byWorld[tour.world.id] = byWorld[tour.world.id] || []).push(r.score - spec.par);
  }
}
const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
console.log(`${tours} tours, aim σ ${(AIM_SIGMA * 180 / Math.PI).toFixed(2)}°, ${((Date.now() - t0) / 1000).toFixed(1)} s`);
for (const k of Object.keys(byType).sort()) {
  const a = byType[k];
  console.log(`${k.padEnd(12)} n=${String(a.length).padStart(3)}  par ${a[0].par}  mean ${mean(a.map((r) => r.score)).toFixed(1)}  pen ${mean(a.map((r) => r.pen)).toFixed(1)}  capped ${a.filter((r) => r.capped).length}`);
}
for (const [w, d] of Object.entries(byWorld)) console.log(`${w.padEnd(12)} vs par ${mean(d) >= 0 ? '+' : ''}${mean(d).toFixed(2)} per rack`);
