// Table geometry (cushion noses, pocket jaws and facings), the rack and ball-in-hand placement.
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
  function buildTable(env) {
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

    };
  }

  // ---- Rack -------------------------------------------------------------------------------------
  // A standard 15-ball triangle: the 1 on the foot spot, the 8 in the middle, a solid and a stripe in the
  // back corners, the rest shuffled.  Tiny random gaps make every break a little different.
  function rackBalls(rng) {
    const dy = R * Math.sqrt(3) + 0.0004, dx = 2 * R + 0.0004;
    const slots = [];
    [1, 2, 3, 4, 5].forEach((n, r) => {
      for (let j = 0; j < n; j++) slots.push({ x: (j - (n - 1) / 2) * dx + (rng.next() - 0.5) * 0.0002, y: FOOT_Y - r * dy - rng.next() * 0.0001, row: r, j });
    });
    const at = (r, j) => slots.findIndex((s) => s.row === r && s.j === j);
    const placed = new Array(15).fill(0);
    placed[at(0, 0)] = 1;
    placed[at(2, 1)] = 8;
    const solids = rng.shuffle([2, 3, 4, 5, 6, 7]), stripes = rng.shuffle([9, 10, 11, 12, 13, 14, 15]);
    const left = rng.chance(0.5);
    placed[at(4, 0)] = left ? solids.pop() : stripes.pop();
    placed[at(4, 4)] = left ? stripes.pop() : solids.pop();
    const rest = rng.shuffle(solids.concat(stripes));
    for (let i = 0; i < 15; i++) if (!placed[i]) placed[i] = rest.pop();
    return slots.map((s, i) => ({ n: placed[i], x: s.x, y: s.y }));
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
  Pool.table = { W, L, R, RAIL, CUSHION, HEAD_Y, FOOT_Y, BALL_COLORS, ballColor, buildTable, rackBalls, placeOk, nearestPlace };
})();
