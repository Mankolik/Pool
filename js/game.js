// Game controller: state machine, stroke meter, ball in hand, spin, input, camera, HUD, scoring and
// persistence.
(function () {
  const Pool = globalThis.Pool;
  const { physics: P, render: Rn, audio, rules: Rules, ai: AI } = Pool;
  const T = Pool.table;
  const { clamp, lerp } = Pool.util;
  const R = T.R;

  const $ = (id) => document.getElementById(id);
  const els = {
    canvas: $('game'), twist: $('twist-canvas'), twistLabel: $('twist-label'),
    rackTitle: $('rack-title'), rackSub: $('rack-sub'), stroke: $('stroke-label'), score: $('score-label'),
    status: $('status-label'), tray: $('tray'), info: $('info-strip'),
    toast: $('toast'), controls: $('controls'), shoot: $('shoot-btn'), swingZone: $('swing-zone'),
    spinRow: $('spin-row'), spinCanvas: $('spin-canvas'), spinTitle: $('spin-title'), spinInfo: $('spin-info'),
    aimLeft: $('aim-left'), aimRight: $('aim-right'),
    records: $('records'), recordsBody: $('records-body'), btnRecords: $('btn-records'), btnRecordsClose: $('btn-records-close'),
    menu: $('menu'), seed: $('seed-input'), dice: $('btn-dice'), preview: $('tour-preview'), play: $('btn-play'),
    continueWrap: $('continue-wrap'), continueBtn: $('btn-continue'), continueInfo: $('continue-info'),
    loading: $('loading'), scorecard: $('scorecard'), scTitle: $('sc-title'), scTour: $('sc-tour'),
    scResult: $('sc-result'), scTable: $('sc-table'), scButtons: $('sc-buttons'),
    btnMenu: $('btn-menu'), btnCard: $('btn-card'), btnRules: $('btn-rules'), btnSound: $('btn-sound'), btnMusic: $('btn-music'),
    btnQuick: $('btn-quick'), quickMenu: $('quick-menu'), btnNextTrack: $('btn-next-track'), btnZoom: $('btn-zoom'),
    hudTop: $('hud-top'), hud: $('hud'), notify: $('notify'), sideButtons: $('side-buttons'),
  };

  const DRAW_TIME = 1.1; // seconds from address to full pace
  // The marker returns to the line in about the same time for every stroke, so soft shots get a slower
  // marker and a wider window rather than a frantic one.
  const RETURN_TIME = (p) => 0.55 + 0.2 * p;
  const OVERSHOOT = -0.16; // how far past the line the marker travels before a forced mistime
  const MAX_PULL = 0.2; // how far the cue draws back at full pace (m)
  const SAVE_KEY = 'pool.save.v1';
  const ROUNDS_KEY = 'pool.tours.v1';
  const MAX_ROUNDS = 300;
  const DEG = Math.PI / 180;

  const SPINS = [
    { id: 'centre', label: 'Centre', a: 0, b: 0 },
    { id: 'follow', label: 'Follow', a: 0, b: 0.4 },
    { id: 'stun', label: 'Stun', a: 0, b: -0.15 },
    { id: 'draw', label: 'Draw', a: 0, b: -0.45 },
    { id: 'left', label: '◀ Side', a: -0.38, b: 0 },
    { id: 'right', label: 'Side ▶', a: 0.38, b: 0 },
  ];

  const game = {
    tour: null, rackIdx: 0, rack: null, world: null, balls: [], cue: null, sim: null,
    scores: [], phase: 'menu', inRound: false,
    strokes: 0, penalties: 0, bonus: 0,
    aim: -Math.PI / 2, spinA: 0, spinB: 0,
    power: 0, marker: 0, lockedPower: 0, lastPower: 0.4, sweet: 0.03, returnSpeed: 1, error: 0, topHold: 0, strikeT: 0,
    cueStick: { angle: -Math.PI / 2, pull: 0, alpha: 1 }, guide: null, guideKey: '',
    particles: [], handZone: 'kitchen', placeOk: true, targetBall: null, shot: null,
    fastForward: false, settleT: 0, afterSettle: null,
    zoom: 1, zoomTarget: 1, focus: { x: 0, y: 0 }, pace: null, paceKey: '', paceAt: 0,
    aimHold: 0, aimHoldT: 0, dpr: 1, renderer: null, area: { l: 0, r: 100, t: 0, b: 100 }, meterRect: null,
  };
  game.renderer = new Rn.Renderer(els.canvas);

  // ---------------------------------------------------------------------------------------------
  // Layout
  let layerBase = 0, layerFor = null;
  function resize() {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const standalone = window.matchMedia('(display-mode: standalone)').matches || !!navigator.standalone;
    const fullH = vh >= vw ? Math.max(screen.width, screen.height) : Math.min(screen.width, screen.height);
    document.documentElement.classList.toggle('short-viewport', standalone && fullH - vh > 30);
    game.dpr = Math.min(window.devicePixelRatio || 1, 2);
    game.renderer.resize(vw, vh, game.dpr);
    const hud = els.info.getBoundingClientRect(); // the message line may overlap the foot rail
    const ctl = els.controls.getBoundingClientRect();
    const side = ctl.left > vw * 0.4; // landscape phone: controls in a right-hand column
    // Room for the meter above the controls.
    const meterH = 46;
    game.meterRect = { x: ctl.left + 12, w: ctl.width - 24, y: ctl.top - meterH + 10 };
    game.area = side
      ? { l: 4, r: ctl.left - 4, t: hud.bottom + 4, b: vh - 4 }
      : { l: 0, r: vw, t: hud.bottom + 4, b: ctl.top - meterH };
    if (side) game.meterRect.y = Math.max(hud.top, ctl.top - meterH + 10);
    const top = els.hudTop.getBoundingClientRect().bottom + 6;
    els.sideButtons.style.top = top + 'px';
    els.quickMenu.style.top = top + 'px';
    els.quickMenu.style.left = els.sideButtons.getBoundingClientRect().right + 8 + 'px';
    fitView(true);
    requestAnimationFrame(fitMessageLine);
  }
  function fitMessageLine() {
    const hud = els.hud.getBoundingClientRect();
    const side = els.sideButtons.getBoundingClientRect().right - hud.left + 8;
    const centred = hud.width - 2 * side >= 300;
    els.notify.style.alignSelf = centred ? '' : 'flex-start';
    els.notify.style.marginLeft = centred ? '' : side + 'px';
    els.notify.style.width = (centred ? hud.width - 2 * side : hud.width - side) + 'px';
  }
  // Camera: fit the table, zoomed towards the cue ball when asked.  Rebuilds the table layer when the
  // scale changes a lot (rotation, resize) or a new rack starts.
  function fitView(force) {
    const r = game.renderer;
    const v = r.fit(game.area, game.zoom, game.focus);
    if (!game.rack) return;
    const key = game.world.id + (game.rack.table.sand.length ? ':' + game.rackIdx : '');
    if (force || !r.layer || layerFor !== key || Math.abs(v.base / layerBase - 1) > 0.15) {
      if (force && r.layer && layerFor === key && Math.abs(v.base / layerBase - 1) < 0.02) return;
      layerBase = v.base;
      layerFor = key;
      r.layer = Rn.buildLayer(game.rack, game.world, v.base * game.dpr * 1.4);
      r.sprites.clear();
    }
  }
  let resizeTimer = null;
  window.addEventListener('resize', () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(resize, 120); });
  window.addEventListener('orientationchange', () => setTimeout(resize, 250));

  // ---------------------------------------------------------------------------------------------
  // Tour / rack flow
  function randomSeed() {
    const syll = ['ka', 'lo', 'mi', 'ra', 'ven', 'to', 'sa', 'bri', 'dun', 'el', 'mor', 'fi', 'gal', 'nor', 'pe', 'wyn', 'cue', 'zo'];
    let s = '';
    for (let i = 0; i < 3; i++) s += syll[Math.floor(Math.random() * syll.length)];
    return s + Math.floor(Math.random() * 90 + 10);
  }

  function startTour(seed, rackIdx = 0, scores = []) {
    game.tour = Pool.generateTour(seed);
    game.world = game.tour.world;
    game.scores = scores.slice();
    game.inRound = true;
    game.seenIntro = false;
    hideMenu();
    startRack(rackIdx);
  }

  function startRack(i) {
    game.rackIdx = i;
    game.phase = 'loading';
    els.loading.classList.remove('hidden');
    els.scorecard.classList.add('hidden');
    setTimeout(() => {
      const rack = game.tour.getRack(i);
      game.rack = rack;
      if (Pool.music) Pool.music.play(game.world.id);
      const rng = new Pool.RNG(rack.table.lucky * 7 + i * 131 + 17);
      game.balls = rack.balls.map((b) => P.createBall(b.n, b.x, b.y, rng));
      game.cue = P.createBall(0, rack.cueStart.x, rack.cueStart.y, rng);
      game.balls.unshift(game.cue);
      game.sim = P.createSim(rack.table, game.world.env, game.balls);
      game.strokes = 0;
      game.penalties = 0;
      game.bonus = 0;
      game.particles = [];
      game.zoom = game.zoomTarget = 1;
      game.focus = { x: game.cue.x, y: game.cue.y };
      game.spinA = 0; game.spinB = 0;
      for (const k of ['result', 'strike', 'foul', 'pot', 'rule', 'swing', 'hint']) dismiss(k);
      fitView(true);
      els.loading.classList.add('hidden');
      save();
      buildTwist();
      updateSpinUi();
      const info = rack.info;
      toast(`Rack ${i + 1} · ${info.name}`, `Par ${rack.par} · ${game.balls.length - 1} balls`, 2200);
      if (!game.seenIntro) {
        game.seenIntro = true;
        const w = game.world;
        setTimeout(() => notify(`${w.emoji} ${w.label}: ${w.twist || w.blurb}`, { key: 'world', ms: 6000, pri: 2 }), 400);
      }
      setTimeout(() => notify(info.rule, { key: 'rule', ms: 6000, pri: 1 }), game.seenIntro && i > 0 ? 300 : 3000);
      beginPlace(rack.hand);
      updateHud(true);
    }, 30);
  }

  function liveBalls() {
    return game.balls.filter((b) => b.n !== 0 && !b.pocketed);
  }
  function lowestLive() {
    const l = liveBalls();
    return l.length ? Math.min(...l.map((b) => b.n)) : null;
  }
  function legalFirst(n) {
    const rack = game.rack;
    if (rack.order === 'lowest') return n === lowestLive();
    return true;
  }

  // Ball in hand: drag the cue ball, then confirm.
  function beginPlace(zone) {
    game.phase = 'place';
    game.handZone = zone;
    const c = game.cue;
    c.pocketed = false;
    c.moving = false;
    c.vx = c.vy = c.wx = c.wy = c.wz = 0;
    c.sinkT = 1;
    const want = Number.isFinite(c.x) && T.placeOk(game.rack.table, game.balls, c.x, c.y, zone) ? c : { x: game.rack.cueStart.x, y: game.rack.cueStart.y };
    const p = T.nearestPlace(game.rack.table, game.balls, want.x, want.y, zone) || { x: 0, y: T.L * 0.3 };
    c.x = p.x; c.y = p.y;
    game.placeOk = true;
    game.targetBall = game.rack.order === 'lowest' ? lowestLive() : null;
    suggestAim(true);
    notify(zone === 'kitchen' ? 'Ball in hand behind the line — drag to place, then tap PLACE' : 'Ball in hand — drag the cue ball anywhere, then tap PLACE', { key: 'hint', ms: 4500, pri: 1 });
  }
  function confirmPlace() {
    if (game.phase !== 'place') return;
    if (!game.placeOk) {
      notify("The cue ball can't go there", { key: 'hint', level: 'warn', ms: 2000, pri: 2 });
      return;
    }
    audio.play('place');
    dismiss('hint');
    beginAim();
  }

  function beginAim() {
    game.phase = 'aim';
    game.targetBall = game.rack.order === 'lowest' ? lowestLive() : null;
    game.cueStick.alpha = 0;
    game.cueStick.pull = 0.08;
    game.cueStick.anchor = null;
    suggestAim(false);
    game.cueStick.angle = game.aim;
    updateGuide(true);
  }

  // Point the cue at the easiest pot (or the break / a safe hit when nothing is on).
  function suggestAim(quiet) {
    const rack = game.rack;
    if (rack.isBreak && game.strokes === 0) {
      const s = AI.breakShot(rack, game.balls);
      game.aim = s.angle;
      if (!quiet) notify('The break: hit it hard and square into the rack', { key: 'hint', ms: 3500, pri: 1 });
      return;
    }
    const shots = AI.findShots(rack, game.balls);
    if (shots.length) {
      game.aim = shots[0].angle;
      if (!quiet && shots[0].combo != null) notify(`Combination: the ${shots[0].combo} into the ${shots[0].ball}`, { key: 'hint', ms: 3000, pri: 0 });
      return;
    }
    const f = AI.fallbackShot(rack, game.balls);
    if (f) {
      game.aim = f.angle;
      if (!quiet) notify('Nothing clean on — hit the ball and leave yourself a shot', { key: 'hint', level: 'warn', ms: 3500, pri: 1 });
    }
  }

  // ---------------------------------------------------------------------------------------------
  // Aim guide
  function updateGuide(force) {
    if (!game.rack || !game.cue) return;
    const key = game.aim.toFixed(5) + '|' + game.spinA.toFixed(3) + '|' + game.spinB.toFixed(3) + '|' + game.cue.x.toFixed(4) + game.cue.y.toFixed(4);
    if (!force && key === game.guideKey) return;
    game.guideKey = key;
    const table = game.rack.table;
    const tr = P.traceAim(table, game.balls, game.cue, game.aim);
    const gd = { ...tr, legal: true, pot: null, objLen: 0.5, cueLen: 0.2 };
    if (tr.ball) {
      gd.legal = legalFirst(tr.ball.n);
      const pk = P.pocketAlong(table, tr.ball.x, tr.ball.y, tr.objDir);
      if (pk && AI.pathClear(game.balls, tr.ball.x, tr.ball.y, pk.pocket.x, pk.pocket.y, [tr.ball, game.cue])) gd.pot = pk.pocket;
      gd.objLen = pk && gd.pot ? Math.min(0.6, pk.dist) : 0.45;
      // Where the cue ball heads after contact: run its approach, then let follow/draw take over.
      const after = cueAfterContact(tr);
      if (after) { gd.cueDir = after.dir; gd.cueLen = 0.1 + 0.3 * after.k; }
    }
    game.guide = gd;
  }
  function cueAfterContact(tr) {
    const c = { ...game.cue, rot: game.cue.rot };
    const sim = P.createSim(game.rack.table, game.world.env, [c]);
    sim.trackRot = false;
    const p = game.phase === 'aim' ? game.lastPower : game.lockedPower || game.power || game.lastPower;
    P.strike(c, game.aim, P.speedFor(Math.max(0.15, p)), game.spinA, game.spinB);
    const x0 = c.x, y0 = c.y;
    for (let i = 0; i < 2000; i++) {
      if (Math.hypot(c.x - x0, c.y - y0) >= tr.t || !c.moving) break;
      P.step(sim, 1 / 240);
    }
    if (!c.moving) return null;
    const nx = Math.cos(tr.objDir), ny = Math.sin(tr.objDir);
    const vn = c.vx * nx + c.vy * ny;
    const ax = c.vx - vn * nx * 0.97, ay = c.vy - vn * ny * 0.97; // what's left after passing on the normal part
    const qx = -R * c.wy, qy = R * c.wx; // the velocity its spin would roll it at
    const fx = (5 * ax + 2 * qx) / 7, fy = (5 * ay + 2 * qy) / 7;
    const sp = Math.hypot(fx, fy);
    if (sp < 0.02) return { dir: tr.cueDir, k: 0 };
    return { dir: Math.atan2(fy, fx), k: clamp(sp / Math.max(0.3, Math.hypot(c.vx, c.vy)), 0, 1) };
  }
  // The red pace mark: the slowest stroke that still drops the ball (simulated, throttled).
  function updatePace(now) {
    const gd = game.guide;
    if (!gd || !gd.ball || !gd.pot || !gd.legal) { game.pace = null; game.paceKey = ''; return; }
    const key = game.guideKey;
    if (key === game.paceKey || now - game.paceAt < 140) return;
    game.paceKey = key;
    game.paceAt = now;
    game.pace = P.potPower(game.rack.table, game.world.env, game.balls, 0, gd.ball.n, gd.pot.id, game.aim, game.spinA, game.spinB);
  }

  // ---------------------------------------------------------------------------------------------
  // Spin
  function tipRadius() { return Math.hypot(game.spinA, game.spinB); }
  function miscueRisk(e = 0) {
    const r = tipRadius();
    const base = r < 0.35 ? 0 : Math.pow((r - 0.35) / (P.MAX_TIP - 0.35), 2) * 0.3;
    return clamp(base + Math.abs(e) * clamp((r - 0.2) / 0.4, 0, 1) * 0.35, 0, 0.9);
  }
  function spinName() {
    const a = game.spinA, b = game.spinB;
    let v = b > 0.08 ? 'Follow' : b < -0.24 ? 'Draw' : b < -0.07 ? 'Stun' : '';
    const side = a > 0.08 ? 'right' : a < -0.08 ? 'left' : '';
    if (!v && !side) return 'Centre ball';
    const tips = (x) => {
      const t = Math.round((Math.abs(x) / 0.2) * 2) / 2;
      return t <= 0.5 ? '½ tip' : `${t % 1 ? Math.floor(t) + '½' : t} tips`;
    };
    if (v && side) return `${v} + ${side}`;
    if (side) return `${side === 'left' ? 'Left' : 'Right'} side · ${tips(a)}`;
    return `${v} · ${tips(b)}`;
  }
  const spinButtons = {};
  function buildSpinRow() {
    els.spinRow.innerHTML = '';
    for (const s of SPINS) {
      const b = document.createElement('button');
      b.className = 'spin-btn';
      b.textContent = s.label;
      b.setAttribute('role', 'radio');
      b.addEventListener('click', () => setSpin(s.a, s.b));
      els.spinRow.append(b);
      spinButtons[s.id] = b;
    }
  }
  function setSpin(a, b) {
    if (!['aim', 'place'].includes(game.phase)) return;
    const r = Math.hypot(a, b);
    if (r > P.MAX_TIP) { a *= P.MAX_TIP / r; b *= P.MAX_TIP / r; }
    game.spinA = a;
    game.spinB = b;
    updateSpinUi();
    updateGuide();
  }
  function updateSpinUi() {
    for (const s of SPINS) {
      const on = Math.abs(s.a - game.spinA) < 0.02 && Math.abs(s.b - game.spinB) < 0.02;
      spinButtons[s.id].classList.toggle('active', on);
      spinButtons[s.id].setAttribute('aria-checked', on ? 'true' : 'false');
    }
    els.spinTitle.textContent = spinName();
    const risk = miscueRisk();
    const tips = ['aim', 'place'].includes(game.phase) ? '' : '';
    els.spinInfo.textContent = (risk > 0 ? `⚠ miscue ${Math.round(risk * 100)}%` : 'no miscue risk') + tips;
    els.spinInfo.classList.toggle('risky', risk > 0.1);
    Rn.drawSpinPicker(els.spinCanvas, game.spinA, game.spinB, risk, game.dpr);
  }
  {
    let dragging = false;
    const pick = (e) => {
      const r = els.spinCanvas.getBoundingClientRect();
      const rad = Math.min(r.width, r.height) / 2 - 3;
      let a = (e.clientX - (r.left + r.width / 2)) / rad, b = -(e.clientY - (r.top + r.height / 2)) / rad;
      // Snap gently to the axes so pure follow/draw/side are easy to hit.
      if (Math.abs(a) < 0.05) a = 0;
      if (Math.abs(b) < 0.05) b = 0;
      setSpin(Math.round(a * 50) / 50, Math.round(b * 50) / 50);
    };
    els.spinCanvas.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      audio.unlock();
      dragging = true;
      try { els.spinCanvas.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
      pick(e);
    });
    els.spinCanvas.addEventListener('pointermove', (e) => { if (dragging) pick(e); });
    const end = () => { dragging = false; };
    els.spinCanvas.addEventListener('pointerup', end);
    els.spinCanvas.addEventListener('pointercancel', end);
    // Tapping the label area cycles through the presets.
    $('spin-name').addEventListener('click', () => {
      const i = SPINS.findIndex((s) => Math.abs(s.a - game.spinA) < 0.02 && Math.abs(s.b - game.spinB) < 0.02);
      const s = SPINS[(i + 1) % SPINS.length];
      setSpin(s.a, s.b);
    });
  }

  // ---------------------------------------------------------------------------------------------
  // Stroke
  function pressShoot() {
    audio.unlock();
    if (game.phase === 'place') {
      confirmPlace();
    } else if (game.phase === 'aim') {
      game.phase = 'backswing';
      game.power = 0;
      game.topHold = 0;
      dismiss('result');
      notify('Release to set the pace', { key: 'swing', ms: 1600, pri: 0 });
    } else if (game.phase === 'downswing') {
      strike(game.marker);
    } else if (game.phase === 'roll') {
      game.fastForward = true;
    }
  }
  function releaseShoot() {
    game.fastForward = false;
    if (game.phase === 'backswing') lockPower();
  }
  function lockPower() {
    game.lockedPower = Math.max(game.power, 0.02);
    game.marker = game.lockedPower;
    const p = game.lockedPower;
    game.returnSpeed = Math.max(0.12, p / RETURN_TIME(p));
    // Hard strokes and big tip offsets need a cleaner delivery.
    game.sweet = 0.032 * (1 - 0.35 * p) * (1 - 0.4 * Math.min(1, tipRadius() / P.MAX_TIP));
    game.phase = 'downswing';
    notify('Tap at the white line!', { key: 'swing', ms: 1600, pri: 0 });
  }
  function strike(m) {
    let e = 0;
    const sweet = game.sweet;
    if (Math.abs(m) > sweet) e = Math.sign(m) * Math.min(1, (Math.abs(m) - sweet) / (Math.abs(OVERSHOOT) - sweet));
    game.error = e;
    game.marker = m;
    game.phase = 'strike';
    game.strikeT = 0;
    game.strikeFrom = game.cueStick.pull;
    dismiss('swing');
    const sk = { key: 'strike', pri: 2 };
    if (e === 0) notify('Pure cue action', { ...sk, level: 'good', ms: 2000 });
    else if (Math.abs(e) < 0.35) notify(e > 0 ? 'A touch early — pushed right' : 'A touch late — pulled left', { ...sk, level: 'info', ms: 2600 });
    else notify(e > 0 ? 'Snatched it early! Pushed right' : 'Too late! Pulled left', { ...sk, level: 'warn', ms: 3500 });
  }
  function gauss() {
    const u = Math.max(1e-9, Math.random()), v = Math.random();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }
  function launchShot() {
    const c = game.cue;
    const e = game.error, p = game.lockedPower;
    game.lastPower = p;
    let angle = game.aim + e * (0.7 + 1.8 * p) * DEG + gauss() * (0.06 + 0.12 * p) * DEG;
    let a = game.spinA, b = game.spinB;
    let speed = P.speedFor(p) * (1 + gauss() * 0.012);
    const risk = miscueRisk(e);
    let miscue = false;
    if (Math.random() < risk) {
      // The tip slides off: a feeble, skewed hit with random spin.
      miscue = true;
      speed *= 0.25 + Math.random() * 0.3;
      angle += (Math.random() - 0.5) * 0.14;
      a = clamp(a * 1.4 + (Math.random() - 0.5) * 0.3, -0.7, 0.7);
      b *= 0.4;
    }
    game.shot = {
      first: null, pocketed: [], scratch: false, cushions: 0, maxSpeed: 0,
      before: liveBalls().map((q) => q.n), startT: performance.now(),
    };
    game.cueStick.anchor = { x: c.x, y: c.y }; // the cue stays where the shot was played
    P.strike(c, angle, speed, a, b);
    game.strokes++;
    game.phase = 'roll';
    game.followT = 0;
    if (miscue) {
      audio.play('miscue');
      notify('Miscue! The tip slid off the ball', { key: 'strike', level: 'bad', ms: 4000, pri: 3 });
      if (navigator.vibrate) try { navigator.vibrate([30, 40, 30]); } catch (err) { /* ignore */ }
    } else {
      audio.play('cue', p);
      if (navigator.vibrate) try { navigator.vibrate(10); } catch (err) { /* ignore */ }
    }
    // A puff of chalk off the tip.
    const chalk = { pub: '#7aa8ff', tournament: '#6f9bff', casino: '#ff8f96', saloon: '#8fb4ff', space: '#b49cff', beach: '#7fd2ff' }[game.world.id];
    spray(c.x - Math.cos(angle) * R, c.y - Math.sin(angle) * R, chalk, 7 + Math.round(p * 8), 0.25 + p * 0.4, 0.008);
    updateHud();
  }

  // ---------------------------------------------------------------------------------------------
  // Simulation update
  let lastT = performance.now();
  function frame(now) {
    const dt = Math.min(0.05, (now - lastT) / 1000);
    lastT = now;
    update(dt, now);
    rotateNotes(now);
    if (game.rack) fitView(false);
    game.renderer.draw(game, now / 1000);
    drawMeter();
    requestAnimationFrame(frame);
  }

  function update(dt, now) {
    if (game.aimHold && game.phase === 'aim' && (game.aimHoldT += dt) > 0) {
      const rate = 0.004 * (1 + Math.min(game.aimHoldT, 2) * 6);
      game.aim += game.aimHold * rate * dt * 10;
    }
    const cs = game.cueStick;
    switch (game.phase) {
      case 'aim': {
        let da = Pool.util.angleDiff(game.aim, cs.angle);
        cs.angle += da * Math.min(1, dt * 14);
        cs.pull = lerp(cs.pull, 0.012, Math.min(1, dt * 8));
        cs.alpha = Math.min(1, cs.alpha + dt * 3);
        updateGuide();
        updatePace(now);
        break;
      }
      case 'place':
        cs.angle = game.aim;
        cs.alpha = Math.max(0, cs.alpha - dt * 4);
        break;
      case 'backswing':
        game.power += dt / DRAW_TIME;
        if (game.power >= 1) {
          game.power = 1;
          game.topHold += dt;
          if (game.topHold > 0.3) lockPower();
        }
        cs.angle = game.aim;
        cs.pull = 0.012 + game.power * MAX_PULL;
        break;
      case 'downswing':
        game.marker -= dt * game.returnSpeed;
        cs.pull = 0.012 + Math.max(0, game.marker) * MAX_PULL;
        if (game.marker <= OVERSHOOT) strike(OVERSHOOT);
        break;
      case 'strike':
        game.strikeT += dt;
        cs.pull = lerp(game.strikeFrom, -0.004, Math.min(1, game.strikeT / 0.07));
        if (game.strikeT >= 0.07) launchShot();
        break;
      case 'roll': {
        game.followT += dt;
        // Follow through, then lift the cue away.
        cs.pull = Math.max(-0.05 - game.lockedPower * 0.06, cs.pull - dt * 0.6);
        cs.alpha = Math.max(0, 1 - Math.max(0, game.followT - 0.35) * 2.5);
        const steps = game.fastForward ? 4 : 1;
        for (let s = 0; s < steps && game.phase === 'roll'; s++) {
          const ev = P.step(game.sim, dt, []);
          handleEvents(ev);
          if (!P.anyMoving(game.sim)) {
            game.phase = 'settle';
            game.settleT = 0.45;
            game.afterSettle = judgeShot;
          }
        }
        break;
      }
      case 'settle':
        game.settleT -= dt;
        if (game.settleT <= 0 && game.afterSettle) {
          const f = game.afterSettle;
          game.afterSettle = null;
          f();
        }
        break;
      default:
        break;
    }
    for (const b of game.balls) if (b.pocketed && b.sinkT < 1) b.sinkT = Math.min(1, b.sinkT + dt * 2.6);
    updateParticles(dt);
    updateCamera(dt);
    updateHud();
    updateShootButton();
  }

  function handleEvents(events) {
    const shot = game.shot;
    for (const ev of events) {
      switch (ev.type) {
        case 'ball':
          if (shot && shot.first == null && (ev.a === 0 || ev.b === 0)) {
            shot.first = ev.a === 0 ? ev.b : ev.a;
            if (game.rack.order === 'lowest' && shot.first !== shot.before.reduce((m, n) => Math.min(m, n), 99)) {
              notify(`Wrong ball first: the ${shot.first}`, { key: 'foul', level: 'bad', ms: 3000, pri: 3 });
            }
          }
          audio.play('ball', ev.speed);
          if (ev.speed > 2.5) spray(ev.x, ev.y, 'rgba(255,255,255,0.8)', 3, 0.4, 0.004);
          break;
        case 'cushion':
          if (shot) shot.cushions++;
          if (ev.kind === 'jaw') audio.play('jaw', ev.speed);
          else if (ev.speed > 0.15) audio.play('cushion', ev.speed);
          break;
        case 'pocket': {
          if (shot) {
            shot.pocketed.push({ n: ev.n, pocket: ev.pocket });
            if (ev.n === 0) shot.scratch = true;
          }
          audio.play('pocket', ev.speed);
          const lucky = game.rack.table.lucky === ev.pocket && ev.n !== 0;
          if (lucky) {
            audio.play('jackpot');
            spray(ev.x, ev.y, '#ffd640', 22, 0.8, 0.006);
          }
          if (ev.n === 0) notify('Scratch! The cue ball went down', { key: 'foul', level: 'bad', ms: 3500, pri: 3 });
          else {
            const n = shot ? shot.pocketed.filter((q) => q.n !== 0).length : 1;
            const name = game.rack.table.pockets[ev.pocket].name;
            notify(n > 1 ? `${n} balls down!` : `The ${ev.n} drops in the ${name}`, { key: 'pot', level: lucky ? 'gold' : 'good', ms: 2600, pri: 2 });
          }
          break;
        }
        default:
          break;
      }
    }
  }

  // The balls have stopped: apply the rules.
  function judgeShot() {
    const rack = game.rack;
    const shot = game.shot;
    const res = Rules.judge(rack, shot.before, shot);
    game.penalties += res.penalty;
    game.bonus += res.bonus;
    for (const n of res.respot) {
      const b = game.balls.find((q) => q.n === n);
      const spot = T.spotBall(rack.table, game.balls, n);
      Object.assign(b, { pocketed: false, pocket: -1, x: spot.x, y: spot.y, vx: 0, vy: 0, wx: 0, wy: 0, wz: 0, moving: false, sinkT: 1 });
      spray(spot.x, spot.y, '#ffffff', 10, 0.3, 0.005);
    }
    if (res.foul || res.penalty > 0) {
      audio.play('foul');
      notify(res.messages.join(' · '), { key: 'foul', level: 'bad', ms: 5000, pri: 3 });
    } else if (res.bonus) {
      notify(res.messages.join(' · '), { key: 'pot', level: 'gold', ms: 3500, pri: 3 });
    } else if (res.potted.length === 0) {
      if (shot.first != null) notify('No pot', { key: 'result', ms: 1800, pri: 0 });
    }
    if (res.early) {
      // A legal money ball: the rest of the rack is swept off.
      for (const b of liveBalls()) { b.pocketed = true; b.sinkT = 1; b.sinkFrom = null; }
      audio.play('clear');
    }
    updateHud();
    const total = game.strokes + game.penalties - game.bonus;
    if (res.cleared) return finishRack(false);
    if (total >= Rules.capFor(rack.par)) return finishRack(true);
    if (res.cueInHand) beginPlace('anywhere');
    else beginAim();
  }

  function finishRack(capped) {
    const rack = game.rack;
    const cap = Rules.capFor(rack.par);
    const score = capped ? cap : Math.max(1, game.strokes + game.penalties - game.bonus);
    game.scores[game.rackIdx] = score;
    game.phase = 'rackDone';
    save();
    const name = capped ? 'Shot limit reached' : Rules.scoreName(score, rack.par);
    if (!capped && score <= rack.par) audio.play('clear');
    else audio.play('good');
    toast(name, `${score} ${score === 1 ? 'shot' : 'shots'} · par ${rack.par}`, 2200);
    setTimeout(() => showScorecard(true), 2300);
  }

  // ---------------------------------------------------------------------------------------------
  // Particles
  function spray(x, y, color, n, speed, size) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, v = speed * (0.3 + Math.random() * 0.7);
      game.particles.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, r: size * (0.5 + Math.random()), color, life: 0.5 + Math.random() * 0.5, max: 1, a: 0.85 });
    }
  }
  function updateParticles(dt) {
    for (const p of game.particles) {
      p.x += p.vx * dt; p.y += p.vy * dt;
      p.vx *= Math.exp(-dt * 4); p.vy *= Math.exp(-dt * 4);
      p.life -= dt;
    }
    game.particles = game.particles.filter((p) => p.life > 0);
  }

  // ---------------------------------------------------------------------------------------------
  // Camera
  function updateCamera(dt) {
    if (!game.cue) return;
    game.zoom = Math.exp(lerp(Math.log(game.zoom), Math.log(game.zoomTarget), 1 - Math.exp(-dt * 6)));
    // Zoomed in, follow the cue ball (or the ball it just sent on its way).
    let f = game.cue;
    if (game.phase === 'roll' && game.cue.pocketed) f = game.focus;
    const k = 1 - Math.exp(-dt * (game.phase === 'roll' ? 3 : 6));
    game.focus = { x: game.focus.x + (f.x - game.focus.x) * k, y: game.focus.y + (f.y - game.focus.y) * k };
  }
  function setZoom(z) {
    game.zoomTarget = clamp(z, 1, 3);
    els.btnZoom.classList.toggle('on', game.zoomTarget > 1.05);
  }

  // ---------------------------------------------------------------------------------------------
  // HUD
  const hudCache = {};
  function setText(el, key, text) {
    if (hudCache[key] !== text) {
      hudCache[key] = text;
      el.textContent = text;
    }
  }
  function totalVsPar() {
    let diff = 0;
    game.scores.forEach((s, i) => { if (s != null) diff += s - game.tour.pars[i]; });
    return diff;
  }
  function fmtDiff(d) {
    return d === 0 ? 'E' : d > 0 ? `+${d}` : `${d}`;
  }
  function updateHud(force) {
    const rack = game.rack;
    if (!rack) return;
    if (force) Object.keys(hudCache).forEach((k) => delete hudCache[k]);
    setText(els.rackTitle, 'rt', `Rack ${game.rackIdx + 1}`);
    const extra = game.penalties || game.bonus ? ` · ${game.penalties ? '+' + game.penalties + ' pen' : ''}${game.penalties && game.bonus ? ' ' : ''}${game.bonus ? '−' + game.bonus + ' ★' : ''}` : '';
    setText(els.rackSub, 'rs', `${rack.info.name} · Par ${rack.par}`);
    const shotNo = ['roll', 'settle', 'rackDone'].includes(game.phase) ? game.strokes : game.strokes + 1;
    setText(els.stroke, 'st', `Shot ${Math.max(1, shotNo)}`);
    const d = totalVsPar();
    setText(els.score, 'sc', `Total ${fmtDiff(d)}${extra}`);
    els.score.className = 'small ' + (d < 0 ? 'under' : d > 0 ? 'over' : '');
    // Status: what's going on, and the balls still to pot.
    const live = liveBalls();
    let status;
    if (game.phase === 'place') status = game.handZone === 'kitchen' ? '✋ Ball in hand (kitchen)' : '✋ Ball in hand';
    else if (game.phase === 'roll' || game.phase === 'settle') status = 'Balls rolling…';
    else if (rack.order === 'lowest' && live.length) status = `On: the ${lowestLive()}`;
    else if (rack.lastBall != null && live.length > 1) status = `${live.length} left · 8 last`;
    else status = `${live.length} left`;
    setText(els.status, 'status', status);
    const trayKey = live.map((b) => b.n).join(',') + '|' + game.targetBall;
    if (hudCache.tray !== trayKey) {
      hudCache.tray = trayKey;
      els.tray.innerHTML = '';
      const nums = live.map((b) => b.n).sort((a, b) => a - b);
      els.tray.classList.toggle('many', nums.length > 9);
      for (const n of nums) {
        const img = document.createElement('img');
        img.src = Rn.ballIcon(n, Math.round(17 * game.dpr), game.world);
        img.alt = String(n);
        if (rack.order === 'lowest' && n === nums[0]) img.className = 'target';
        els.tray.append(img);
      }
    }
  }
  // The world panel: what makes this venue different.
  function buildTwist() {
    const w = game.world;
    const c = els.twist, dpr = game.dpr;
    c.width = 30 * dpr; c.height = 30 * dpr;
    const ctx = c.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, 30, 30);
    let label = w.name;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    if (w.id === 'saloon' && game.tour.tilt) {
      // Spirit level: the bubble drifts uphill, the arrow shows which way balls drift.
      const v = game.renderer.view;
      const tx = game.tour.tilt.x, ty = game.tour.tilt.y;
      const sx = v.rot ? ty : tx, sy = v.rot ? -tx : ty;
      const m = Math.hypot(sx, sy) || 1;
      ctx.strokeStyle = 'rgba(255,255,255,0.7)'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(15, 15, 12, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = '#ffd24d';
      ctx.beginPath(); ctx.arc(15 - (sx / m) * 6, 15 - (sy / m) * 6, 4, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#ff8a80'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(15, 15); ctx.lineTo(15 + (sx / m) * 10, 15 + (sy / m) * 10); ctx.stroke();
      label = 'Leans';
    } else {
      ctx.font = '20px system-ui, sans-serif';
      ctx.fillText(w.emoji, 15, 16);
      label = { pub: 'Classic', tournament: 'Fast', casino: 'Lucky ★', space: '0.45 g', beach: 'Sand' }[w.id] || w.name;
    }
    setText(els.twistLabel, 'twist', label);
  }

  function updateShootButton() {
    const labels = { place: 'PLACE CUE BALL ✓', aim: 'HOLD TO SHOOT', backswing: 'RELEASE', downswing: 'TAP!', strike: '…', roll: 'HOLD TO FAST-FORWARD ⏩' };
    const label = labels[game.phase] || '…';
    if (hudCache.shoot !== label) {
      hudCache.shoot = label;
      els.shoot.textContent = label;
      els.shoot.classList.toggle('place', game.phase === 'place');
    }
    const enabled = ['place', 'aim', 'backswing', 'downswing', 'roll'].includes(game.phase);
    if (els.shoot.disabled === enabled) els.shoot.disabled = !enabled;
    const zone = game.phase === 'backswing' || game.phase === 'downswing';
    if (els.controls.classList.contains('swinging') !== zone) els.controls.classList.toggle('swinging', zone);
    const free = game.phase === 'aim' || game.phase === 'place';
    if (hudCache.free !== free) {
      hudCache.free = free;
      for (const k in spinButtons) spinButtons[k].disabled = !free;
      els.aimLeft.disabled = els.aimRight.disabled = !free;
      els.spinCanvas.style.opacity = free ? 1 : 0.6;
    }
  }

  let toastTimer = null;
  function toast(title, sub, ms = 1500) {
    els.toast.innerHTML = '';
    els.toast.append(title);
    if (sub) {
      const s = document.createElement('small');
      s.textContent = sub;
      els.toast.append(s);
    }
    els.toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => els.toast.classList.remove('show'), ms);
  }
  // Message dock: one reserved line in the HUD shows the most important active message (newest first
  // among equals), with a "+N" count and a gentle rotation when several are active.
  const notes = new Map();
  const NOTE_ICON = { good: '✓ ', warn: '⚠ ', bad: '⚠ ', info: '', result: '', music: '', gold: '' };
  let noteSeq = 0, noteShown = null, noteRotateAt = 0;
  function notify(text, { key = text, level = 'info', ms = 2600, pri = 1 } = {}) {
    const old = notes.get(key);
    if (old) clearTimeout(old.timer);
    const n = { text, level, pri, seq: ++noteSeq };
    if (ms > 0) n.timer = setTimeout(() => dismiss(key), ms);
    notes.set(key, n);
    const cur = noteShown && notes.get(noteShown);
    if (!cur || cur === n || pri >= cur.pri) noteShown = key;
    noteRotateAt = performance.now() + 2800;
    renderNotes();
  }
  function dismiss(key) {
    const n = notes.get(key);
    if (!n) return;
    clearTimeout(n.timer);
    notes.delete(key);
    if (noteShown === key) noteShown = null;
    renderNotes();
  }
  function orderedNotes() {
    return [...notes.entries()].sort((a, b) => b[1].pri - a[1].pri || b[1].seq - a[1].seq);
  }
  function renderNotes() {
    const list = orderedNotes();
    if (!list.length) { els.notify.innerHTML = ''; noteShown = null; return; }
    if (!noteShown || !notes.has(noteShown)) noteShown = list[0][0];
    const n = notes.get(noteShown);
    let el = els.notify.firstChild;
    if (!el || el.dataset.key !== noteShown || el.dataset.seq !== String(n.seq)) {
      els.notify.innerHTML = '';
      el = document.createElement('div');
      el.dataset.key = noteShown;
      el.dataset.seq = n.seq;
      el.addEventListener('click', () => dismiss(el.dataset.key));
      els.notify.append(el);
    }
    el.className = 'note ' + n.level;
    el.innerHTML = '';
    const t = document.createElement('span');
    t.className = 'txt';
    t.textContent = (NOTE_ICON[n.level] || '') + n.text;
    el.append(t);
    if (list.length > 1) {
      const m = document.createElement('span');
      m.className = 'more';
      m.textContent = '+' + (list.length - 1);
      el.append(m);
    }
  }
  function rotateNotes(now) {
    if (notes.size < 2 || now < noteRotateAt) return;
    const list = orderedNotes().map((e) => e[0]);
    noteShown = list[(list.indexOf(noteShown) + 1) % list.length];
    noteRotateAt = now + 2800;
    renderNotes();
  }

  // Stroke meter, drawn on the main canvas just above the controls.
  function drawMeter() {
    if (!game.rack || !['aim', 'backswing', 'downswing', 'strike'].includes(game.phase)) return;
    const r = game.renderer;
    const ctx = r.ctx;
    r.setScreen();
    const M = game.meterRect;
    const bw = Math.min(M.w, 440), bh = 18;
    const bx = M.x + (M.w - bw) / 2, by = M.y + 14;
    const u = (p) => bx + ((p - OVERSHOOT) / (1 - OVERSHOOT)) * bw;
    ctx.save();
    ctx.fillStyle = 'rgba(6,16,10,0.72)';
    roundRect(ctx, bx - 4, by - 18, bw + 8, bh + 22, 8);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.08)';
    roundRect(ctx, bx, by, bw, bh, 5);
    ctx.fill();
    ctx.fillStyle = 'rgba(120,180,255,0.18)';
    ctx.fillRect(u(OVERSHOOT), by, u(0.06) - u(OVERSHOOT), bh);
    const p = game.phase === 'backswing' ? game.power : game.phase === 'aim' ? 0 : game.lockedPower;
    if (p > 0) {
      const grad = ctx.createLinearGradient(u(0), 0, u(1), 0);
      grad.addColorStop(0, '#ffe27a');
      grad.addColorStop(0.75, '#ffb020');
      grad.addColorStop(1, '#ff5a2a');
      ctx.fillStyle = grad;
      ctx.fillRect(u(0), by + 3, u(p) - u(0), bh - 6);
    }
    // Ticks: cue-ball speed.
    ctx.font = '600 10px system-ui, sans-serif';
    ctx.textBaseline = 'bottom';
    ctx.textAlign = 'left';
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ctx.fillText('pace m/s', bx, by - 5);
    for (const q of [0.25, 0.5, 0.75, 1]) {
      ctx.fillStyle = 'rgba(255,255,255,0.5)';
      ctx.fillRect(u(q) - 0.5, by, 1, bh);
      ctx.fillStyle = 'rgba(255,255,255,0.75)';
      ctx.textAlign = q === 1 ? 'right' : 'center';
      ctx.fillText(P.speedFor(q).toFixed(1), q === 1 ? u(q) + 2 : u(q), by - 5);
    }
    if (game.pace != null) {
      const x = u(Math.min(game.pace, 1));
      ctx.fillStyle = '#e8322b';
      ctx.fillRect(x - 1.5, by - 2, 3, bh + 4);
      ctx.beginPath();
      ctx.moveTo(x, by + bh + 1);
      ctx.lineTo(x - 5, by + bh + 7);
      ctx.lineTo(x + 5, by + bh + 7);
      ctx.fill();
    }
    ctx.fillStyle = 'rgba(255,255,255,0.25)';
    ctx.fillRect(u(-game.sweet), by, u(game.sweet) - u(-game.sweet), bh);
    ctx.fillStyle = '#fff';
    ctx.fillRect(u(0) - 1, by - 3, 2, bh + 6);
    let m = null;
    if (game.phase === 'backswing') m = game.power;
    else if (game.phase === 'downswing' || game.phase === 'strike') m = game.marker;
    if (m != null) {
      const x = u(m);
      ctx.fillStyle = '#111';
      ctx.fillRect(x - 2.5, by - 5, 5, bh + 10);
      ctx.fillStyle = game.phase === 'strike' ? (game.error === 0 ? '#5dff7a' : '#ff7a5d') : '#fff';
      ctx.fillRect(x - 1.5, by - 4, 3, bh + 8);
    }
    ctx.restore();
  }
  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  // ---------------------------------------------------------------------------------------------
  // Scorecard
  function scoreRows(tour, scores, cur = -1) {
    const head = ['Rack', ...tour.racks.map((_, i) => i + 1), 'Tot'];
    const type = ['', ...tour.racks.map((r) => Pool.RACKS[r.type].short), ''];
    const parT = tour.pars.reduce((a, b) => a + b, 0);
    const par = ['Par', ...tour.pars, parT];
    let tot = 0, played = false;
    const sc = ['Score', ...tour.pars.map((p, i) => {
      const s = scores[i];
      if (s == null) return '';
      tot += s; played = true;
      const d = s - p;
      const cls = d <= -2 ? 'eagle' : d === -1 ? 'birdie' : d === 1 ? 'bogey' : d >= 2 ? 'double' : '';
      return { s, cls };
    }), played ? tot : ''];
    return { head, type, par, sc, cur };
  }
  function fillTable(table, rows) {
    table.innerHTML = '';
    const addRow = (cells, tag, cls) => {
      const tr = document.createElement('tr');
      if (cls) tr.className = cls;
      cells.forEach((c, i) => {
        const td = document.createElement(tag);
        if (c && typeof c === 'object') {
          const span = document.createElement('span');
          span.className = 'sc ' + c.cls;
          span.textContent = c.s;
          td.append(span);
        } else td.textContent = c;
        if (i - 1 === rows.cur) td.classList.add('cur');
        tr.append(td);
      });
      table.append(tr);
    };
    addRow(rows.head, 'th');
    addRow(rows.type, 'td', 'type');
    addRow(rows.par, 'td');
    addRow(rows.sc, 'td');
  }
  function showScorecard(afterRack) {
    const tour = game.tour;
    if (!tour) return;
    els.scTable.classList.remove('hidden');
    const done = game.scores.filter((s) => s != null).length;
    const final = afterRack && done === tour.racks.length;
    els.scTitle.textContent = final ? 'Tour complete' : 'Scorecard';
    els.scTour.textContent = `${tour.world.emoji} ${tour.name} · seed “${tour.seed}”`;
    const d = totalVsPar();
    const shots = game.scores.reduce((a, s) => a + (s || 0), 0);
    els.scResult.innerHTML = '';
    if (done) {
      els.scResult.append(`${fmtDiff(d)} after ${done} ${done === 1 ? 'rack' : 'racks'}`);
      const sm = document.createElement('small');
      sm.textContent = `${shots} shots`;
      if (final) sm.textContent += d < 0 ? ' — under par. Hustler!' : d === 0 ? ' — level par. Solid.' : ' — keep chalking up.';
      els.scResult.append(sm);
    }
    fillTable(els.scTable, scoreRows(tour, game.scores, afterRack ? game.rackIdx : game.rackIdx));
    els.scButtons.innerHTML = '';
    const btn = (label, cls, fn) => {
      const b = document.createElement('button');
      b.className = cls;
      b.textContent = label;
      b.addEventListener('click', () => { audio.unlock(); fn(); });
      els.scButtons.append(b);
    };
    if (final) {
      recordRound();
      clearSave();
      game.inRound = false;
      btn('New tour', 'primary', () => { els.seed.value = randomSeed(); updatePreview(); els.scorecard.classList.add('hidden'); startTour(els.seed.value); });
      btn('Play this tour again', 'secondary', () => { els.scorecard.classList.add('hidden'); startTour(tour.seed); });
      btn('Main menu', 'secondary', () => { els.scorecard.classList.add('hidden'); showMenu(); });
    } else if (afterRack) {
      btn(`Next: Rack ${game.rackIdx + 2} · ${Pool.RACKS[tour.racks[game.rackIdx + 1].type].name} ›`, 'primary', () => startRack(game.rackIdx + 1));
      btn('Main menu', 'secondary', () => { els.scorecard.classList.add('hidden'); showMenu(); });
    } else {
      btn('Close', 'secondary', () => els.scorecard.classList.add('hidden'));
    }
    els.scorecard.classList.remove('hidden');
  }
  function showRules() {
    const rack = game.rack;
    if (!rack) return;
    const w = game.world;
    els.scTitle.textContent = `Rack ${game.rackIdx + 1} · ${rack.info.name}`;
    els.scTour.textContent = `${w.emoji} ${game.tour.name}`;
    els.scResult.innerHTML = '';
    const ul = document.createElement('ul');
    ul.className = 'rules-list';
    const items = [
      ['Goal', `clear the rack — par ${rack.par}. Your score is shots + penalties${w.id === 'casino' ? ' − lucky-pocket bonuses' : ''}.`],
      ['This rack', rack.info.rule],
      ['Fouls (+1)', `scratch (ball in hand anywhere), no ball hit${rack.order === 'lowest' ? ', or not hitting the lowest ball first' : ''}.`],
      ['Shot limit', `the rack ends at ${Rules.capFor(rack.par)} and scores that.`],
      [w.name, w.twist || w.blurb],
    ];
    if (rack.lastBall != null) items.splice(2, 0, ['The 8', 'sunk before the others it\'s respotted and costs +2.']);
    if (rack.moneyBall != null) items.splice(2, 0, ['The 9', 'pot it on a legal shot (lowest ball hit first, no scratch) to clear the rack at once.']);
    for (const [k, v] of items) {
      const li = document.createElement('li');
      const b = document.createElement('b');
      b.textContent = k + ': ';
      li.append(b, v);
      ul.append(li);
    }
    els.scResult.append(ul);
    els.scTable.classList.add('hidden');
    els.scButtons.innerHTML = '';
    const b = document.createElement('button');
    b.className = 'secondary';
    b.textContent = 'Close';
    b.addEventListener('click', () => { els.scorecard.classList.add('hidden'); els.scTable.classList.remove('hidden'); });
    els.scButtons.append(b);
    els.scorecard.classList.remove('hidden');
  }

  // ---------------------------------------------------------------------------------------------
  // Save / menu
  function save() {
    if (!game.tour) return;
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify({
        seed: game.tour.seed,
        rackIdx: game.phase === 'rackDone' ? Math.min(game.rackIdx + 1, game.tour.racks.length - 1) : game.rackIdx,
        scores: game.scores,
      }));
    } catch (e) { /* ignore */ }
  }
  function clearSave() {
    try { localStorage.removeItem(SAVE_KEY); } catch (e) { /* ignore */ }
  }
  function loadSave() {
    try {
      const s = JSON.parse(localStorage.getItem(SAVE_KEY) || 'null');
      if (s && typeof s.seed === 'string' && Number.isInteger(s.rackIdx) && Array.isArray(s.scores)) return s;
    } catch (e) { /* ignore */ }
    return null;
  }
  function loadRounds() {
    try {
      const r = JSON.parse(localStorage.getItem(ROUNDS_KEY) || '[]');
      return Array.isArray(r) ? r : [];
    } catch (e) { return []; }
  }
  function recordRound() {
    const tour = game.tour;
    if (game.recorded === tour) return;
    game.recorded = tour;
    const rounds = loadRounds();
    rounds.push({ seed: tour.seed, name: tour.name, world: tour.world.id, scores: game.scores.slice(), pars: tour.pars.slice(), date: Date.now() });
    try { localStorage.setItem(ROUNDS_KEY, JSON.stringify(rounds.slice(-MAX_ROUNDS))); } catch (e) { /* ignore */ }
  }
  function showRecords() {
    const rounds = loadRounds().map((r) => ({ ...r, diff: r.scores.reduce((a, s, i) => a + s - r.pars[i], 0), total: r.scores.reduce((a, s) => a + s, 0) }));
    els.recordsBody.innerHTML = '';
    if (!rounds.length) {
      const p = document.createElement('p');
      p.className = 'muted';
      p.textContent = 'Finish a tour of nine racks and it will show up here.';
      els.recordsBody.append(p);
    }
    const section = (title, list) => {
      if (!list.length) return;
      const h = document.createElement('h3');
      h.textContent = title;
      els.recordsBody.append(h);
      list.forEach((r, i) => {
        const d = document.createElement('details');
        d.className = 'rec';
        const s = document.createElement('summary');
        const w = Pool.WORLDS[r.world] || Pool.WORLDS.pub;
        s.innerHTML = '<span class="rec-rank"></span><span class="rec-main"><b></b><small></small></span><span class="rec-score"><span></span><small></small></span>';
        s.querySelector('.rec-rank').textContent = i + 1;
        s.querySelector('.rec-main b').textContent = `${w.emoji} ${r.name}`;
        s.querySelector('.rec-main small').textContent = `seed “${r.seed}” · ${new Date(r.date).toLocaleDateString()}`;
        s.querySelector('.rec-score span').textContent = fmtDiff(r.diff);
        s.querySelector('.rec-score small').textContent = `${r.total} shots`;
        d.append(s);
        const wrap = document.createElement('div');
        wrap.className = 'table-wrap';
        const t = document.createElement('table');
        t.className = 'sc-table';
        const tour = Pool.generateTour(r.seed);
        fillTable(t, scoreRows({ ...tour, pars: r.pars }, r.scores));
        wrap.append(t);
        d.append(wrap);
        const b = document.createElement('button');
        b.className = 'secondary rec-play';
        b.textContent = 'Play this tour';
        b.addEventListener('click', () => { audio.unlock(); els.records.classList.add('hidden'); clearSave(); startTour(r.seed); });
        d.append(b);
        els.recordsBody.append(d);
      });
    };
    const best = rounds.slice().sort((a, b) => a.diff - b.diff || b.date - a.date).slice(0, 5);
    const worst = rounds.length > 5 ? rounds.slice().sort((a, b) => b.diff - a.diff || b.date - a.date).slice(0, 5) : [];
    section('Best', best);
    section('Worst', worst);
    els.records.classList.remove('hidden');
  }

  function showMenu() {
    game.phaseBeforeMenu = game.phase;
    els.menu.classList.remove('hidden');
    const s = loadSave();
    if (game.inRound && game.tour) {
      els.continueWrap.classList.remove('hidden');
      els.continueInfo.textContent = `${game.tour.name} · rack ${game.rackIdx + 1} of 9`;
    } else if (s) {
      const t = Pool.generateTour(s.seed);
      els.continueWrap.classList.remove('hidden');
      els.continueInfo.textContent = `${t.world.emoji} ${t.name} · rack ${s.rackIdx + 1} of 9`;
    } else els.continueWrap.classList.add('hidden');
    updatePreview();
  }
  function hideMenu() {
    els.menu.classList.add('hidden');
  }
  function updatePreview() {
    const seed = els.seed.value.trim();
    if (!seed) { els.preview.textContent = ''; return; }
    const t = Pool.generateTour(seed);
    els.preview.innerHTML = '';
    els.preview.append(`${t.world.emoji} ${t.name}`);
    const sm = document.createElement('small');
    const par = t.pars.reduce((a, b) => a + b, 0);
    sm.textContent = `${t.world.label} · par ${par} · ${t.world.twist || t.world.blurb}`;
    els.preview.append(sm);
  }

  // ---------------------------------------------------------------------------------------------
  // Input
  const pointers = new Map();
  let pinch = null, placeDrag = null;

  function aimAt(sx, sy) {
    if (game.phase !== 'aim' || !game.cue) return;
    const w = game.renderer.toWorld(sx, sy);
    const c = game.cue;
    const ds = Math.hypot(w.x - c.x, w.y - c.y) * game.renderer.view.s;
    if (ds < 14) return;
    game.aim = Math.atan2(w.y - c.y, w.x - c.x);
  }
  function moveCueTo(x, y) {
    const table = game.rack.table;
    const p = T.nearestPlace(table, game.balls, x, y, game.handZone);
    if (!p) return;
    game.cue.x = p.x;
    game.cue.y = p.y;
    game.placeOk = T.placeOk(table, game.balls, p.x, p.y, game.handZone);
  }

  els.canvas.addEventListener('pointerdown', (e) => {
    audio.unlock();
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    els.canvas.setPointerCapture(e.pointerId);
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), zoom: game.zoomTarget };
      placeDrag = null;
      return;
    }
    if (game.phase === 'place') {
      const w = game.renderer.toWorld(e.clientX, e.clientY);
      // Mouse: the ball jumps to the pointer.  Touch: drag it by the finger's movement (so the finger
      // doesn't hide it), unless the finger lands right on it.
      const onBall = Math.hypot(w.x - game.cue.x, w.y - game.cue.y) < R * 4;
      placeDrag = { sx: e.clientX, sy: e.clientY, bx: game.cue.x, by: game.cue.y, abs: e.pointerType === 'mouse' || onBall, id: e.pointerId };
      if (placeDrag.abs) moveCueTo(w.x, w.y);
      return;
    }
    if (e.pointerType === 'mouse') {
      if (e.button !== 0) return;
      aimAt(e.clientX, e.clientY);
      pressShoot();
    } else aimAt(e.clientX, e.clientY);
  });
  els.canvas.addEventListener('pointermove', (e) => {
    if (pointers.has(e.pointerId)) pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch && pointers.size >= 2) {
      const [a, b] = [...pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      setZoom((pinch.zoom * d) / pinch.d);
      return;
    }
    if (game.phase === 'place') {
      if (placeDrag && placeDrag.id === e.pointerId) {
        if (placeDrag.abs) {
          const w = game.renderer.toWorld(e.clientX, e.clientY);
          moveCueTo(w.x, w.y);
        } else {
          const a = game.renderer.toWorld(placeDrag.sx, placeDrag.sy), b = game.renderer.toWorld(e.clientX, e.clientY);
          moveCueTo(placeDrag.bx + (b.x - a.x), placeDrag.by + (b.y - a.y));
        }
      }
      return;
    }
    if ((e.pointerType === 'mouse' && game.phase === 'aim') || pointers.has(e.pointerId)) aimAt(e.clientX, e.clientY);
  });
  const endPointer = (e) => {
    const had = pointers.delete(e.pointerId);
    if (pointers.size < 2) pinch = null;
    if (placeDrag && placeDrag.id === e.pointerId) placeDrag = null;
    if (e.pointerType === 'mouse' && had) releaseShoot();
  };
  els.canvas.addEventListener('pointerup', endPointer);
  els.canvas.addEventListener('pointercancel', endPointer);
  els.canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    setZoom(game.zoomTarget * Math.exp(-e.deltaY * 0.0015));
  }, { passive: false });

  const shootDown = (e) => {
    e.preventDefault();
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    els.shoot.classList.add('pressed');
    pressShoot();
  };
  const shootUp = () => {
    els.shoot.classList.remove('pressed');
    releaseShoot();
  };
  for (const el of [els.shoot, els.swingZone]) {
    el.addEventListener('pointerdown', shootDown);
    el.addEventListener('pointerup', shootUp);
    el.addEventListener('pointercancel', shootUp);
    el.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  const holdAim = (btn, dir) => {
    btn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      if (game.phase !== 'aim') return;
      game.aim += dir * 0.0025;
      game.aimHold = dir;
      game.aimHoldT = -0.25; // negative = delay before auto-repeat starts
    });
    const stop = () => { game.aimHold = 0; };
    btn.addEventListener('pointerup', stop);
    btn.addEventListener('pointercancel', stop);
    btn.addEventListener('pointerleave', stop);
  };
  holdAim(els.aimLeft, -1);
  holdAim(els.aimRight, 1);
  els.btnZoom.addEventListener('click', () => setZoom(game.zoomTarget > 1.05 ? 1 : 2));

  // Quick menu (☰).
  const setQuick = (open) => {
    els.quickMenu.classList.toggle('hidden', !open);
    els.btnQuick.setAttribute('aria-expanded', open ? 'true' : 'false');
    if (open) syncQuick();
  };
  els.btnQuick.addEventListener('click', (e) => {
    e.stopPropagation();
    audio.unlock();
    setQuick(els.quickMenu.classList.contains('hidden'));
  });
  document.addEventListener('pointerdown', (e) => {
    if (!els.quickMenu.contains(e.target) && e.target !== els.btnQuick) setQuick(false);
  });
  els.btnMenu.addEventListener('click', () => { setQuick(false); showMenu(); });
  els.btnCard.addEventListener('click', () => { setQuick(false); showScorecard(false); });
  els.btnRules.addEventListener('click', () => { setQuick(false); showRules(); });
  els.btnNextTrack.addEventListener('click', () => { audio.unlock(); Pool.music.next(); setQuick(false); });
  const stateLabel = (el, text, on) => {
    el.innerHTML = '';
    el.append(text);
    const st = document.createElement('span');
    st.className = 'state';
    st.textContent = on ? 'On' : 'Off';
    el.append(st);
    el.classList.toggle('off', !on);
  };
  const syncSound = () => stateLabel(els.btnSound, '🔊 Sound effects', !audio.muted);
  els.btnSound.addEventListener('click', () => {
    audio.unlock();
    audio.toggle();
    syncSound();
  });
  syncSound();
  const syncMusic = () => stateLabel(els.btnMusic, '♫ Music', Pool.music.enabled);
  function syncQuick() { syncSound(); syncMusic(); }
  els.btnMusic.addEventListener('click', () => {
    audio.unlock();
    const on = Pool.music.toggle();
    syncMusic();
    notify(on ? `♫ Music on${Pool.music.current ? ' — ' + Pool.music.current : ''}` : 'Music off', { key: 'music', level: 'music', ms: 2500, pri: 1 });
  });
  syncMusic();
  Pool.music.onTrack = (name) => {
    const show = () => {
      if (els.toast.classList.contains('show')) return setTimeout(show, 1500);
      if (Pool.music.enabled) notify(`♫ ${name}`, { key: 'music', level: 'music', ms: 3000, pri: 0 });
    };
    setTimeout(show, 250);
  };

  window.addEventListener('keydown', (e) => {
    if (e.target === els.seed) return;
    const step = e.shiftKey ? 0.2 : 0.05;
    if (e.code === 'Space') {
      e.preventDefault();
      if (!e.repeat) pressShoot();
    } else if (e.code === 'Enter') {
      confirmPlace();
    } else if (e.code === 'ArrowLeft' || e.code === 'ArrowRight') {
      if (game.phase === 'aim') game.aim += (e.code === 'ArrowLeft' ? -1 : 1) * (e.shiftKey ? 0.02 : 0.002);
      e.preventDefault();
    } else if (e.code === 'KeyW' || e.code === 'ArrowUp') {
      setSpin(game.spinA, game.spinB + step);
      e.preventDefault();
    } else if (e.code === 'KeyS' || e.code === 'ArrowDown') {
      setSpin(game.spinA, game.spinB - step);
      e.preventDefault();
    } else if (e.code === 'KeyA') {
      setSpin(game.spinA - step, game.spinB);
    } else if (e.code === 'KeyD') {
      setSpin(game.spinA + step, game.spinB);
    } else if (e.code === 'KeyX') {
      setSpin(0, 0);
    } else if (e.code === 'KeyZ') {
      setZoom(game.zoomTarget > 1.05 ? 1 : 2);
    } else if (e.code === 'KeyN') {
      Pool.music.next();
    } else if (e.code === 'KeyM') {
      audio.toggle();
      syncSound();
    } else if (e.code === 'KeyC') {
      if (els.scorecard.classList.contains('hidden')) showScorecard(false);
      else if (game.phase !== 'rackDone') els.scorecard.classList.add('hidden');
    }
  });
  window.addEventListener('keyup', (e) => {
    if (e.code === 'Space') releaseShoot();
  });

  // Block browser gestures that fight the game on mobile.
  document.addEventListener('gesturestart', (e) => e.preventDefault());
  document.addEventListener('dblclick', (e) => e.preventDefault());
  document.addEventListener('contextmenu', (e) => {
    if (e.target !== els.seed) e.preventDefault();
  });

  // Menu wiring.
  els.seed.addEventListener('input', updatePreview);
  els.dice.addEventListener('click', () => {
    els.seed.value = randomSeed();
    updatePreview();
  });
  els.play.addEventListener('click', () => {
    audio.unlock();
    const seed = els.seed.value.trim() || randomSeed();
    clearSave();
    startTour(seed);
  });
  els.btnRecords.addEventListener('click', showRecords);
  els.btnRecordsClose.addEventListener('click', () => els.records.classList.add('hidden'));
  els.continueBtn.addEventListener('click', () => {
    audio.unlock();
    if (game.inRound && game.rack) {
      hideMenu();
      if (game.phase === 'rackDone') showScorecard(true);
      return;
    }
    const s = loadSave();
    if (s) startTour(s.seed, s.rackIdx, s.scores);
  });

  // ---------------------------------------------------------------------------------------------
  // Boot
  const params = new URLSearchParams(location.search);
  els.seed.value = params.get('seed') || randomSeed();
  buildSpinRow();
  resize();
  updateSpinUi();
  showMenu();
  setupOffline();
  requestAnimationFrame((t) => {
    lastT = t;
    requestAnimationFrame(frame);
  });

  // ---------------------------------------------------------------------------------------------
  // Offline / install: a service worker caches the game; Android offers an install prompt, iPhone users
  // get the Add to Home Screen hint.
  function setupOffline() {
    const status = $('offline-status'), btn = $('btn-install'), ios = $('install-ios');
    const standalone = window.matchMedia('(display-mode: standalone)').matches || window.matchMedia('(display-mode: fullscreen)').matches || navigator.standalone;
    if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
      navigator.serviceWorker.register('sw.js').then(() => navigator.serviceWorker.ready).then(() => {
        status.textContent = standalone ? '✓ Installed · plays offline' : '✓ Ready to play offline';
      }).catch(() => { status.textContent = ''; });
    }
    let deferred = null;
    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      deferred = e;
      btn.classList.remove('hidden');
    });
    btn.addEventListener('click', async () => {
      if (!deferred) return;
      deferred.prompt();
      await deferred.userChoice.catch(() => null);
      deferred = null;
      btn.classList.add('hidden');
    });
    window.addEventListener('appinstalled', () => {
      btn.classList.add('hidden');
      status.textContent = '✓ Installed · plays offline';
    });
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    if (isIOS && !standalone) ios.classList.remove('hidden');
  }

  Pool.game = game;
  // Used by the browser playtests.
  Pool.debug = {
    notify, setSpin, beginAim, startTour,
    shoot(angle, power, a = 0, b = 0) {
      if (game.phase === 'place') beginAim();
      game.aim = angle;
      game.spinA = a; game.spinB = b;
      game.lockedPower = power;
      game.error = 0;
      launchShot();
    },
  };
})();
