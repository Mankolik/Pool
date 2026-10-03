// Ball physics: sliding and rolling friction with full spin (follow, draw, stun and side), ball–ball
// collisions with cut- and spin-induced throw, cushions that take and give side spin, pocket jaws and
// capture.  Deterministic: the same stroke always plays the same way.  Pure functions on plain objects, so it runs headless in tests.
//
// Frame: x right, y down the table, z into the cloth (right-handed).  The contact point with the cloth is
// r = (0, 0, R); a ball rolls without slipping when vx = −R·wy and vy = R·wx.
(function () {
  const Pool = globalThis.Pool;
  const { R } = Pool.table;
  const { clamp } = Pool.util;
  const G = 9.81;
  const MAX_SPEED = 8.6; // m/s, a big break
  const MIN_SPEED = 0.1;
  const BALL_E = 0.94; // ball–ball restitution
  const BALL_MU = 0.04; // ball–ball friction (throw)
  const MAX_TIP = 0.6; // furthest the tip may strike from centre (fraction of R)

  function createBall(n, x, y, rng) {
    const b = { n, x, y, vx: 0, vy: 0, wx: 0, wy: 0, wz: 0, moving: false, pocketed: false, pocket: -1, sinkT: 0, rot: [1, 0, 0, 0, 1, 0, 0, 0, 1] };
    if (rng) {
      // Random orientation so the numbers face every which way, as on a real table.
      rotate(b.rot, rng.float(-1, 1), rng.float(-1, 1), rng.float(-1, 1), rng.float(0, Math.PI * 2));
    }
    return b;
  }

  // Rotate a 3×3 orientation (row-major, local → world) by angle about a world axis (Rodrigues).
  function rotate(m, ax, ay, az, ang) {
    const len = Math.hypot(ax, ay, az);
    if (len < 1e-9 || ang === 0) return;
    ax /= len; ay /= len; az /= len;
    const c = Math.cos(ang), s = Math.sin(ang), t = 1 - c;
    const r00 = t * ax * ax + c, r01 = t * ax * ay - s * az, r02 = t * ax * az + s * ay;
    const r10 = t * ax * ay + s * az, r11 = t * ay * ay + c, r12 = t * ay * az - s * ax;
    const r20 = t * ax * az - s * ay, r21 = t * ay * az + s * ax, r22 = t * az * az + c;
    for (let j = 0; j < 3; j++) {
      const a = m[j], b = m[3 + j], d = m[6 + j];
      m[j] = r00 * a + r01 * b + r02 * d;
      m[3 + j] = r10 * a + r11 * b + r12 * d;
      m[6 + j] = r20 * a + r21 * b + r22 * d;
    }
  }
  function orthonormalize(m) {
    // Gram–Schmidt on the columns.
    let n = Math.hypot(m[0], m[3], m[6]);
    m[0] /= n; m[3] /= n; m[6] /= n;
    const d = m[0] * m[1] + m[3] * m[4] + m[6] * m[7];
    m[1] -= d * m[0]; m[4] -= d * m[3]; m[7] -= d * m[6];
    n = Math.hypot(m[1], m[4], m[7]);
    m[1] /= n; m[4] /= n; m[7] /= n;
    m[2] = m[3] * m[7] - m[6] * m[4];
    m[5] = m[6] * m[1] - m[0] * m[7];
    m[8] = m[0] * m[4] - m[3] * m[1];
  }

  // Cue speed for a power setting (0–1).  Progressive, so soft touch shots get more of the meter.
  const speedFor = (p) => MIN_SPEED + (MAX_SPEED - MIN_SPEED) * Math.pow(clamp(p, 0, 1), 1.45);
  const powerFor = (v) => Math.pow(clamp((v - MIN_SPEED) / (MAX_SPEED - MIN_SPEED), 0, 1), 1 / 1.45);

  // Strike the cue ball.  a: side (+ = right of centre), b: height (+ = above centre), both in units of R.
  function strike(ball, angle, speed, a, b) {
    const dx = Math.cos(angle), dy = Math.sin(angle);
    ball.vx = dx * speed;
    ball.vy = dy * speed;
    const k = (5 * speed) / (2 * R);
    ball.wx = k * b * dy;
    ball.wy = -k * b * dx;
    ball.wz = -k * a;
    ball.moving = true;
  }

  // ---- Simulation --------------------------------------------------------------------------------
  function createSim(table, env, balls) {
    return { table, env, balls, time: 0, trackRot: true };
  }

  function anyMoving(sim) {
    for (const b of sim.balls) if (!b.pocketed && b.moving) return true;
    return false;
  }

  // Advance by dt seconds (split into small substeps).  Events are pushed into `events`.
  function step(sim, dt, events = []) {
    let vmax = 0;
    for (const b of sim.balls) if (!b.pocketed && b.moving) vmax = Math.max(vmax, Math.hypot(b.vx, b.vy) + Math.abs(b.wz) * 0.002);
    if (vmax === 0) return events;
    const n = Math.max(Math.ceil(dt / 0.002), Math.ceil((vmax * dt) / (R * 0.22)));
    const h = dt / n;
    for (let i = 0; i < n; i++) substep(sim, h, events);
    sim.time += dt;
    return events;
  }

  function substep(sim, h, events) {
    const { table, env, balls } = sim;
    const g = G * (env.gravity ?? 1);
    const slideMu = env.slide, rollMu = env.roll;
    const spinDec = (env.spinDecay ?? 9) * (env.gravity ?? 1);
    for (const b of balls) {
      if (b.pocketed || !b.moving) continue;
      const ux = b.vx + R * b.wy, uy = b.vy - R * b.wx;
      const slip = Math.hypot(ux, uy);
      if (slip > 1e-4) {
        // Sliding: kinetic friction slows the slip at 7/2·μg until the ball rolls.
        const a = slideMu * g;
        const f = Math.min(1, slip / (3.5 * a * h));
        const fx = (-a * ux) / slip, fy = (-a * uy) / slip;
        b.vx += fx * h * f;
        b.vy += fy * h * f;
        b.wx += ((-5 / (2 * R)) * fy) * h * f;
        b.wy += ((5 / (2 * R)) * fx) * h * f;
      } else {
        // Rolling: rolling resistance.
        const sp = Math.hypot(b.vx, b.vy);
        const dec = rollMu * g * h;
        if (sp <= dec) { b.vx = 0; b.vy = 0; } else { const k = (sp - dec) / sp; b.vx *= k; b.vy *= k; }
        b.wx = b.vy / R;
        b.wy = -b.vx / R;
      }
      // Spin about the vertical axis decays through the contact patch.
      if (b.wz !== 0) {
        const d = spinDec * h;
        b.wz = Math.abs(b.wz) <= d ? 0 : b.wz - Math.sign(b.wz) * d;
      }
      b.x += b.vx * h;
      b.y += b.vy * h;
      if (sim.trackRot) {
        const wl = Math.hypot(b.wx, b.wy, b.wz);
        if (wl > 1e-6) rotate(b.rot, b.wx, b.wy, b.wz, wl * h);
        if ((b.rotN = (b.rotN || 0) + 1) > 200) { b.rotN = 0; orthonormalize(b.rot); }
      }
      if (b.vx === 0 && b.vy === 0 && Math.hypot(b.wx, b.wy) < 0.05 && Math.abs(b.wz) < 0.3) {
        b.moving = false;
        b.wx = b.wy = b.wz = 0;
      }
    }
    collideBalls(balls, events);
    for (const b of balls) {
      if (b.pocketed) continue;
      if (Math.abs(b.x) > table.hw - R - 0.002 || Math.abs(b.y) > table.hl - R - 0.002) {
        collideCushions(sim, b, events);
        checkPocket(table, b, events);
      }
    }
  }

  function collideBalls(balls, events) {
    const D = 2 * R, D2 = D * D;
    for (let pass = 0; pass < 3; pass++) {
      let hit = false;
      for (let i = 0; i < balls.length; i++) {
        const a = balls[i];
        if (a.pocketed) continue;
        for (let j = i + 1; j < balls.length; j++) {
          const b = balls[j];
          if (b.pocketed || (!a.moving && !b.moving)) continue;
          const dx = b.x - a.x, dy = b.y - a.y;
          const d2 = dx * dx + dy * dy;
          if (d2 >= D2 || d2 === 0) continue;
          const d = Math.sqrt(d2);
          const nx = dx / d, ny = dy / d;
          // Separate the overlap.
          const pen = (D - d) / 2;
          a.x -= nx * pen; a.y -= ny * pen;
          b.x += nx * pen; b.y += ny * pen;
          const vn = (a.vx - b.vx) * nx + (a.vy - b.vy) * ny;
          if (vn <= 0) continue;
          hit = true;
          const J = ((1 + BALL_E) / 2) * vn;
          a.vx -= J * nx; a.vy -= J * ny;
          b.vx += J * nx; b.vy += J * ny;
          // Friction between the balls: throw from the cut angle and from side spin.
          const tx = -ny, ty = nx;
          const s = (a.vx - b.vx) * tx + (a.vy - b.vy) * ty + R * (a.wz + b.wz);
          let Jt = -s / 7;
          const lim = BALL_MU * J;
          Jt = clamp(Jt, -lim, lim);
          a.vx += Jt * tx; a.vy += Jt * ty;
          b.vx -= Jt * tx; b.vy -= Jt * ty;
          a.wz += (5 * Jt) / (2 * R);
          b.wz += (5 * Jt) / (2 * R);
          a.moving = b.moving = true;
          events.push({ type: 'ball', a: a.n, b: b.n, speed: vn, x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
        }
      }
      if (!hit) break;
    }
  }

  function collideCushions(sim, b, events) {
    const { table, env } = sim;
    for (const s of table.segs) {
      // Closest point on the segment (ends included: those are the rounded jaw points).
      let t = (b.x - s.ax) * s.tx + (b.y - s.ay) * s.ty;
      t = t < 0 ? 0 : t > s.len ? s.len : t;
      const cx = s.ax + s.tx * t, cy = s.ay + s.ty * t;
      const dx = b.x - cx, dy = b.y - cy;
      const d2 = dx * dx + dy * dy;
      if (d2 >= R * R || d2 === 0) continue;
      const d = Math.sqrt(d2);
      const nx = dx / d, ny = dy / d;
      b.x = cx + nx * R;
      b.y = cy + ny * R;
      const vn = b.vx * nx + b.vy * ny;
      if (vn >= 0) continue;
      const speed = -vn;
      // Cushions are a little livelier on soft contact.
      const e = clamp(env.cushionE * (1.06 - 0.05 * Math.min(speed, 4) / 4) * (s.kind === 'jaw' ? 0.85 : 1), 0, 0.95);
      const Jn = -(1 + e) * vn;
      b.vx += Jn * nx;
      b.vy += Jn * ny;
      // Friction at the nose: side spin bends the rebound (running / reverse english).
      const tx = -ny, ty = nx;
      const slip = b.vx * tx + b.vy * ty - R * b.wz;
      let Jt = -slip / 3.5;
      const lim = env.cushionMu * Jn;
      Jt = clamp(Jt, -lim, lim);
      b.vx += Jt * tx;
      b.vy += Jt * ty;
      b.wz -= (5 * Jt) / (2 * R);
      // The nose sits above the centre: most of the roll into the cushion is absorbed.
      const qx = -R * b.wy, qy = R * b.wx; // velocity the ball's roll would carry it at
      const qn = qx * nx + qy * ny;
      if (qn < 0) {
        const dq = -0.75 * qn;
        b.wy -= (dq * nx) / R;
        b.wx += (dq * ny) / R;
      }
      b.moving = true;
      events.push({ type: 'cushion', n: b.n, speed, kind: s.kind, x: cx, y: cy });
    }
  }

  function checkPocket(table, b, events) {
    for (const p of table.pockets) {
      const d = Math.hypot(b.x - p.x, b.y - p.y);
      // Safety net: a ball can never leave the table except into a pocket.
      const out = Math.abs(b.x) > table.hw + 0.06 || Math.abs(b.y) > table.hl + 0.06;
      if (d < p.r || (out && d < 0.25)) {
        b.pocketed = true;
        b.pocket = p.id;
        b.sinkT = 0;
        b.sinkFrom = { x: b.x, y: b.y, vx: b.vx, vy: b.vy };
        const speed = Math.hypot(b.vx, b.vy);
        b.vx = b.vy = 0;
        b.moving = false;
        events.push({ type: 'pocket', n: b.n, pocket: p.id, speed, x: p.x, y: p.y });
        return;
      }
    }
  }

  // ---- Aiming helpers --------------------------------------------------------------------------
  // Where the cue ball first meets another ball (ghost-ball position) or a cushion along an aim line.
  function traceAim(table, balls, cue, angle) {
    const dx = Math.cos(angle), dy = Math.sin(angle);
    let best = Infinity, hit = null;
    for (const b of balls) {
      if (b === cue || b.pocketed) continue;
      const ox = b.x - cue.x, oy = b.y - cue.y;
      const along = ox * dx + oy * dy;
      if (along <= 0) continue;
      const perp2 = ox * ox + oy * oy - along * along;
      const D2 = 4 * R * R;
      if (perp2 >= D2) continue;
      const t = along - Math.sqrt(D2 - perp2);
      if (t < best) { best = t; hit = b; }
    }
    // Cushion line (inner box where the ball centre turns round).
    const lx = table.hw - R, ly = table.hl - R;
    const tx = dx > 0 ? (lx - cue.x) / dx : dx < 0 ? (-lx - cue.x) / dx : Infinity;
    const ty = dy > 0 ? (ly - cue.y) / dy : dy < 0 ? (-ly - cue.y) / dy : Infinity;
    const tc = Math.max(0, Math.min(tx, ty));
    if (hit && best < tc) {
      const gx = cue.x + dx * best, gy = cue.y + dy * best;
      const nx = (hit.x - gx) / (2 * R), ny = (hit.y - gy) / (2 * R);
      const cut = Math.acos(clamp(nx * dx + ny * dy, -1, 1));
      // Stun line: the cue ball leaves at 90° to the object ball's path.
      const side = dx * ny - dy * nx > 0 ? -1 : 1;
      return { ball: hit, t: best, ghost: { x: gx, y: gy }, objDir: Math.atan2(ny, nx), cueDir: Math.atan2(ny, nx) + (side * Math.PI) / 2, cut };
    }
    const px = cue.x + dx * tc, py = cue.y + dy * tc;
    const vertical = tx < ty; // hit a side (long) cushion
    return { ball: null, t: tc, cushion: { x: px, y: py }, bounceDir: vertical ? Math.atan2(dy, -dx) : Math.atan2(-dy, dx) };
  }

  // The pocket an object ball sent along `dir` from (x, y) would drop into (ignoring other balls).
  function pocketAlong(table, x, y, dir) {
    const dx = Math.cos(dir), dy = Math.sin(dir);
    let best = null;
    for (const p of table.pockets) {
      const ox = p.x - x, oy = p.y - y;
      const along = ox * dx + oy * dy;
      if (along <= 0) continue;
      const perp = Math.abs(ox * dy - oy * dx);
      if (perp < p.r * 0.9 && (!best || along < best.dist)) best = { pocket: p, dist: along, perp };
    }
    return best;
  }

  // Copy the balls for a throwaway simulation.
  function cloneBalls(balls) {
    return balls.map((b) => ({ ...b, rot: b.rot.slice(), sinkFrom: null }));
  }

  // Run a shot to rest headlessly.  Returns what happened (first ball hit, pocketed balls, fouls...).
  function simulateShot(table, env, balls, shot, opts = {}) {
    const bs = cloneBalls(balls);
    const sim = createSim(table, env, bs);
    sim.trackRot = false;
    const cue = bs.find((b) => b.n === 0);
    strike(cue, shot.angle, speedFor(shot.power), shot.a || 0, shot.b || 0);
    const res = { first: null, pocketed: [], cushionAfter: false, scratch: false, rails: 0, balls: bs, time: 0 };
    const maxT = opts.maxT || 40;
    const dt = opts.dt || 1 / 120;
    const ev = [];
    while (anyMoving(sim) && sim.time < maxT) {
      ev.length = 0;
      step(sim, dt, ev);
      for (const e of ev) {
        if (e.type === 'ball' && res.first == null && (e.a === 0 || e.b === 0)) res.first = e.a === 0 ? e.b : e.a;
        else if (e.type === 'cushion' && res.first != null) res.cushionAfter = true;
        else if (e.type === 'pocket') {
          res.pocketed.push({ n: e.n, pocket: e.pocket });
          if (e.n === 0) res.scratch = true;
        }
      }
      if (opts.until && opts.until(res, sim)) break;
    }
    res.time = sim.time;
    return res;
  }

  Pool.physics = {
    G, MAX_SPEED, MIN_SPEED, MAX_TIP, createBall, rotate, speedFor, powerFor, strike,
    createSim, step, anyMoving, traceAim, pocketAlong, cloneBalls, simulateShot,
  };
})();
