// Shot finder: lists makeable pots (ghost-ball geometry with clear paths), ranked by difficulty.  The
// game uses the best one to point the cue each turn; the balance harness uses it to play whole racks.
(function () {
  const Pool = globalThis.Pool;
  const { R } = Pool.table;
  const P = Pool.physics;

  // Distance from point (px, py) to segment a→b.
  function segDist(px, py, ax, ay, bx, by) {
    const dx = bx - ax, dy = by - ay;
    const l2 = dx * dx + dy * dy;
    let t = l2 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    return Math.hypot(px - (ax + dx * t), py - (ay + dy * t));
  }
  function pathClear(balls, ax, ay, bx, by, skip) {
    for (const b of balls) {
      if (b.pocketed || skip.includes(b)) continue;
      if (segDist(b.x, b.y, ax, ay, bx, by) < 2 * R - 0.001) return false;
    }
    return true;
  }

  // Where to send the object ball for a pocket: a little inside the mouth.
  function pocketTarget(p) {
    if (p.kind === 'side') return { x: p.mouth.x + p.sx * 0.01, y: 0 };
    return { x: p.mouth.x + p.sx * 0.02, y: p.mouth.y + p.sy * 0.02 };
  }

  function legalTargets(rack, balls) {
    const live = balls.filter((b) => !b.pocketed && b.n !== 0);
    if (rack.order === 'lowest') {
      const low = Math.min(...live.map((b) => b.n));
      return { first: live.filter((b) => b.n === low), pot: live };
    }
    if (rack.lastBall != null && live.length > 1) {
      const t = live.filter((b) => b.n !== rack.lastBall);
      return { first: t, pot: t };
    }
    return { first: live, pot: live };
  }

  // All direct pots (and simple combinations off the required ball in rotation racks), easiest first.
  function findShots(rack, balls) {
    const cue = balls.find((b) => b.n === 0);
    const table = rack.table;
    const { first, pot } = legalTargets(rack, balls);
    const shots = [];
    for (const ob of pot) {
      const direct = first.includes(ob);
      if (!direct && rack.order !== 'lowest') continue;
      for (const p of table.pockets) {
        const tg = pocketTarget(p);
        const ox = tg.x - ob.x, oy = tg.y - ob.y;
        const od = Math.hypot(ox, oy);
        if (od < 1e-3) continue;
        const ux = ox / od, uy = oy / od;
        // Side pockets only take balls from a reasonable angle.
        if (p.kind === 'side' && Math.abs(ux * p.sx) < 0.45) continue;
        if (p.kind === 'corner' && (ux * p.sx < -0.05 || uy * p.sy < -0.05)) continue;
        const gx = ob.x - ux * 2 * R, gy = ob.y - uy * 2 * R;
        if (Math.abs(gx) > table.hw - R + 0.002 || Math.abs(gy) > table.hl - R + 0.002) continue;
        if (!pathClear(balls, ob.x, ob.y, tg.x, tg.y, [ob, cue])) continue;
        const cx = gx - cue.x, cy = gy - cue.y;
        const cd = Math.hypot(cx, cy);
        if (cd < 1e-3) continue;
        const cut = Math.acos(Math.max(-1, Math.min(1, (cx * ux + cy * uy) / cd)));
        if (cut > 1.35) continue;
        if (direct) {
          if (!pathClear(balls, cue.x, cue.y, gx, gy, [cue, ob])) continue;
          const angle = Math.atan2(cy, cx);
          // Difficulty: the angular window shrinks with distance and with the cut.
          const window = (p.r * 0.9) / (od + 0.05) * Math.cos(cut) / (cd + 0.2);
          shots.push({ ball: ob.n, pocket: p.id, angle, cut, cd, od, score: window, combo: null });
        } else {
          // Combination: the required ball sent into this one.
          for (const fb of first) {
            const fx = gx - fb.x, fy = gy - fb.y, fd = Math.hypot(fx, fy);
            if (fd < 2 * R || fd > 0.8) continue;
            const fux = fx / fd, fuy = fy / fd;
            const g2x = fb.x - fux * 2 * R, g2y = fb.y - fuy * 2 * R;
            const c2x = g2x - cue.x, c2y = g2y - cue.y, c2d = Math.hypot(c2x, c2y);
            const cut2 = Math.acos(Math.max(-1, Math.min(1, (c2x * fux + c2y * fuy) / c2d)));
            const cutB = Math.acos(Math.max(-1, Math.min(1, fux * ux + fuy * uy)));
            if (cut2 > 1.0 || cutB > 0.6) continue;
            if (!pathClear(balls, fb.x, fb.y, gx, gy, [fb, ob, cue]) || !pathClear(balls, cue.x, cue.y, g2x, g2y, [cue, fb])) continue;
            const window = ((p.r * 0.9) / (od + 0.05)) * Math.cos(cut2) * Math.cos(cutB) * 0.35 / (c2d + fd + 0.2);
            shots.push({ ball: ob.n, pocket: p.id, angle: Math.atan2(c2y, c2x), cut: cut2, cd: c2d, od: od + fd, score: window, combo: fb.n });
          }
        }
      }
    }
    // Rotation: potting the money ball early is worth chasing.
    for (const s of shots) if (rack.moneyBall != null && s.ball === rack.moneyBall) s.score *= 1.6;
    shots.sort((a, b) => b.score - a.score);
    return shots;
  }

  // When nothing is on: hit the required ball as full as possible (a legal contact), softly.
  function fallbackShot(rack, balls) {
    const cue = balls.find((b) => b.n === 0);
    const { first } = legalTargets(rack, balls);
    let best = null;
    for (const ob of first) {
      const d = Math.hypot(ob.x - cue.x, ob.y - cue.y);
      for (const off of [0, 0.6, -0.6, 1.2, -1.2, 1.7, -1.7]) {
        const base = Math.atan2(ob.y - cue.y, ob.x - cue.x);
        const ang = base + Math.asin(Math.max(-1, Math.min(1, (off * R) / d)));
        const tr = P.traceAim(rack.table, balls, cue, ang);
        if (tr.ball && tr.ball.n === ob.n) {
          const sc = -Math.abs(off) - d * 0.3;
          if (!best || sc > best.score) best = { ball: ob.n, pocket: -1, angle: ang, cut: Math.abs(off) * 0.5, cd: d, od: 0, score: sc, safety: true };
          break;
        }
      }
    }
    return best;
  }

  // Break: straight up the table into the apex, full power.
  function breakShot(rack, balls) {
    const cue = balls.find((b) => b.n === 0);
    const apex = balls.filter((b) => b.n !== 0 && !b.pocketed).reduce((a, b) => (b.y > a.y ? b : a));
    return { ball: apex.n, pocket: -1, angle: Math.atan2(apex.y - cue.y, apex.x - cue.x), power: 1, isBreak: true, score: 0 };
  }

  Pool.ai = { findShots, fallbackShot, breakShot, legalTargets, pocketTarget, pathClear };
})();
