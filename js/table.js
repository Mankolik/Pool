// Table geometry (cushion noses, pocket jaws and facings), rack layouts and seeded tour generation.
// Coordinates are metres with the origin at the table centre: x to the right, y down the screen.  The
// head (breaking) end is at the bottom (+y), the foot spot and rack at the top (−y).
(function () {
  const Pool = globalThis.Pool;
  const { clamp } = Pool.util;

  const W = 1.27, L = 2.54; // playing surface of a 9-ft table
  const R = 0.028575; // ball radius (2¼")
  const RAIL = 0.15; // cushion + wooden rail, nose to outer edge
  const CUSHION = 0.045; // rubber + cloth width of the cushion
  const HEAD_Y = L / 4; // head string (the kitchen is below it)
  const FOOT_Y = -L / 4; // foot spot (rack apex)

  // Ball colours for 1–15 (9–15 are the striped versions of 1–7).
  const BALL_COLORS = [
    [246, 244, 236], // cue ball
    [244, 190, 24], [28, 74, 184], [214, 40, 32], [92, 40, 140], [242, 118, 26], [18, 124, 62], [126, 30, 32], [22, 22, 24],
  ];
  const ballColor = (n) => BALL_COLORS[n === 0 ? 0 : n > 8 ? n - 8 : n];

  // ---- Geometry --------------------------------------------------------------------------------
  // Cushion noses and jaw facings are line segments.  The ball's centre may come no closer than R to
  // any of them, which also makes the jaw points (segment ends) act like real rounded jaws.
  function buildTable(env, opts = {}) {
    const k = env.pocketK || 1;
    const hw = W / 2, hl = L / 2;
    const c = 0.084 * k; // corner jaw: distance from the corner along each rail
    const s = 0.066 * k; // side pocket half-mouth
    const segs = [];
    const seg = (ax, ay, bx, by, kind = 'rail') => segs.push({ ax, ay, bx, by, kind });
    // Rails between pockets.
    seg(-hw + c, -hl, hw - c, -hl); // foot (top)
    seg(-hw + c, hl, hw - c, hl); // head (bottom)
    seg(-hw, -hl + c, -hw, -s); seg(-hw, s, -hw, hl - c); // left
    seg(hw, -hl + c, hw, -s); seg(hw, s, hw, hl - c); // right
    // Corner facings: turned 38° outwards from the cushion line, so the throat narrows like a real pocket.
    const f = 0.055, ca = Math.cos((38 * Math.PI) / 180), sa = Math.sin((38 * Math.PI) / 180);
    const pockets = [];
    for (const sx of [-1, 1]) {
      for (const sy of [-1, 1]) {
        const cx = sx * hw, cy = sy * hl;
        // Jaw on the end rail (y = cy) and on the long rail (x = cx).
        const j1 = { x: cx - sx * c, y: cy }, j2 = { x: cx, y: cy - sy * c };
        seg(j1.x, j1.y, j1.x + sx * ca * f, j1.y + sy * sa * f, 'jaw');
        seg(j2.x, j2.y, j2.x + sx * sa * f, j2.y + sy * ca * f, 'jaw');
        const off = 0.012;
        pockets.push({
          kind: 'corner', x: cx + sx * off, y: cy + sy * off, r: 0.056 * Math.sqrt(k), sx, sy,
          jaws: [j1, j2], drawR: 0.064 * k, mouth: { x: (j1.x + j2.x) / 2, y: (j1.y + j2.y) / 2 },
        });
      }
    }
    for (const sx of [-1, 1]) {
      const cx = sx * hw;
      const nar = 0.24; // facings close in slightly towards the throat
      const fl = 0.045;
      seg(cx, -s, cx + sx * fl, -s + nar * fl, 'jaw');
      seg(cx, s, cx + sx * fl, s - nar * fl, 'jaw');
      pockets.push({
        kind: 'side', x: cx + sx * 0.042, y: 0, r: 0.05 * Math.sqrt(k), sx, sy: 0,
        jaws: [{ x: cx, y: -s }, { x: cx, y: s }], drawR: 0.058 * k, mouth: { x: cx, y: 0 },
      });
    }
    // Order pockets for naming: top-left, top-right, left side, right side, bottom-left, bottom-right.
    const order = (p) => (p.kind === 'side' ? 2 : p.sy < 0 ? 0 : 4) + (p.sx > 0 ? 1 : 0);
    pockets.sort((a, b) => order(a) - order(b));
    const NAMES = ['top-left corner', 'top-right corner', 'left side', 'right side', 'bottom-left corner', 'bottom-right corner'];
    pockets.forEach((p, i) => { p.id = i; p.name = NAMES[i]; });
    for (const g of segs) {
      const dx = g.bx - g.ax, dy = g.by - g.ay, len = Math.hypot(dx, dy);
      g.len = len; g.tx = dx / len; g.ty = dy / len;
    }
    return {
      W, L, R, RAIL, CUSHION, hw, hl, HEAD_Y, FOOT_Y, segs, pockets,
      tilt: opts.tilt || null, sand: opts.sand || [], lucky: opts.lucky ?? -1,
      sandAt(x, y) {
        for (const p of this.sand) {
          const dx = x - p.x, dy = y - p.y;
          const u = (dx * p.c + dy * p.s) / p.rx, v = (-dx * p.s + dy * p.c) / p.ry;
          const d = u * u + v * v;
          if (d < 1) return p.k * (1 - d * d);
        }
        return 0;
      },
    };
  }

  // ---- Racks -----------------------------------------------------------------------------------
  const RACKS = {
    eight: { name: 'Eight-ball', short: '8-ball', balls: 15, rule: 'Any order — but the 8 goes down last.' },
    nine: { name: 'Nine-ball', short: '9-ball', balls: 9, rule: 'Hit the lowest ball first. Pot the 9 on a legal shot to clear the rack.' },
    six: { name: 'Six-pack', short: '6-pack', balls: 6, rule: 'Six balls, any order.' },
    scatter: { name: 'Open table', short: 'Open', balls: 0, rule: 'Balls are spread out. Ball in hand anywhere, any order.' },
    rotation: { name: 'Rotation', short: 'Rotation', balls: 0, rule: 'Spread out, but always hit the lowest ball first.' },
  };

  // Triangle/diamond slot positions (apex at the foot spot, rows going up the table).
  function rackSlots(rows, rng) {
    const dy = R * Math.sqrt(3) + 0.0004, dx = 2 * R + 0.0004;
    const slots = [];
    rows.forEach((n, r) => {
      for (let j = 0; j < n; j++) {
        // Tiny gaps make every break a little different, like a real (imperfect) rack.
        slots.push({ x: (j - (n - 1) / 2) * dx + (rng.next() - 0.5) * 0.0002, y: FOOT_Y - r * dy - rng.next() * 0.0001, row: r, j });
      }
    });
    return slots;
  }

  function layoutRack(type, rng, table, opts = {}) {
    const balls = [];
    if (type === 'eight') {
      const slots = rackSlots([1, 2, 3, 4, 5], rng);
      const at = (r, j) => slots.findIndex((s) => s.row === r && s.j === j);
      const placed = new Array(15).fill(0);
      placed[at(0, 0)] = 1;
      placed[at(2, 1)] = 8;
      // One solid and one stripe in the back corners.
      const solids = [2, 3, 4, 5, 6, 7], stripes = [9, 10, 11, 12, 13, 14, 15];
      rng.shuffle(solids); rng.shuffle(stripes);
      const left = rng.chance(0.5);
      placed[at(4, 0)] = left ? solids.pop() : stripes.pop();
      placed[at(4, 4)] = left ? stripes.pop() : solids.pop();
      const rest = rng.shuffle(solids.concat(stripes));
      for (let i = 0; i < 15; i++) if (!placed[i]) placed[i] = rest.pop();
      slots.forEach((s, i) => balls.push({ n: placed[i], x: s.x, y: s.y }));
    } else if (type === 'nine') {
      const slots = rackSlots([1, 2, 3, 2, 1], rng);
      const mid = slots.findIndex((s) => s.row === 2 && s.j === 1);
      const rest = rng.shuffle([2, 3, 4, 5, 6, 7, 8]);
      slots.forEach((s, i) => balls.push({ n: i === 0 ? 1 : i === mid ? 9 : rest.pop(), x: s.x, y: s.y }));
    } else if (type === 'six') {
      const slots = rackSlots([1, 2, 3], rng);
      const nums = [1].concat(rng.shuffle([2, 3, 4, 5, 6]));
      slots.forEach((s, i) => balls.push({ n: nums[i], x: s.x, y: s.y }));
    } else {
      // Open table: seeded spread with the odd cluster and a couple of balls on the rails.
      const n = opts.count || 7;
      const ok = (x, y) => {
        if (Math.abs(x) > table.hw - R - 0.004 || Math.abs(y) > table.hl - R - 0.004) return false;
        for (const p of table.pockets) if (Math.hypot(x - p.x, y - p.y) < p.r + R + 0.07) return false;
        for (const b of balls) if (Math.hypot(x - b.x, y - b.y) < 2 * R + 0.002) return false;
        return true;
      };
      let tries = 0;
      while (balls.length < n && tries++ < 5000) {
        let x, y;
        const prev = balls.length ? balls[balls.length - 1] : null;
        if (prev && rng.chance(0.22)) {
          // Frozen to the previous ball: a small cluster to break up or play a combination off.
          const a = rng.float(0, Math.PI * 2);
          x = prev.x + Math.cos(a) * (2 * R + 0.0025); y = prev.y + Math.sin(a) * (2 * R + 0.0025);
        } else if (rng.chance(0.18)) {
          // On (or very near) a cushion.
          const side = rng.int(0, 3), t = rng.float(-0.42, 0.42);
          const gap = R + rng.float(0.001, 0.02);
          if (side < 2) { x = (side ? 1 : -1) * (table.hw - gap); y = t * L; } else { x = t * 2 * table.hw * 0.9; y = (side === 2 ? -1 : 1) * (table.hl - gap); }
        } else {
          x = rng.float(-table.hw + 0.06, table.hw - 0.06); y = rng.float(-table.hl + 0.08, table.hl - 0.08);
        }
        if (ok(x, y)) balls.push({ n: 0, x, y });
      }
      const nums = [];
      for (let i = 1; i <= balls.length; i++) nums.push(i);
      rng.shuffle(nums);
      balls.forEach((b, i) => { b.n = nums[i]; });
    }
    return balls;
  }

  // Par: roughly what a solid amateur needs (break, a miss or two, a safety now and then).  Tuned with
  // the balance harness in tests/autoplay.js.
  function rackPar(type, count, parK = 1) {
    let base;
    switch (type) {
      case 'eight': base = 23.5; break;
      case 'nine': base = 16; break;
      case 'six': base = 9; break;
      case 'rotation': base = count * 2; break;
      default: base = count * 1.6 - 0.3;
    }
    return Math.round(base * parK);
  }

  // ---- Tours -------------------------------------------------------------------------------------
  const EVENT_WORDS = ['Open', 'Classic', 'Invitational', 'Shootout', 'Masters', 'Cup', 'Challenge', 'Nine-Rack Derby'];
  // A tour is nine racks: a gentle opener, then a mix that always includes a full eight-ball rack.
  const PATTERNS = [
    ['six', 'scatter', 'nine', 'scatter', 'eight', 'rotation', 'nine', 'scatter', 'eight'],
    ['scatter', 'six', 'nine', 'rotation', 'scatter', 'eight', 'nine', 'six', 'nine'],
    ['six', 'nine', 'scatter', 'eight', 'scatter', 'nine', 'rotation', 'scatter', 'eight'],
    ['scatter', 'nine', 'six', 'scatter', 'eight', 'scatter', 'nine', 'rotation', 'nine'],
  ];

  function generateTour(seed) {
    seed = String(seed);
    const h = Pool.hashString(seed.toLowerCase());
    const rng = new Pool.RNG(h);
    const world = Pool.worldForSeed(seed);
    const name = `${rng.pick(world.venues)} ${rng.pick(EVENT_WORDS)}`;
    const types = rng.pick(PATTERNS).slice();
    const racks = types.map((type, i) => {
      const count = type === 'scatter' ? rng.int(4, 8) : type === 'rotation' ? rng.int(5, 8) : RACKS[type].balls;
      return { type, count, par: rackPar(type, count, world.parK), seed: (h ^ Math.imul(i + 1, 0x9e3779b1)) >>> 0 };
    });
    // The table is the same all tour, so its lean (saloon) is too.
    const tilt = world.env.tilt ? { a: rng.float(0, Math.PI * 2), m: world.env.tilt * rng.float(0.8, 1.2) } : null;
    if (tilt) { tilt.x = Math.cos(tilt.a) * tilt.m; tilt.y = Math.sin(tilt.a) * tilt.m; }
    return {
      seed, name, world, racks, tilt,
      pars: racks.map((r) => r.par),
      getRack(i) { return buildRack(this, i); },
    };
  }

  function buildRack(tour, i) {
    const spec = tour.racks[i];
    const rng = new Pool.RNG(spec.seed);
    const env = tour.world.env;
    const sand = [];
    if (env.sand) {
      const n = rng.int(3, 5);
      for (let k = 0; k < n; k++) {
        const a = rng.float(0, Math.PI);
        sand.push({ x: rng.float(-0.5, 0.5), y: rng.float(-1.1, 1.1), rx: rng.float(0.08, 0.2), ry: rng.float(0.05, 0.12), c: Math.cos(a), s: Math.sin(a), k: rng.float(2.5, 4), a });
      }
    }
    const lucky = tour.world.id === 'casino' ? rng.int(0, 5) : -1;
    const table = buildTable(env, { tilt: tour.tilt, sand, lucky });
    const balls = layoutRack(spec.type, rng, table, { count: spec.count });
    const broken = spec.type === 'scatter' || spec.type === 'rotation';
    return {
      index: i, type: spec.type, info: RACKS[spec.type], par: spec.par, table, balls,
      order: spec.type === 'nine' || spec.type === 'rotation' ? 'lowest' : 'any',
      lastBall: spec.type === 'eight' ? 8 : null,
      moneyBall: spec.type === 'nine' ? 9 : null,
      hand: broken ? 'anywhere' : 'kitchen',
      isBreak: !broken,
      cueStart: broken ? { x: 0, y: L * 0.32 } : { x: rng.float(-0.25, 0.25), y: L * 0.34 },
    };
  }

  // Is a cue-ball position legal for ball in hand?
  function placeOk(table, balls, x, y, zone) {
    if (Math.abs(x) > table.hw - R || Math.abs(y) > table.hl - R) return false;
    if (zone === 'kitchen' && y < HEAD_Y) return false;
    for (const p of table.pockets) if (Math.hypot(x - p.x, y - p.y) < p.r + R * 0.6) return false;
    for (const b of balls) if (!b.pocketed && b.n !== 0 && Math.hypot(x - b.x, y - b.y) < 2 * R + 0.001) return false;
    return true;
  }
  // Nearest legal spot to (x, y) for the cue ball.
  function nearestPlace(table, balls, x, y, zone) {
    x = clamp(x, -table.hw + R, table.hw - R);
    y = clamp(y, zone === 'kitchen' ? HEAD_Y : -table.hl + R, table.hl - R);
    if (placeOk(table, balls, x, y, zone)) return { x, y };
    for (let r = 0.01; r < 0.6; r += 0.01) {
      for (let a = 0; a < 24; a++) {
        const px = x + Math.cos((a / 24) * Math.PI * 2) * r, py = y + Math.sin((a / 24) * Math.PI * 2) * r;
        if (placeOk(table, balls, px, py, zone)) return { x: px, y: py };
      }
    }
    return null;
  }
  // A free spot on the long string for a respotted ball (foot spot first, then towards the foot rail).
  function spotBall(table, balls, n) {
    for (let d = 0; d < 1.2; d += 0.004) {
      for (const y of [FOOT_Y - d, FOOT_Y + d]) {
        if (Math.abs(y) > table.hl - R) continue;
        if (balls.every((b) => b.pocketed || b.n === n || Math.hypot(b.x - 0, b.y - y) >= 2 * R + 0.0005)) return { x: 0, y };
      }
    }
    return { x: 0, y: FOOT_Y };
  }

  Pool.table = { W, L, R, RAIL, CUSHION, HEAD_Y, FOOT_Y, BALL_COLORS, ballColor, buildTable, layoutRack, placeOk, nearestPlace, spotBall, rackPar };
  Pool.RACKS = RACKS;
  Pool.generateTour = generateTour;
})();
