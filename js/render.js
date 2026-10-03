// Drawing: a pre-rendered room + table layer (lit by the lamps above it), per-pixel shaded balls that
// really roll (numbers, stripes and the cue ball's spots turn with the spin), the cue, aim guides,
// shadows and particles.
(function () {
  const Pool = globalThis.Pool;
  const { R, RAIL, CUSHION, HEAD_Y, ballColor } = Pool.table;
  const { clamp, lerp, rgb, rgba } = Pool.util;
  const hash2 = Pool.hash2;

  const LAMP_H = 1.0; // lamp height above the cloth (m)
  const LAMPS = [{ x: 0, y: -0.78 }, { x: 0, y: 0 }, { x: 0, y: 0.78 }];
  const MARGIN = 0.6; // floor drawn around the table (m)
  const CUE_LEN = 1.47;

  // ---- View ---------------------------------------------------------------------------------------
  // The table is drawn portrait (head end at the bottom) on tall screens and turned a quarter (head end
  // on the right) on wide ones.
  class Renderer {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.dpr = 1; this.vw = 1; this.vh = 1;
      this.view = { s: 100, rot: false, cx: 0, cy: 0 };
      this.layer = null;
      this.sprites = new Map();
      this.digits = new Map();
    }
    resize(vw, vh, dpr) {
      this.vw = vw; this.vh = vh; this.dpr = dpr;
      this.canvas.width = Math.round(vw * dpr);
      this.canvas.height = Math.round(vh * dpr);
      this.canvas.style.width = vw + 'px';
      this.canvas.style.height = vh + 'px';
    }
    // Fit the whole table (with its rails) into the free area (between the HUD and the controls).
    fit(area, zoom = 1, focus = null) {
      const availW = Math.max(80, area.r - area.l - 8), availH = Math.max(80, area.b - area.t);
      const tw = Pool.table.W + 2 * RAIL * 0.7, tl = Pool.table.L + 2 * RAIL * 0.7; // rails may tuck under the panels
      const sP = Math.min(availW / tw, availH / tl);
      const sL = Math.min(availW / tl, availH / tw);
      const rot = sL > sP * 1.12;
      const base = rot ? sL : sP;
      const s = base * zoom;
      let cx = (area.l + area.r) / 2, cy = (area.t + area.b) / 2;
      if (focus && zoom > 1.001) {
        // Follow the focus point, but never scroll further than the table's own edge.
        const fx = rot ? focus.y : focus.x, fy = rot ? -focus.x : focus.y;
        const halfW = ((rot ? tl : tw) / 2) * s, halfH = ((rot ? tw : tl) / 2) * s;
        const mx = Math.max(0, halfW - availW / 2), my = Math.max(0, halfH - availH / 2);
        cx -= clamp(fx * s, -mx, mx);
        cy -= clamp(fy * s, -my, my);
      }
      this.view = { s, rot, cx, cy, base };
      return this.view;
    }
    toScreen(x, y) {
      const v = this.view;
      return v.rot ? { x: v.cx + y * v.s, y: v.cy - x * v.s } : { x: v.cx + x * v.s, y: v.cy + y * v.s };
    }
    toWorld(sx, sy) {
      const v = this.view;
      return v.rot ? { x: -(sy - v.cy) / v.s, y: (sx - v.cx) / v.s } : { x: (sx - v.cx) / v.s, y: (sy - v.cy) / v.s };
    }
    setWorld() {
      const v = this.view, d = this.dpr;
      if (v.rot) this.ctx.setTransform(0, -v.s * d, v.s * d, 0, v.cx * d, v.cy * d);
      else this.ctx.setTransform(v.s * d, 0, 0, v.s * d, v.cx * d, v.cy * d);
    }
    setScreen() {
      this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    }
  }

  // ---- Lighting ---------------------------------------------------------------------------------
  function lampLight(x, y, z = 0) {
    let sum = 0;
    for (const l of LAMPS) {
      const h = LAMP_H - z;
      const d2 = (x - l.x) * (x - l.x) + (y - l.y) * (y - l.y);
      sum += Math.pow(1 + d2 / (h * h * 0.55), -1.6);
    }
    return sum / 1.25;
  }

  // ---- Table layer ------------------------------------------------------------------------------
  // Pre-rendered once per rack (and on resize): room floor, table shadow, wooden rails with grain,
  // cushions, cloth (felt texture, wear, sand, the world's markings) and the lamp light over it all.
  function buildLayer(rack, world, ppm) {
    const table = rack.table;
    const hw = table.hw, hl = table.hl;
    const ox = hw + RAIL, oy = hl + RAIL; // outer edge of the rails
    const x0 = -ox - MARGIN, y0 = -oy - MARGIN;
    const wM = 2 * (ox + MARGIN), hM = 2 * (oy + MARGIN);
    ppm = Math.min(ppm, 4096 / hM, 4096 / wM);
    const cw = Math.round(wM * ppm), ch = Math.round(hM * ppm);
    const canvas = makeCanvas(cw, ch);
    const ctx = canvas.getContext('2d');
    const img = ctx.createImageData(cw, ch);
    const data = img.data;
    const noise = new Pool.Noise2D(Pool.hashString(world.id) ^ 0x2b1d);
    const inv = 1 / ppm;
    const W = world;
    const lampC = W.lamp, lk = W.lampK, amb = W.ambient;
    const cr = 0.06; // outer corner radius of the table
    for (let py = 0; py < ch; py++) {
      const y = y0 + (py + 0.5) * inv;
      for (let px = 0; px < cw; px++) {
        const x = x0 + (px + 0.5) * inv;
        const ax = Math.abs(x), ay = Math.abs(y);
        let c, light;
        // Signed distance to the table's rounded outer edge.
        const qx = ax - (ox - cr), qy = ay - (oy - cr);
        const outer = Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - cr;
        if (outer > 0) {
          c = floorColor(W, x, y, noise);
          // Soft shadow of the table on the floor, and the lamps' pool of light.
          const sh = 1 - 0.55 * Math.exp(-outer / 0.09);
          light = (amb * 0.75 + lk * 0.9 * lampLight(x, y, -0.8)) * sh;
          light *= 1 - clamp((Math.hypot(x / (ox + MARGIN), y / (oy + MARGIN)) - 0.75) * 0.9, 0, 0.45);
        } else if (ax > hw + CUSHION || ay > hl + CUSHION) {
          c = railColor(W, x, y, ax, ay, hw, hl, noise, outer);
          light = amb + lk * lampLight(x, y, -0.04);
        } else if (ax > hw || ay > hl) {
          // Cushion: cloth over rubber, sloping down to the nose.
          const d = Math.max(ax - hw, ay - hl) / CUSHION; // 0 at the nose, 1 at the back
          const base = W.cushion;
          const k = 0.82 + 0.3 * d + noise.value(x * 300, y * 300) * 0.02;
          c = [base[0] * k, base[1] * k, base[2] * k];
          if (d < 0.08) c = c.map((v) => v * 0.7); // the nose's shadow line
          light = amb + lk * lampLight(x, y, -0.02);
        } else {
          c = clothColor(W, table, x, y, noise);
          light = amb + lk * lampLight(x, y);
        }
        const i = (py * cw + px) * 4;
        data[i] = clamp(c[0] * light * (0.72 + 0.28 * lampC[0] / 255), 0, 255);
        data[i + 1] = clamp(c[1] * light * (0.72 + 0.28 * lampC[1] / 255), 0, 255);
        data[i + 2] = clamp(c[2] * light * (0.72 + 0.28 * lampC[2] / 255), 0, 255);
        data[i + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    // Vector details on top, in table metres.
    ctx.setTransform(ppm, 0, 0, ppm, -x0 * ppm, -y0 * ppm);
    drawTableDetails(ctx, rack, world, ppm);
    return { canvas, x0, y0, w: wM, h: hM, ppm };
  }

  function makeCanvas(w, h) {
    if (typeof OffscreenCanvas !== 'undefined' && typeof document === 'undefined') return new OffscreenCanvas(w, h);
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    return c;
  }

  function floorColor(W, x, y, noise) {
    const A = W.floorA, B = W.floorB;
    let k = 1, c = A;
    switch (W.floor) {
      case 'boards':
      case 'sawdust': {
        // Planks across the room, staggered joints, grain and knots.
        const pw = 0.14, row = Math.floor(y / pw);
        const off = hash2(row, 3, 9) * 1.6;
        const col = Math.floor((x + off) / 1.6);
        const tone = hash2(row, col, 4);
        c = [lerp(A[0], B[0], tone), lerp(A[1], B[1], tone), lerp(A[2], B[2], tone)];
        const fy = y / pw - row;
        const grain = Math.sin((y * 90 + noise.value(x * 3, row * 7) * 6) * 1.0) * 0.05 + noise.value(x * 12, y * 40) * 0.05;
        k = 1 + grain;
        if (fy < 0.04 || fy > 0.96 || Math.abs(((x + off) / 1.6) % 1) < 0.004) k *= 0.55;
        if (W.floor === 'sawdust' && hash2((x * 160) | 0, (y * 160) | 0, 11) > 0.93) { c = [214, 180, 128]; k = 1; }
        break;
      }
      case 'carpet': {
        const t = Math.floor(x / 0.3) + Math.floor(y / 0.3);
        const u = ((x % 0.3) + 0.3) % 0.3 - 0.15, v = ((y % 0.3) + 0.3) % 0.3 - 0.15;
        const diamond = Math.abs(u) + Math.abs(v) < 0.05 ? 1.18 : 1;
        c = t & 1 ? A : B;
        k = diamond * (1 + (hash2((x * 400) | 0, (y * 400) | 0, 5) - 0.5) * 0.12);
        break;
      }
      case 'casino': {
        // Busy casino carpet: tiles of rings and diamonds in gold on wine red.
        const s = 0.24;
        const u = ((x % s) + s) % s - s / 2, v = ((y % s) + s) % s - s / 2;
        const r = Math.hypot(u, v);
        c = B;
        if (Math.abs(r - 0.07) < 0.009) c = [196, 150, 60];
        else if (Math.abs(u) + Math.abs(v) < 0.035) c = [36, 90, 120];
        else if (Math.abs(Math.abs(u) - Math.abs(v)) < 0.006 && r > 0.09) c = A;
        k = 1 + (hash2((x * 400) | 0, (y * 400) | 0, 6) - 0.5) * 0.16;
        break;
      }
      case 'deck': {
        const s = 0.6;
        const u = ((x % s) + s) % s, v = ((y % s) + s) % s;
        const tone = hash2(Math.floor(x / s), Math.floor(y / s), 2);
        c = [lerp(A[0], B[0], tone), lerp(A[1], B[1], tone), lerp(A[2], B[2], tone)];
        k = 1 + noise.value(x * 30, y * 30) * 0.04;
        if (u < 0.008 || v < 0.008) k *= 0.5;
        const rv = Math.hypot(u - 0.04, v - 0.04);
        if (rv < 0.012) k *= rv < 0.007 ? 1.35 : 0.7;
        // A glowing service strip round the table.
        if (W.glow && Math.abs(Math.max(Math.abs(x) - 0.78, Math.abs(y) - 1.4)) < 0.012) { c = W.glow; k = 0.9; }
        break;
      }
      case 'sand': {
        const rip = Math.sin(y * 40 + noise.value(x * 2, y * 2) * 5 + x * 6) * 0.04;
        c = A;
        k = 1 + rip + (hash2((x * 300) | 0, (y * 300) | 0, 8) - 0.5) * 0.14;
        break;
      }
      default:
        c = A;
    }
    return [c[0] * k, c[1] * k, c[2] * k];
  }

  function railColor(W, x, y, ax, ay, hw, hl, noise, outer) {
    // Mitred corners: the long rails own the region where |x| beats |y| relative to the corner.
    const long = ax - hw > ay - hl;
    const along = long ? y : x, across = long ? ax - hw : ay - hl;
    const g = W.grain;
    const base = W.rail, dark = W.railDark;
    let t = 0.5;
    if (g > 0) {
      const ring = Math.sin((across * 140 + noise.fbm(along * 2.2, across * 18 + (long ? 3 : 9), 3) * 7) * 1.0);
      t = 0.5 + ring * 0.5 * g + noise.value(along * 60, across * 600) * g * 0.6;
    } else {
      // Brushed metal.
      t = 0.55 + noise.value(along * 400, across * 4) * 0.12;
    }
    let c = [lerp(dark[0], base[0], t + 0.3), lerp(dark[1], base[1], t + 0.3), lerp(dark[2], base[2], t + 0.3)];
    // Bevelled edges: light on the inner lip, rounded off at the outside.
    const fromInner = across - CUSHION, toOuter = -outer;
    let k = 1;
    if (fromInner < 0.012) k *= 1.18;
    if (toOuter < 0.02) k *= 0.75 + (toOuter / 0.02) * 0.25;
    // Metal or neon trim along the outer edge.
    if (W.trim && toOuter > 0.006 && toOuter < 0.014) { c = W.trim; k = 1.05; }
    // Mitre joint line.
    if (Math.abs(ax - hw - (ay - hl)) < 0.0025 && ax > hw + CUSHION) k *= 0.6;
    return [c[0] * k, c[1] * k, c[2] * k];
  }

  function clothColor(W, table, x, y, noise) {
    const base = W.cloth, dark = W.clothDark;
    // Felt: fine fibres plus a gentle nap running down the table.
    let k = 1 + (hash2((x * 700) | 0, (y * 700) | 0, 1) - 0.5) * 0.06 + noise.value(x * 25, y * 6) * 0.025;
    let c = base;
    // Darker towards the cushions (less light reaches under the rail).
    const edge = Math.min(table.hw - Math.abs(x), table.hl - Math.abs(y));
    k *= 1 - 0.18 * Math.exp(-edge / 0.03);
    switch (W.decor) {
      case 'saloon': {
        // Worn, faded patches where the balls run most, and the odd scorch mark.
        const wear = noise.fbm(x * 3, y * 3, 3);
        if (wear > 0.15) k *= 1 + (wear - 0.15) * 0.32;
        const burn = Math.hypot(x - 0.38, y + 0.9);
        if (burn < 0.018) { c = [40, 30, 18]; k = 1; } else if (burn < 0.03) k *= 0.85;
        break;
      }
      case 'space': {
        // Faint hex-ish grid glowing through the cloth.
        const gx = Math.abs(((x * 10) % 1 + 1) % 1 - 0.5), gy = Math.abs(((y * 10) % 1 + 1) % 1 - 0.5);
        if (gx > 0.48 || gy > 0.48) c = [base[0] * 1.25 + 10, base[1] * 1.3 + 20, base[2] * 1.15];
        break;
      }
      case 'casino': {
        // An embossed medallion in the middle of the cloth.
        const r = Math.hypot(x, y * 1.0);
        if (Math.abs(r - 0.16) < 0.005 || Math.abs(r - 0.135) < 0.0025) k *= 1.14;
        break;
      }
      case 'tournament': {
        const r = Math.hypot(x, y);
        if (r < 0.12 && Math.abs(Math.abs(x) - Math.abs(y)) < 0.004) k *= 1.06;
        break;
      }
      default:
        break;
    }
    // Sand blown in from the beach.
    if (table.sand.length) {
      const s = table.sandAt(x, y);
      if (s > 0) {
        const q = clamp(s / 3.2, 0, 1) * 0.8 * (0.45 + 0.55 * hash2((x * 500) | 0, (y * 500) | 0, 2)) * (0.85 + 0.3 * noise.value(x * 40, y * 40));
        c = [lerp(c[0], 226, q), lerp(c[1], 204, q), lerp(c[2], 150, q)];
      }
    }
    if (dark && edge < 0) c = dark;
    return [c[0] * k, c[1] * k, c[2] * k];
  }

  function drawTableDetails(ctx, rack, W, ppm) {
    const table = rack.table;
    const hw = table.hw, hl = table.hl;
    const px = 1 / ppm;
    // Pockets: dark throats cut through cushion and rail, with liners.
    for (const p of table.pockets) drawPocket(ctx, table, p, W, px);
    // Diamonds (sights) on the rails.
    const dOff = CUSHION + (RAIL - CUSHION) * 0.42;
    const diamonds = [];
    for (let k = 1; k < 8; k++) if (k !== 4) { const y = -hl + (table.L / 8) * k; diamonds.push([-hw - dOff, y], [hw + dOff, y]); }
    for (let k = 1; k < 4; k++) { const x = -hw + (table.W / 4) * k; diamonds.push([x, -hl - dOff], [x, hl + dOff]); }
    for (const [x, y] of diamonds) {
      ctx.fillStyle = rgb(W.diamond);
      if (W.decor === 'space') {
        ctx.shadowColor = rgb(W.glow); ctx.shadowBlur = 6;
      }
      ctx.beginPath();
      if (W.decor === 'casino' || W.decor === 'tournament') {
        const s = 0.009;
        ctx.moveTo(x, y - s); ctx.lineTo(x + s * 0.6, y); ctx.lineTo(x, y + s); ctx.lineTo(x - s * 0.6, y);
      } else ctx.arc(x, y, 0.0065, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.fillStyle = 'rgba(255,255,255,0.5)';
      ctx.beginPath();
      ctx.arc(x - 0.002, y - 0.002, 0.0022, 0, Math.PI * 2);
      ctx.fill();
    }
    // Foot and head spots, and the head string (faint chalk line).
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    for (const y of [table.FOOT_Y ?? -table.L / 4, HEAD_Y]) {
      ctx.beginPath();
      ctx.arc(0, y, 0.006, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.strokeStyle = 'rgba(255,255,255,0.07)';
    ctx.lineWidth = 0.003;
    ctx.beginPath();
    ctx.moveTo(-hw, HEAD_Y); ctx.lineTo(hw, HEAD_Y);
    ctx.stroke();
    // Sand patch rims.
    for (const s of table.sand) {
      ctx.save();
      ctx.translate(s.x, s.y);
      ctx.rotate(s.a);
      ctx.fillStyle = 'rgba(240,222,170,0.12)';
      for (let k = 0; k < 14; k++) {
        const a = hash2(k, 1, s.x * 1000) * Math.PI * 2, rr = 0.85 + hash2(k, 2, s.y * 1000) * 0.4;
        ctx.beginPath();
        ctx.arc(Math.cos(a) * s.rx * rr, Math.sin(a) * s.ry * rr, 0.004, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }
    drawProps(ctx, table, W);
  }

  function drawPocket(ctx, table, p, W, px) {
    const R2 = p.drawR;
    ctx.save();
    // The throat: from jaw to jaw through the cushion and back into the rail.
    const [j1, j2] = p.jaws;
    const back = { x: p.x + p.sx * 0.02, y: p.y + (p.sy || 0) * 0.02 };
    const liner = {
      leather: [44, 30, 20], pro: [18, 18, 20], gold: [214, 172, 84], net: [70, 52, 30], portal: [90, 240, 255],
    }[W.pocket] || [30, 30, 30];
    // Liner (leather/metal) ring round the hole on the rail top.
    const g = ctx.createRadialGradient(back.x, back.y, R2 * 0.6, back.x, back.y, R2 * 1.55);
    g.addColorStop(0, rgb(liner, 1.2));
    g.addColorStop(0.7, rgb(liner, 0.9));
    g.addColorStop(1, rgba(liner, 0));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(back.x, back.y, R2 * 1.5, 0, Math.PI * 2);
    ctx.fill();
    if (W.pocket === 'gold' || W.pocket === 'portal') {
      ctx.strokeStyle = rgba(liner, 0.9);
      ctx.lineWidth = 0.006;
      if (W.pocket === 'portal') { ctx.shadowColor = rgb(liner); ctx.shadowBlur = 10; }
      ctx.beginPath();
      ctx.arc(back.x, back.y, R2 * 1.12, 0, Math.PI * 2);
      ctx.stroke();
      ctx.shadowBlur = 0;
    }
    // The hole itself, with the jaw facings.
    const segs = table.segs.filter((s) => s.kind === 'jaw' && (Math.hypot(s.ax - j1.x, s.ay - j1.y) < 1e-6 || Math.hypot(s.ax - j2.x, s.ay - j2.y) < 1e-6));
    ctx.beginPath();
    ctx.moveTo(j1.x, j1.y);
    const s1 = segs.find((s) => Math.hypot(s.ax - j1.x, s.ay - j1.y) < 1e-6), s2 = segs.find((s) => Math.hypot(s.ax - j2.x, s.ay - j2.y) < 1e-6);
    if (s1) ctx.lineTo(s1.bx, s1.by);
    const a1 = s1 ? Math.atan2(s1.by - back.y, s1.bx - back.x) : 0, a2 = s2 ? Math.atan2(s2.by - back.y, s2.bx - back.x) : 0;
    // Arc round the back of the pocket (the long way, away from the table).
    const mid = Math.atan2(back.y - p.mouth.y, back.x - p.mouth.x);
    const TAU = Math.PI * 2, mod = (v) => ((v % TAU) + TAU) % TAU;
    ctx.arc(back.x, back.y, R2, a1, a2, !(mod(mid - a1) < mod(a2 - a1)));
    if (s2) ctx.lineTo(s2.ax, s2.ay);
    ctx.closePath();
    const hg = ctx.createRadialGradient(back.x, back.y, 0, back.x, back.y, R2 * 1.3);
    const pc = W.pocketColor;
    hg.addColorStop(0, W.pocket === 'portal' ? 'rgb(40,10,80)' : 'rgb(0,0,0)');
    hg.addColorStop(0.65, rgb(pc, 0.6));
    hg.addColorStop(1, rgb(pc, 1.4));
    ctx.fillStyle = hg;
    ctx.fill();
    if (W.pocket === 'net') {
      // Net/bag weave visible inside.
      ctx.save();
      ctx.clip();
      ctx.strokeStyle = 'rgba(160,130,90,0.22)';
      ctx.lineWidth = 0.0018;
      for (let k = -8; k <= 8; k++) {
        ctx.beginPath();
        ctx.moveTo(back.x + k * 0.012 - 0.1, back.y - 0.1); ctx.lineTo(back.x + k * 0.012 + 0.1, back.y + 0.1);
        ctx.moveTo(back.x + k * 0.012 + 0.1, back.y - 0.1); ctx.lineTo(back.x + k * 0.012 - 0.1, back.y + 0.1);
        ctx.stroke();
      }
      ctx.restore();
    }
    // Facing edges catch the light.
    ctx.strokeStyle = rgba(W.cushion.map((v) => v * 1.4), 0.9);
    ctx.lineWidth = 0.003;
    for (const s of [s1, s2]) {
      if (!s) continue;
      ctx.beginPath();
      ctx.moveTo(s.ax, s.ay); ctx.lineTo(s.bx, s.by);
      ctx.stroke();
    }
    ctx.restore();
  }

  // Little world props on the rails and the floor: chalk, drinks, chips...
  function drawProps(ctx, table, W) {
    const hw = table.hw, hl = table.hl;
    const railMid = CUSHION + (RAIL - CUSHION) * 0.55;
    const chalk = (x, y, col, rot = 0.3) => {
      ctx.save();
      ctx.translate(x, y); ctx.rotate(rot);
      ctx.fillStyle = 'rgba(0,0,0,0.3)';
      ctx.fillRect(-0.011 + 0.004, -0.011 + 0.005, 0.022, 0.022);
      ctx.fillStyle = col;
      ctx.fillRect(-0.011, -0.011, 0.022, 0.022);
      ctx.fillStyle = 'rgba(255,255,255,0.25)';
      ctx.fillRect(-0.011, -0.011, 0.022, 0.005);
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.beginPath(); ctx.arc(0, 0, 0.006, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    };
    const glass = (x, y, r, liquid, foam) => {
      ctx.fillStyle = 'rgba(0,0,0,0.3)';
      ctx.beginPath(); ctx.arc(x + 0.008, y + 0.01, r, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = 'rgba(220,235,240,0.55)';
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = liquid;
      ctx.beginPath(); ctx.arc(x, y, r * 0.82, 0, Math.PI * 2); ctx.fill();
      if (foam) { ctx.fillStyle = foam; ctx.beginPath(); ctx.arc(x, y, r * 0.7, 0, Math.PI * 2); ctx.fill(); }
      ctx.fillStyle = 'rgba(255,255,255,0.6)';
      ctx.beginPath(); ctx.arc(x - r * 0.4, y - r * 0.4, r * 0.18, 0, Math.PI * 2); ctx.fill();
    };
    const sideTable = (x, y, r, top) => {
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.beginPath(); ctx.arc(x + 0.03, y + 0.04, r, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = top;
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.3)'; ctx.lineWidth = 0.01;
      ctx.stroke();
    };
    const stool = (x, y, seat) => {
      ctx.fillStyle = 'rgba(0,0,0,0.3)';
      ctx.beginPath(); ctx.arc(x + 0.025, y + 0.03, 0.17, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#2a2a2a';
      ctx.beginPath(); ctx.arc(x, y, 0.17, 0, Math.PI * 2); ctx.fill();
      const g = ctx.createRadialGradient(x - 0.04, y - 0.04, 0.01, x, y, 0.15);
      g.addColorStop(0, rgb(seat, 1.3)); g.addColorStop(1, rgb(seat, 0.7));
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(x, y, 0.15, 0, Math.PI * 2); ctx.fill();
    };
    const ox = hw + RAIL, oy = hl + RAIL;
    switch (W.decor) {
      case 'pub':
        chalk(hw + railMid, hl - 0.25, '#2f6fd6', 0.4);
        // Beer mat and a pint on the head rail corner, a stool and a side table on the floor.
        ctx.fillStyle = '#c8b27a';
        ctx.fillRect(-hw - railMid - 0.035, -hl + 0.42, 0.07, 0.07);
        glass(-hw - railMid, -hl + 0.455, 0.032, '#7a4610', '#efe2c0');
        stool(-ox - 0.42, 0.35, [140, 30, 30]);
        sideTable(ox + 0.45, -0.6, 0.25, '#4a2c16');
        glass(ox + 0.4, -0.66, 0.035, '#5a2f0a', '#f2e6c8');
        glass(ox + 0.52, -0.54, 0.035, '#c88a1e', '#fff6dc');
        break;
      case 'tournament':
        chalk(hw + railMid, hl - 0.2, '#1f5fbf', 0.05);
        chalk(-hw - railMid, -hl + 0.2, '#1f5fbf', 0.05);
        // Referee's towel and a water bottle on a side table; scoreboard strip on the floor.
        sideTable(-ox - 0.45, 0.2, 0.22, '#1b1b22');
        ctx.fillStyle = '#e8e8ee'; ctx.fillRect(-ox - 0.55, 0.12, 0.14, 0.2);
        glass(-ox - 0.34, 0.3, 0.03, 'rgba(160,200,255,0.8)');
        ctx.fillStyle = '#0d0d12'; ctx.fillRect(ox + 0.25, -0.5, 0.18, 1.0);
        ctx.fillStyle = '#ffd640';
        for (let k = 0; k < 6; k++) ctx.fillRect(ox + 0.3, -0.42 + k * 0.15, 0.08, 0.05);
        break;
      case 'casino': {
        chalk(-hw - railMid, hl - 0.3, '#b3262d', -0.3);
        // Stacks of chips on the rail and a cocktail on a side table.
        const chips = (x, y, col) => {
          for (let k = 0; k < 4; k++) {
            ctx.fillStyle = 'rgba(0,0,0,0.25)';
            ctx.beginPath(); ctx.arc(x + k * 0.002 + 0.004, y - k * 0.003 + 0.005, 0.018, 0, Math.PI * 2); ctx.fill();
            ctx.fillStyle = col;
            ctx.beginPath(); ctx.arc(x + k * 0.002, y - k * 0.003, 0.018, 0, Math.PI * 2); ctx.fill();
            ctx.strokeStyle = 'rgba(255,255,255,0.8)'; ctx.lineWidth = 0.003; ctx.setLineDash([0.006, 0.006]);
            ctx.stroke(); ctx.setLineDash([]);
          }
        };
        chips(hw + railMid, -0.35, '#1b4fbf');
        chips(hw + railMid, -0.29, '#c81e2a');
        chips(hw + railMid - 0.002, -0.23, '#111');
        sideTable(-ox - 0.45, -0.4, 0.22, '#3a0c12');
        glass(-ox - 0.45, -0.4, 0.04, '#e0405a');
        ctx.fillStyle = '#ffe066'; ctx.beginPath(); ctx.arc(-ox - 0.43, -0.43, 0.01, 0, Math.PI * 2); ctx.fill();
        break;
      }
      case 'saloon':
        chalk(hw + railMid, hl - 0.3, '#3a7ad0', 0.7);
        // Whisky tumbler and a cowboy hat left on the rail; a barrel on the floor.
        glass(-hw - railMid, 0.55, 0.028, '#b0601a');
        ctx.save();
        ctx.translate(-ox - 0.45, -0.7);
        ctx.fillStyle = 'rgba(0,0,0,0.3)'; ctx.beginPath(); ctx.ellipse(0.03, 0.03, 0.2, 0.17, 0.3, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#6b4424'; ctx.beginPath(); ctx.ellipse(0, 0, 0.2, 0.17, 0.3, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#4e2f16'; ctx.beginPath(); ctx.ellipse(0, 0, 0.11, 0.09, 0.3, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = '#2e1a0a'; ctx.lineWidth = 0.012; ctx.beginPath(); ctx.ellipse(0, 0, 0.07, 0.055, 0.3, 0, Math.PI * 2); ctx.stroke();
        ctx.restore();
        ctx.fillStyle = 'rgba(0,0,0,0.3)'; ctx.beginPath(); ctx.arc(ox + 0.42, 0.55, 0.24, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#7a4a22'; ctx.beginPath(); ctx.arc(ox + 0.4, 0.52, 0.24, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = '#3a3a3a'; ctx.lineWidth = 0.02;
        ctx.beginPath(); ctx.arc(ox + 0.4, 0.52, 0.2, 0, Math.PI * 2); ctx.stroke();
        break;
      case 'space':
        // Holo-panel and a floating drink pouch.
        ctx.save();
        ctx.shadowColor = rgb(W.glow); ctx.shadowBlur = 20;
        ctx.strokeStyle = rgba(W.glow, 0.8); ctx.lineWidth = 0.008;
        ctx.strokeRect(ox + 0.25, -0.6, 0.3, 0.45);
        ctx.fillStyle = rgba(W.glow, 0.12); ctx.fillRect(ox + 0.25, -0.6, 0.3, 0.45);
        ctx.restore();
        ctx.fillStyle = rgba(W.glow, 0.7);
        for (let k = 0; k < 5; k++) ctx.fillRect(ox + 0.29, -0.55 + k * 0.08, 0.06 + hash2(k, 4, 4) * 0.16, 0.02);
        chalk(-hw - railMid, -hl + 0.3, '#7d5cff', -0.2);
        ctx.fillStyle = '#d8dce8'; ctx.fillRect(-ox - 0.5, 0.3, 0.12, 0.18);
        ctx.fillStyle = '#ff6a3d'; ctx.fillRect(-ox - 0.5, 0.3, 0.12, 0.05);
        break;
      case 'beach': {
        chalk(hw + railMid, -hl + 0.35, '#1f8fbf', -0.4);
        // Coconut drink with an umbrella, a shell and a beach towel.
        ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.beginPath(); ctx.arc(-hw - railMid + 0.006, 0.4 + 0.008, 0.03, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#6b4a2a'; ctx.beginPath(); ctx.arc(-hw - railMid, 0.4, 0.03, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#f4f0e6'; ctx.beginPath(); ctx.arc(-hw - railMid, 0.4, 0.022, 0, Math.PI * 2); ctx.fill();
        for (let k = 0; k < 6; k++) {
          ctx.fillStyle = k % 2 ? '#ff4f7a' : '#ffd23f';
          ctx.beginPath(); ctx.moveTo(-hw - railMid + 0.01, 0.39);
          ctx.arc(-hw - railMid + 0.01, 0.39, 0.035, (k / 6) * Math.PI * 2, ((k + 1) / 6) * Math.PI * 2);
          ctx.fill();
        }
        ctx.save();
        ctx.translate(ox + 0.4, 0.1); ctx.rotate(0.15);
        ctx.fillStyle = 'rgba(0,0,0,0.2)'; ctx.fillRect(-0.18 + 0.02, -0.4 + 0.03, 0.36, 0.8);
        for (let k = 0; k < 8; k++) { ctx.fillStyle = k % 2 ? '#2a9df4' : '#fff4e0'; ctx.fillRect(-0.18, -0.4 + k * 0.1, 0.36, 0.1); }
        ctx.restore();
        ctx.fillStyle = '#f6c9b0';
        ctx.beginPath(); ctx.moveTo(-ox - 0.4, -0.5); ctx.arc(-ox - 0.4, -0.5, 0.06, -2.2, -0.9); ctx.fill();
        break;
      }
      default:
        break;
    }
  }

  // ---- Balls ---------------------------------------------------------------------------------------
  function digitMask(n) {
    const S = 64;
    const c = makeCanvas(S, S);
    const g = c.getContext('2d');
    g.fillStyle = '#000';
    g.font = `bold ${n > 9 ? 34 : 42}px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    if (n > 9) g.setTransform(0.82, 0, 0, 1, S * 0.09, 0);
    g.fillText(String(n), S / 2, S / 2 + 2);
    if (n === 6 || n === 9) g.fillRect(S / 2 - 8, S - 12, 16, 3); // underline 6 and 9
    const d = g.getImageData(0, 0, S, S).data;
    const a = new Uint8Array(S * S);
    for (let i = 0; i < S * S; i++) a[i] = d[i * 4 + 3];
    return { S, a };
  }

  const SPOT = 0.36; // number circle angular radius
  const SPOT_COS = Math.cos(SPOT), SPOT_SIN = Math.sin(SPOT);
  const DOT_COS = Math.cos(0.15);

  // Shade one ball into an ImageData of size N×N.  view: {rot} for the screen→world axis mapping.
  function shadeBall(img, N, pr, ball, light, rotView, clothC, digits) {
    const d = img.data;
    const m = ball.rot;
    const n = ball.n;
    const col = ballColor(n);
    const stripe = n > 8;
    const mask = n > 0 ? digits(n) : null;
    const [lx, ly, lz] = light.dir;
    // Half-vector between the way to the lamp (−L) and the way to the viewer straight above (0, 0, −1).
    let hx = -lx, hy = -ly, hz = -lz - 1;
    const hl = Math.hypot(hx, hy, hz); hx /= hl; hy /= hl; hz /= hl;
    const c0 = N / 2;
    for (let j = 0; j < N; j++) {
      for (let i = 0; i < N; i++) {
        const sx = (i + 0.5 - c0) / pr, sy = (j + 0.5 - c0) / pr;
        const r2 = sx * sx + sy * sy;
        const k = (j * N + i) * 4;
        const edge = (1 - Math.sqrt(r2)) * pr + 0.5;
        if (edge <= 0) { d[k + 3] = 0; continue; }
        const rr = Math.min(r2, 1);
        // Screen offset → world normal (z up out of the cloth is −z).
        const nx = rotView ? -sy : sx, ny = rotView ? sx : sy, nz = -Math.sqrt(1 - rr);
        // World → ball-local.
        const ux = m[0] * nx + m[3] * ny + m[6] * nz;
        const uy = m[1] * nx + m[4] * ny + m[7] * nz;
        const uz = m[2] * nx + m[5] * ny + m[8] * nz;
        let cr, cg, cb;
        if (n === 0) {
          cr = 246; cg = 244; cb = 236;
          if (Math.abs(ux) > DOT_COS || Math.abs(uy) > DOT_COS || Math.abs(uz) > DOT_COS) { cr = 200; cg = 30; cb = 36; }
        } else {
          const white = stripe && Math.abs(uz) > 0.52;
          if (white) { cr = 246; cg = 244; cb = 236; } else { cr = col[0]; cg = col[1]; cb = col[2]; }
          const ax = Math.abs(ux);
          if (ax > SPOT_COS) {
            cr = 246; cg = 244; cb = 236;
            // The number, printed flat on the spot.
            const sgn = ux > 0 ? 1 : -1;
            const u = (uy * sgn) / SPOT_SIN, v = uz / SPOT_SIN;
            const tx = ((u * 0.5 + 0.5) * mask.S) | 0, ty = ((-v * 0.5 + 0.5) * mask.S) | 0;
            if (tx >= 0 && ty >= 0 && tx < mask.S && ty < mask.S) {
              const a = mask.a[ty * mask.S + tx] / 255;
              cr = lerp(cr, 18, a); cg = lerp(cg, 18, a); cb = lerp(cb, 20, a);
            }
            // Soft rim of the spot.
            const rim = (ax - SPOT_COS) / (1 - SPOT_COS);
            if (rim < 0.08) { const q = 0.5 + rim * 6; cr = lerp(col[0], cr, q); cg = lerp(col[1], cg, q); cb = lerp(col[2], cb, q); }
          } else if (stripe && Math.abs(Math.abs(uz) - 0.52) < 0.025) {
            // Antialias the stripe edge a little.
            const q = 0.5;
            cr = lerp(cr, white ? col[0] : 246, q * 0.4); cg = lerp(cg, white ? col[1] : 244, q * 0.4); cb = lerp(cb, white ? col[2] : 236, q * 0.4);
          }
        }
        // Lighting: ambient + lamp diffuse + a sharp highlight + reflected cloth near the bottom rim.
        const ndl = Math.max(0, -(nx * lx + ny * ly + nz * lz));
        let shade = light.amb + light.dif * ndl;
        const ndh = Math.max(0, nx * hx + ny * hy + nz * hz);
        const spec = Math.pow(ndh, 48) * 1.0 + Math.pow(ndh, 10) * 0.08;
        const rim = Math.pow(1 - Math.abs(nz), 3);
        cr = cr * shade * (1 - rim * 0.35) + clothC[0] * rim * 0.35 + spec * light.c[0];
        cg = cg * shade * (1 - rim * 0.35) + clothC[1] * rim * 0.35 + spec * light.c[1];
        cb = cb * shade * (1 - rim * 0.35) + clothC[2] * rim * 0.35 + spec * light.c[2];
        d[k] = cr > 255 ? 255 : cr;
        d[k + 1] = cg > 255 ? 255 : cg;
        d[k + 2] = cb > 255 ? 255 : cb;
        d[k + 3] = edge >= 1 ? 255 : edge * 255;
      }
    }
  }

  Renderer.prototype.digitMask = function (n) {
    if (!this.digits.has(n)) this.digits.set(n, digitMask(n));
    return this.digits.get(n);
  };

  // Light seen from a ball at (x, y): direction to the nearest lamp, plus its colour.
  function ballLight(world, x, y) {
    let best = LAMPS[0], bd = Infinity;
    for (const l of LAMPS) { const d = Math.hypot(x - l.x, y - l.y); if (d < bd) { bd = d; best = l; } }
    const dx = x - best.x, dy = y - best.y, dz = LAMP_H; // from lamp to ball (z down)
    const len = Math.hypot(dx, dy, dz);
    const lc = world.lamp;
    return { dir: [dx / len, dy / len, dz / len], amb: 0.34 + world.ambient * 0.25, dif: 0.62 + world.lampK * 0.3, c: [lc[0] * 0.95, lc[1] * 0.95, lc[2] * 0.95] };
  }

  Renderer.prototype.ballSprite = function (ball, world) {
    const pr = R * this.view.s * this.dpr;
    const N = Math.ceil(pr * 2) + 2;
    let sp = this.sprites.get(ball);
    const key = ball.rot.map((v) => v.toFixed(3)).join(',') + '|' + (ball.x * 50 | 0) + ',' + (ball.y * 50 | 0) + '|' + N + '|' + this.view.rot + '|' + ball.n;
    if (sp && sp.key === key) return sp;
    if (!sp || sp.N !== N) {
      const c = makeCanvas(N, N);
      sp = { canvas: c, ctx: c.getContext('2d'), N, img: null, key: '' };
      sp.img = sp.ctx.createImageData(N, N);
      this.sprites.set(ball, sp);
    }
    sp.key = key;
    const light = ballLight(world, ball.x, ball.y);
    shadeBall(sp.img, N, pr, ball, light, this.view.rot, world.cloth, (n) => this.digitMask(n));
    sp.ctx.putImageData(sp.img, 0, 0);
    return sp;
  };

  // A small ball icon (number facing up) for the HUD.
  const iconCache = new Map();
  function ballIcon(n, px, world) {
    const key = n + ':' + px;
    if (iconCache.has(key)) return iconCache.get(key);
    const r = new Renderer(makeCanvas(1, 1));
    r.view = { s: px / (2 * R), rot: false };
    r.dpr = 1;
    const b = { n, x: 0.3, y: -0.45, rot: [1, 0, 0, 0, 1, 0, 0, 0, 1] }; // lit from the top left
    // Turn the number spot (+x) towards the viewer (−z).
    Pool.physics.rotate(b.rot, 0, 1, 0, Math.PI / 2);
    Pool.physics.rotate(b.rot, 0, 0, 1, -Math.PI / 2);
    const sp = r.ballSprite(b, world || Pool.WORLDS.pub);
    const url = sp.canvas.toDataURL ? sp.canvas.toDataURL() : '';
    iconCache.set(key, url);
    return url;
  }

  // ---- Per-frame drawing ------------------------------------------------------------------------
  Renderer.prototype.draw = function (game, t) {
    const ctx = this.ctx;
    const rack = game.rack, world = game.world;
    this.setScreen();
    ctx.fillStyle = world ? rgb(world.floorB, 0.45) : '#0d1a10';
    ctx.fillRect(0, 0, this.vw, this.vh);
    if (!rack || !this.layer) return;
    const L = this.layer;
    this.setWorld();
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(L.canvas, L.x0, L.y0, L.w, L.h);
    const table = rack.table;
    const s = this.view.s;
    const px = 1 / s;

    // Lucky pocket (casino): a pulsing gold ring.
    if (table.lucky >= 0) {
      const p = table.pockets[table.lucky];
      const pulse = 0.5 + 0.5 * Math.sin(t * 3);
      ctx.save();
      ctx.strokeStyle = `rgba(255,214,64,${0.55 + pulse * 0.4})`;
      ctx.lineWidth = 0.006 + pulse * 0.004;
      ctx.shadowColor = '#ffd640';
      ctx.shadowBlur = 12 * this.dpr;
      ctx.beginPath();
      ctx.arc(p.x + p.sx * 0.02, p.y + (p.sy || 0) * 0.02, p.drawR * 1.25, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
      this.text('★', p.x + p.sx * 0.115, p.y + (p.sy || 0) * 0.115 + (p.sy ? 0 : 0), 0.05, '#ffd640');
    }
    // Ball-in-hand: show where the cue ball may go.
    if (game.phase === 'place' && game.handZone === 'kitchen') {
      ctx.fillStyle = 'rgba(255,255,255,0.06)';
      ctx.fillRect(-table.hw, HEAD_Y, table.W, table.hl - HEAD_Y);
      ctx.strokeStyle = 'rgba(255,255,255,0.35)';
      ctx.lineWidth = 2 * px;
      ctx.setLineDash([6 * px, 6 * px]);
      ctx.beginPath(); ctx.moveTo(-table.hw, HEAD_Y); ctx.lineTo(table.hw, HEAD_Y); ctx.stroke();
      ctx.setLineDash([]);
    }
    // Target highlight (rotation racks): a soft ring under the ball you must hit first.
    if (game.targetBall != null && ['aim', 'place', 'backswing', 'downswing'].includes(game.phase)) {
      const b = game.balls.find((q) => q.n === game.targetBall && !q.pocketed);
      if (b) {
        ctx.strokeStyle = `rgba(255,255,255,${0.35 + 0.2 * Math.sin(t * 4)})`;
        ctx.lineWidth = 2 * px;
        ctx.beginPath(); ctx.arc(b.x, b.y, R * 1.55, 0, Math.PI * 2); ctx.stroke();
      }
    }
    // Shadows: one soft shadow per lamp, cast away from it.
    for (const b of game.balls) {
      if (b.pocketed) continue;
      for (const l of LAMPS) {
        const dx = b.x - l.x, dy = b.y - l.y;
        const d = Math.hypot(dx, dy);
        const off = (R * d) / LAMP_H;
        const a = 0.22 * Math.pow(1 + (d * d) / 0.5, -1);
        if (a < 0.03) continue;
        const sx = b.x + (dx / (d || 1)) * off * 0.9, sy = b.y + (dy / (d || 1)) * off * 0.9;
        const g = ctx.createRadialGradient(sx, sy, R * 0.3, sx, sy, R * 1.25);
        g.addColorStop(0, `rgba(0,0,0,${a * 1.6})`);
        g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(sx, sy, R * 1.25, 0, Math.PI * 2); ctx.fill();
      }
    }
    // Aim guide.
    if (game.guide && ['aim', 'backswing', 'downswing'].includes(game.phase)) this.drawGuide(game.guide, game);
    // Balls.
    for (const b of game.balls) {
      if (b.pocketed) continue;
      const sp = this.ballSprite(b, world);
      const r = (sp.N / 2) / (s * this.dpr);
      ctx.drawImage(sp.canvas, b.x - r, b.y - r, 2 * r, 2 * r);
    }
    // Balls dropping into pockets.
    for (const b of game.balls) {
      if (!b.pocketed || b.sinkT >= 1 || !b.sinkFrom) continue;
      const p = table.pockets[b.pocket];
      const q = b.sinkT;
      const bx = lerp(b.sinkFrom.x, p.x + p.sx * 0.02, Math.min(1, q * 1.6)), by = lerp(b.sinkFrom.y, p.y + (p.sy || 0) * 0.02, Math.min(1, q * 1.6));
      const sp = this.ballSprite(b, world);
      const r = (sp.N / 2) / (s * this.dpr) * (1 - q * 0.35);
      ctx.save();
      ctx.beginPath();
      ctx.arc(p.x + p.sx * 0.02, p.y + (p.sy || 0) * 0.02, p.drawR + R * (1 - q), 0, Math.PI * 2);
      ctx.clip();
      ctx.globalAlpha = 1 - q * q;
      ctx.drawImage(sp.canvas, bx - r, by - r, 2 * r, 2 * r);
      ctx.fillStyle = `rgba(0,0,0,${q * 0.7})`;
      ctx.beginPath(); ctx.arc(bx, by, r, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }
    // Ball in hand: a hand ring round the cue ball.
    if (game.phase === 'place') {
      const c = game.cue;
      ctx.strokeStyle = game.placeOk ? 'rgba(120,255,150,0.9)' : 'rgba(255,90,74,0.9)';
      ctx.lineWidth = 2.5 * px;
      ctx.setLineDash([5 * px, 4 * px]);
      ctx.lineDashOffset = -t * 20 * px;
      ctx.beginPath(); ctx.arc(c.x, c.y, R * 2.1, 0, Math.PI * 2); ctx.stroke();
      ctx.setLineDash([]);
      this.text('✋', c.x, c.y - R * 3.6, 0.06, '#fff');
    }
    // Cue stick.
    if (game.cueStick && game.cueStick.alpha > 0) this.drawCue(game.cueStick, game.cueStick.anchor || game.cue, world);
    // Particles.
    for (const p of game.particles) {
      ctx.globalAlpha = clamp(p.life / p.max, 0, 1) * (p.a ?? 0.8);
      ctx.fillStyle = p.color;
      ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;
  };

  // Upright text at a world position (stays readable when the view is turned).
  Renderer.prototype.text = function (str, x, y, size, color) {
    const ctx = this.ctx;
    const p = this.toScreen(x, y);
    ctx.save();
    this.setScreen();
    ctx.font = `${Math.max(10, size * this.view.s)}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = color;
    ctx.shadowColor = 'rgba(0,0,0,0.6)';
    ctx.shadowBlur = 4;
    ctx.fillText(str, p.x, p.y);
    ctx.restore();
  };

  Renderer.prototype.drawGuide = function (gd, game) {
    const ctx = this.ctx;
    const px = 1 / this.view.s;
    const c = game.cue;
    ctx.save();
    ctx.lineCap = 'round';
    const end = gd.ball ? gd.ghost : gd.cushion;
    // Cue ball path.
    ctx.strokeStyle = 'rgba(255,255,255,0.55)';
    ctx.lineWidth = 1.5 * px;
    ctx.setLineDash([7 * px, 6 * px]);
    ctx.beginPath(); ctx.moveTo(c.x, c.y); ctx.lineTo(end.x, end.y); ctx.stroke();
    ctx.setLineDash([]);
    if (gd.ball) {
      // Ghost ball where the cue ball makes contact.
      ctx.strokeStyle = 'rgba(255,255,255,0.75)';
      ctx.lineWidth = 1.3 * px;
      ctx.beginPath(); ctx.arc(gd.ghost.x, gd.ghost.y, R, 0, Math.PI * 2); ctx.stroke();
      const legal = gd.legal !== false;
      // Object ball line, coloured by whether it's on for a pocket.
      const ob = gd.ball;
      const len = gd.objLen;
      const ex = ob.x + Math.cos(gd.objDir) * len, ey = ob.y + Math.sin(gd.objDir) * len;
      const grad = ctx.createLinearGradient(ob.x, ob.y, ex, ey);
      const col = !legal ? '255,90,74' : gd.pot ? '120,255,150' : '255,255,255';
      grad.addColorStop(0, `rgba(${col},0.9)`);
      grad.addColorStop(1, `rgba(${col},0)`);
      ctx.strokeStyle = grad;
      ctx.lineWidth = 2.2 * px;
      ctx.beginPath(); ctx.moveTo(ob.x, ob.y); ctx.lineTo(ex, ey); ctx.stroke();
      // Cue ball's tangent (stun) line, bent by follow or draw.
      const cl = gd.cueLen;
      const cx2 = gd.ghost.x + Math.cos(gd.cueDir) * cl, cy2 = gd.ghost.y + Math.sin(gd.cueDir) * cl;
      const g2 = ctx.createLinearGradient(gd.ghost.x, gd.ghost.y, cx2, cy2);
      g2.addColorStop(0, 'rgba(160,210,255,0.75)');
      g2.addColorStop(1, 'rgba(160,210,255,0)');
      ctx.strokeStyle = g2;
      ctx.lineWidth = 1.5 * px;
      ctx.beginPath(); ctx.moveTo(gd.ghost.x, gd.ghost.y); ctx.lineTo(cx2, cy2); ctx.stroke();
      if (!legal) {
        ctx.strokeStyle = 'rgba(255,90,74,0.9)';
        ctx.lineWidth = 2 * px;
        const r2 = R * 1.3;
        ctx.beginPath(); ctx.moveTo(ob.x - r2, ob.y - r2); ctx.lineTo(ob.x + r2, ob.y + r2); ctx.moveTo(ob.x + r2, ob.y - r2); ctx.lineTo(ob.x - r2, ob.y + r2); ctx.stroke();
      }
      if (gd.pot) {
        const p = gd.pot;
        ctx.strokeStyle = 'rgba(120,255,150,0.8)';
        ctx.lineWidth = 2 * px;
        ctx.beginPath(); ctx.arc(p.x + p.sx * 0.02, p.y + (p.sy || 0) * 0.02, p.drawR * 1.1, 0, Math.PI * 2); ctx.stroke();
      }
    } else if (gd.cushion) {
      const bx = gd.cushion.x + Math.cos(gd.bounceDir) * 0.25, by = gd.cushion.y + Math.sin(gd.bounceDir) * 0.25;
      const g = ctx.createLinearGradient(gd.cushion.x, gd.cushion.y, bx, by);
      g.addColorStop(0, 'rgba(255,255,255,0.5)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.strokeStyle = g;
      ctx.lineWidth = 1.5 * px;
      ctx.setLineDash([7 * px, 6 * px]);
      ctx.beginPath(); ctx.moveTo(gd.cushion.x, gd.cushion.y); ctx.lineTo(bx, by); ctx.stroke();
      ctx.setLineDash([]);
    }
    ctx.restore();
  };

  // The cue: tip, ferrule, maple shaft, joint, butt with wrap and inlaid points.
  Renderer.prototype.drawCue = function (cs, cue, world) {
    const ctx = this.ctx;
    ctx.save();
    ctx.globalAlpha = cs.alpha;
    const ang = cs.angle;
    const back = R + 0.004 + cs.pull;
    // Shadow first (the cue is raised above the cloth).
    for (const pass of [0, 1]) {
      ctx.save();
      ctx.translate(cue.x - Math.cos(ang) * back, cue.y - Math.sin(ang) * back);
      ctx.rotate(ang + Math.PI);
      if (pass === 0) {
        ctx.translate(0.012, 0.035);
        ctx.fillStyle = 'rgba(0,0,0,0.28)';
        ctx.beginPath();
        ctx.moveTo(0, -0.006); ctx.lineTo(CUE_LEN, -0.016); ctx.lineTo(CUE_LEN, 0.016); ctx.lineTo(0, 0.006);
        ctx.fill();
        ctx.restore();
        continue;
      }
      const wAt = (d) => 0.0065 + (d / CUE_LEN) * 0.0085;
      const band = (d0, d1, fill) => {
        ctx.fillStyle = fill;
        ctx.beginPath();
        ctx.moveTo(d0, -wAt(d0)); ctx.lineTo(d1, -wAt(d1)); ctx.lineTo(d1, wAt(d1)); ctx.lineTo(d0, wAt(d0));
        ctx.closePath();
        ctx.fill();
      };
      const shade = (c1, c2) => {
        const g = ctx.createLinearGradient(0, -0.016, 0, 0.016);
        g.addColorStop(0, c2); g.addColorStop(0.35, c1); g.addColorStop(0.55, c1); g.addColorStop(1, c2);
        return g;
      };
      band(0, 0.009, shade('#3a6ec8', '#1e3c74')); // chalked tip
      band(0.009, 0.03, shade('#f6f2ea', '#b8b2a4')); // ferrule
      band(0.03, 0.74, shade('#e8d2a6', '#a8875a')); // maple shaft
      band(0.74, 0.765, shade('#d8dce4', '#7c808a')); // joint
      const butt = world && world.decor === 'space' ? ['#2b2f3a', '#0d0f14'] : world && world.decor === 'casino' ? ['#5a1218', '#2a0608'] : ['#4a2a16', '#22120a'];
      band(0.765, 1.0, shade(butt[0], butt[1])); // forearm
      // Inlaid points.
      ctx.fillStyle = world && world.decor === 'space' ? rgb(world.glow) : '#e9dcc0';
      for (const sgn of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(0.78, 0); ctx.lineTo(0.93, sgn * wAt(0.9) * 0.9); ctx.lineTo(0.96, 0);
        ctx.fill();
      }
      band(1.0, 1.26, shade('#2a2a2e', '#0c0c0e')); // wrap
      ctx.strokeStyle = 'rgba(255,255,255,0.07)';
      ctx.lineWidth = 0.002;
      for (let d = 1.005; d < 1.26; d += 0.008) { ctx.beginPath(); ctx.moveTo(d, -wAt(d)); ctx.lineTo(d + 0.004, wAt(d)); ctx.stroke(); }
      band(1.26, 1.45, shade(butt[0], butt[1])); // butt sleeve
      band(1.45, CUE_LEN, shade('#151515', '#000')); // bumper
      // A sliver of light along the top of the shaft.
      ctx.fillStyle = 'rgba(255,255,255,0.18)';
      ctx.fillRect(0.03, -0.0035, 0.71, 0.0015);
      ctx.restore();
    }
    ctx.restore();
  };

  // The spin picker: the cue ball seen from behind with the tip contact point.
  function drawSpinPicker(canvas, a, b, risk, dpr) {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (canvas.width !== Math.round(w * dpr)) { canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr); }
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const r = Math.min(w, h) / 2 - 3, cx = w / 2, cy = h / 2;
    const g = ctx.createRadialGradient(cx - r * 0.35, cy - r * 0.4, r * 0.1, cx, cy, r);
    g.addColorStop(0, '#ffffff'); g.addColorStop(0.7, '#e9e6dc'); g.addColorStop(1, '#a9a597');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
    // Safe zone and the miscue limit.
    ctx.strokeStyle = 'rgba(0,0,0,0.18)';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(cx, cy, r * 0.5, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(cx - r, cy); ctx.lineTo(cx + r, cy); ctx.moveTo(cx, cy - r); ctx.lineTo(cx, cy + r); ctx.stroke();
    ctx.strokeStyle = 'rgba(232,50,43,0.45)';
    ctx.setLineDash([3, 3]);
    ctx.beginPath(); ctx.arc(cx, cy, r * Pool.physics.MAX_TIP, 0, Math.PI * 2); ctx.stroke();
    ctx.setLineDash([]);
    const tx = cx + a * r, ty = cy - b * r;
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.beginPath(); ctx.arc(tx + 1, ty + 1.5, 5.5, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = risk > 0.15 ? '#e8322b' : '#2f6fd6';
    ctx.beginPath(); ctx.arc(tx, ty, 5.5, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ctx.beginPath(); ctx.arc(tx - 1.5, ty - 1.5, 1.8, 0, Math.PI * 2); ctx.fill();
  }

  Pool.render = { Renderer, buildLayer, ballIcon, drawSpinPicker, lampLight, LAMPS };
})();
