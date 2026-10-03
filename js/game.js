// Game controller: one rack of 15 balls, cleared in as few shots as possible.  State machine, strength
// slider, floating spin window, ball in hand, input, camera, HUD, saving and the table-style screen.
(function () {
  const Pool = globalThis.Pool;
  const { physics: P, render: Rn, audio, themes: TH } = Pool;
  const T = Pool.table;
  const { clamp, lerp } = Pool.util;
  const R = T.R;

  const $ = (id) => document.getElementById(id);
  const els = {
    canvas: $('game'), hud: $('hud'), hudTop: $('hud-top'), notify: $('notify'),
    shots: $('shots-label'), fouls: $('fouls-label'), left: $('left-label'), tray: $('tray'),
    toast: $('toast'), controls: $('controls'), shoot: $('shoot-btn'),
    powerTrack: $('power-track'), powerFill: $('power-fill'), powerThumb: $('power-thumb'), powerValue: $('power-value'), powerSpeed: $('power-speed'),
    aimLeft: $('aim-left'), aimRight: $('aim-right'), spinBtn: $('spin-btn'), spinSmall: $('spin-small'),
    spinWin: $('spin-window'), spinBig: $('spin-big'), spinDesc: $('spin-desc'), spinClose: $('spin-close'), spinReset: $('spin-reset'),
    btnQuick: $('btn-quick'), quickMenu: $('quick-menu'), btnZoom: $('btn-zoom'), btnStyleSide: $('btn-style-side'),
    btnNew: $('btn-new'), btnStyle: $('btn-style'), btnSound: $('btn-sound'), btnMusic: $('btn-music'), btnNextTrack: $('btn-next-track'), btnMenu: $('btn-menu'),
    loading: $('loading'), menu: $('menu'), play: $('btn-play'), continueBtn: $('btn-continue'), continueInfo: $('continue-info'),
    btnStyleMenu: $('btn-style-menu'), best: $('best-label'),
    style: $('style'), stylePreview: $('style-preview'), clothOpts: $('cloth-options'), railOpts: $('rail-options'), roomOpts: $('room-options'),
    guideOpts: $('guide-options'), styleDone: $('btn-style-done'),
    result: $('result'), resultTitle: $('result-title'), resultBody: $('result-body'), again: $('btn-again'), resultMenu: $('btn-result-menu'),
  };

  const SAVE_KEY = 'pool.game.v2';
  const BEST_KEY = 'pool.best.v2';
  const STYLE_KEY = 'pool.style.v1';
  const POWER_KEY = 'pool.power.v1';
  const MAX_PULL = 0.2; // how far the cue draws back at full strength (m)
  const PULL_TIME = 0.22, PUSH_TIME = 0.07; // the stroke animation

  function loadJSON(key, fallback) {
    try { const v = JSON.parse(localStorage.getItem(key) || 'null'); return v ?? fallback; } catch (e) { return fallback; }
  }
  function saveJSON(key, v) {
    try { localStorage.setItem(key, JSON.stringify(v)); } catch (e) { /* storage unavailable */ }
  }

  const game = {
    settings: { ...TH.DEFAULT, ...loadJSON(STYLE_KEY, {}) },
    look: null, table: null, balls: [], cue: null, sim: null,
    phase: 'menu', inGame: false, shots: 0, fouls: 0, elapsed: 0,
    aim: -Math.PI / 2, power: clamp(+loadJSON(POWER_KEY, 0.4) || 0.4, 0.01, 1), spinA: 0, spinB: 0,
    cueStick: { angle: -Math.PI / 2, pull: 0.012, alpha: 1, anchor: null }, strikeT: 0,
    guide: null, guideKey: '', particles: [], handZone: 'kitchen', placeOk: true, shot: null,
    fastForward: false, settleT: 0, zoom: 1, zoomTarget: 1, focus: { x: 0, y: 0 },
    aimHold: 0, aimHoldT: 0, dpr: 1, area: { l: 0, r: 100, t: 0, b: 100 },
  };
  game.look = TH.makeLook(game.settings);
  game.table = T.buildTable(TH.ENV);
  game.renderer = new Rn.Renderer(els.canvas);

  // ---------------------------------------------------------------------------------------------
  // Layout
  let layerBase = 0, layerLook = '';
  function resize() {
    const vw = window.innerWidth, vh = window.innerHeight;
    const standalone = window.matchMedia('(display-mode: standalone)').matches || !!navigator.standalone;
    const fullH = vh >= vw ? Math.max(screen.width, screen.height) : Math.min(screen.width, screen.height);
    document.documentElement.classList.toggle('short-viewport', standalone && fullH - vh > 30);
    game.dpr = Math.min(window.devicePixelRatio || 1, 2);
    game.renderer.resize(vw, vh, game.dpr);
    const ctl = els.controls.getBoundingClientRect();
    const side = ctl.left > vw * 0.4; // landscape phone: controls in a right-hand column
    const top = els.hudTop.getBoundingClientRect().bottom + 4; // the message line may overlap the foot rail
    game.area = side ? { l: 4, r: ctl.left - 4, t: top, b: vh - 4 } : { l: 0, r: vw, t: top, b: ctl.top - 2 };
    if (!els.spinWin.dataset.moved) els.spinWin.style.bottom = side ? '' : vh - ctl.top + 8 + 'px';
    fitView(true);
    drawSpin();
  }
  function fitView(force) {
    const r = game.renderer;
    const v = r.fit(game.area, game.zoom, game.focus);
    if (!game.inGame) return;
    if (force || !r.layer || layerLook !== game.look.id || Math.abs(v.base / layerBase - 1) > 0.15) {
      if (force && r.layer && layerLook === game.look.id && Math.abs(v.base / layerBase - 1) < 0.02) return;
      layerBase = v.base;
      layerLook = game.look.id;
      r.layer = Rn.buildLayer(game.table, game.look, v.base * game.dpr * 1.4);
      r.sprites.clear();
    }
  }
  let resizeTimer = null;
  window.addEventListener('resize', () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(resize, 120); });
  window.addEventListener('orientationchange', () => setTimeout(resize, 250));

  // ---------------------------------------------------------------------------------------------
  // Game flow
  function newGame() {
    const rng = new Pool.RNG((Date.now() ^ (Math.random() * 0x7fffffff)) >>> 0);
    const balls = T.rackBalls(rng).map((b) => P.createBall(b.n, b.x, b.y, rng));
    const cue = P.createBall(0, 0, T.L * 0.34, rng);
    startWith([cue, ...balls], { shots: 0, fouls: 0, elapsed: 0, hand: 'kitchen' });
    toast('Break!', 'Place the cue ball behind the line', 2000);
  }

  function startWith(balls, st) {
    hideOverlays();
    game.phase = 'loading';
    els.loading.classList.remove('hidden');
    setTimeout(() => {
      game.balls = balls;
      game.cue = balls.find((b) => b.n === 0);
      game.sim = P.createSim(game.table, TH.ENV, game.balls);
      game.shots = st.shots;
      game.fouls = st.fouls;
      game.elapsed = st.elapsed || 0;
      game.particles = [];
      game.zoom = game.zoomTarget = 1;
      game.focus = { x: game.cue.x, y: game.cue.y };
      game.inGame = true;
      fitView(true);
      els.loading.classList.add('hidden');
      if (Pool.music) Pool.music.play(game.look.music);
      if (st.hand) beginPlace(st.hand);
      else beginAim();
      save();
      updateHud(true);
    }, 30);
  }

  function liveBalls() {
    return game.balls.filter((b) => b.n !== 0 && !b.pocketed);
  }

  // Ball in hand: drag the cue ball, then confirm.
  function beginPlace(zone) {
    game.phase = 'place';
    game.handZone = zone;
    const c = game.cue;
    Object.assign(c, { pocketed: false, moving: false, vx: 0, vy: 0, wx: 0, wy: 0, wz: 0, sinkT: 1 });
    const want = T.placeOk(game.table, game.balls, c.x, c.y, zone) ? c : { x: 0, y: T.L * 0.34 };
    const p = T.nearestPlace(game.table, game.balls, want.x, want.y, zone) || { x: 0, y: T.L * 0.3 };
    c.x = p.x; c.y = p.y;
    game.placeOk = true;
    if (zone !== 'kitchen' || game.shots > 0) aimAtNearest();
    else game.aim = -Math.PI / 2;
    note(zone === 'kitchen' ? 'Ball in hand behind the line — drag it, then tap PLACE' : 'Ball in hand — drag the cue ball anywhere, then tap PLACE');
  }
  function confirmPlace() {
    if (game.phase !== 'place') return;
    if (!game.placeOk) return note("The cue ball can't go there", 'warn');
    audio.play('place');
    note('');
    beginAim();
  }
  function beginAim() {
    game.phase = 'aim';
    game.cueStick.anchor = null;
    game.cueStick.angle = game.aim;
    game.cueStick.pull = 0.08;
    game.cueStick.alpha = 0;
    updateGuide(true);
  }
  // After ball in hand, point at the nearest object ball so the cue isn't aiming at nothing.
  function aimAtNearest() {
    const c = game.cue;
    let best = null, bd = Infinity;
    for (const b of liveBalls()) { const d = Math.hypot(b.x - c.x, b.y - c.y); if (d < bd) { bd = d; best = b; } }
    if (best) game.aim = Math.atan2(best.y - c.y, best.x - c.x);
  }

  // ---------------------------------------------------------------------------------------------
  // Aim guide
  function pathClear(ax, ay, bx, by, skip) {
    const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
    for (const b of game.balls) {
      if (b.pocketed || skip.includes(b)) continue;
      const t = clamp(l2 ? ((b.x - ax) * dx + (b.y - ay) * dy) / l2 : 0, 0, 1);
      if (Math.hypot(b.x - (ax + dx * t), b.y - (ay + dy * t)) < 2 * R - 0.001) return false;
    }
    return true;
  }
  function updateGuide(force) {
    if (!game.cue) return;
    const key = game.aim.toFixed(5) + '|' + game.spinA.toFixed(3) + '|' + game.spinB.toFixed(3) + '|' + game.power.toFixed(3) + '|' + game.cue.x.toFixed(4) + game.cue.y.toFixed(4) + game.settings.guide;
    if (!force && key === game.guideKey) return;
    game.guideKey = key;
    if (game.settings.guide === 'off') { game.guide = null; return; }
    const tr = P.traceAim(game.table, game.balls, game.cue, game.aim);
    const gd = { ...tr, legal: true, pot: null, objLen: 0.45, cueLen: 0.2 };
    if (tr.ball) {
      const pk = P.pocketAlong(game.table, tr.ball.x, tr.ball.y, tr.objDir);
      if (pk && pathClear(tr.ball.x, tr.ball.y, pk.pocket.x, pk.pocket.y, [tr.ball, game.cue])) gd.pot = pk.pocket;
      gd.objLen = gd.pot ? Math.min(0.6, pk.dist) : 0.45;
      const after = cueAfterContact(tr);
      if (after) { gd.cueDir = after.dir; gd.cueLen = 0.1 + 0.3 * after.k; }
      if (game.settings.guide === 'short') { gd.objLen = 0.12; gd.cueLen = 0.08; gd.pot = null; }
    }
    game.guide = gd;
  }
  // Where the cue ball heads after contact: run its approach, then let follow/draw take over.
  function cueAfterContact(tr) {
    const c = { ...game.cue };
    const sim = P.createSim(game.table, TH.ENV, [c]);
    sim.trackRot = false;
    P.strike(c, game.aim, P.speedFor(Math.max(0.05, game.power)), game.spinA, game.spinB);
    const x0 = c.x, y0 = c.y;
    for (let i = 0; i < 3000; i++) {
      if (Math.hypot(c.x - x0, c.y - y0) >= tr.t || !c.moving) break;
      P.step(sim, 1 / 240);
    }
    if (!c.moving) return null;
    const nx = Math.cos(tr.objDir), ny = Math.sin(tr.objDir);
    const vn = c.vx * nx + c.vy * ny;
    const ax = c.vx - vn * nx * 0.97, ay = c.vy - vn * ny * 0.97;
    const qx = -R * c.wy, qy = R * c.wx;
    const fx = (5 * ax + 2 * qx) / 7, fy = (5 * ay + 2 * qy) / 7;
    const sp = Math.hypot(fx, fy);
    if (sp < 0.02) return { dir: tr.cueDir, k: 0 };
    return { dir: Math.atan2(fy, fx), k: clamp(sp / Math.max(0.3, Math.hypot(c.vx, c.vy)), 0, 1) };
  }

  // ---------------------------------------------------------------------------------------------
  // Strength
  const canAdjust = () => game.phase === 'aim' || game.phase === 'place';
  function setPower(p) {
    game.power = clamp(Math.round(p * 200) / 200, 0.01, 1);
    saveJSON(POWER_KEY, game.power);
    updatePowerUi();
  }
  function updatePowerUi() {
    const pct = game.power * 100;
    els.powerFill.style.width = pct + '%';
    els.powerThumb.style.left = pct + '%';
    els.powerValue.textContent = Math.round(pct) + '%';
    els.powerSpeed.textContent = P.speedFor(game.power).toFixed(1) + ' m/s';
    els.powerTrack.setAttribute('aria-valuenow', Math.round(pct));
  }
  {
    let drag = null;
    const fromEvent = (e) => {
      const r = els.powerTrack.getBoundingClientRect();
      return clamp((e.clientX - r.left) / r.width, 0, 1);
    };
    els.powerTrack.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      audio.unlock();
      if (!canAdjust()) return;
      drag = e.pointerId;
      try { els.powerTrack.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
      setPower(fromEvent(e));
    });
    els.powerTrack.addEventListener('pointermove', (e) => { if (drag === e.pointerId && canAdjust()) setPower(fromEvent(e)); });
    const end = (e) => { if (drag === e.pointerId) drag = null; };
    els.powerTrack.addEventListener('pointerup', end);
    els.powerTrack.addEventListener('pointercancel', end);
  }

  // ---------------------------------------------------------------------------------------------
  // Spin
  function spinName() {
    const a = game.spinA, b = game.spinB;
    const v = b > 0.06 ? 'Follow' : b < -0.2 ? 'Draw' : b < -0.06 ? 'Stun' : '';
    const side = a > 0.06 ? 'right' : a < -0.06 ? 'left' : '';
    if (!v && !side) return 'Centre ball';
    if (v && side) return `${v} + ${side}`;
    const amt = Math.hypot(a, b) / P.MAX_TIP;
    const how = amt < 0.4 ? 'a little' : amt < 0.8 ? '' : 'max';
    return (side ? `${side === 'left' ? 'Left' : 'Right'} side` : v) + (how ? ' · ' + how : '');
  }
  function setSpin(a, b) {
    if (!canAdjust()) return;
    const r = Math.hypot(a, b);
    if (r > P.MAX_TIP) { a *= P.MAX_TIP / r; b *= P.MAX_TIP / r; }
    game.spinA = a;
    game.spinB = b;
    drawSpin();
  }
  function drawSpin() {
    Rn.drawSpinPicker(els.spinSmall, game.spinA, game.spinB, game.dpr);
    if (!els.spinWin.classList.contains('hidden')) Rn.drawSpinPicker(els.spinBig, game.spinA, game.spinB, game.dpr);
    const name = spinName();
    els.spinDesc.textContent = name;
    els.spinBtn.classList.toggle('on', name !== 'Centre ball');
    els.spinBtn.title = name;
  }
  function toggleSpinWindow(open = els.spinWin.classList.contains('hidden')) {
    els.spinWin.classList.toggle('hidden', !open);
    drawSpin();
  }
  {
    let drag = null;
    const pick = (e) => {
      const r = els.spinBig.getBoundingClientRect();
      const rad = Math.min(r.width, r.height) / 2 - 3;
      let a = (e.clientX - (r.left + r.width / 2)) / rad, b = -(e.clientY - (r.top + r.height / 2)) / rad;
      // A gentle snap to the axes makes pure follow, draw and side easy to set.
      if (Math.abs(a) < 0.03) a = 0;
      if (Math.abs(b) < 0.03) b = 0;
      setSpin(a, b);
    };
    els.spinBig.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      drag = e.pointerId;
      try { els.spinBig.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
      pick(e);
    });
    els.spinBig.addEventListener('pointermove', (e) => { if (drag === e.pointerId) pick(e); });
    const end = (e) => { if (drag === e.pointerId) drag = null; };
    els.spinBig.addEventListener('pointerup', end);
    els.spinBig.addEventListener('pointercancel', end);
    // Drag the window by its header to wherever it's out of the way.
    const head = els.spinWin.querySelector('.spin-head');
    let move = null;
    head.addEventListener('pointerdown', (e) => {
      if (e.target === els.spinClose) return;
      const r = els.spinWin.getBoundingClientRect();
      move = { id: e.pointerId, dx: e.clientX - r.left, dy: e.clientY - r.top };
      try { head.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    });
    head.addEventListener('pointermove', (e) => {
      if (!move || move.id !== e.pointerId) return;
      const w = els.spinWin.offsetWidth, h = els.spinWin.offsetHeight;
      Object.assign(els.spinWin.style, {
        left: clamp(e.clientX - move.dx, 0, window.innerWidth - w) + 'px',
        top: clamp(e.clientY - move.dy, 0, window.innerHeight - h) + 'px',
        right: 'auto', bottom: 'auto',
      });
      els.spinWin.dataset.moved = '1';
    });
    head.addEventListener('pointerup', () => { move = null; });
    els.spinBtn.addEventListener('click', () => { audio.unlock(); toggleSpinWindow(); });
    els.spinClose.addEventListener('click', () => toggleSpinWindow(false));
    els.spinReset.addEventListener('click', () => setSpin(0, 0));
  }

  // ---------------------------------------------------------------------------------------------
  // Shooting
  function pressShoot() {
    audio.unlock();
    if (game.phase === 'place') confirmPlace();
    else if (game.phase === 'aim') {
      game.phase = 'strike';
      game.strikeT = 0;
      note('');
    } else if (game.phase === 'roll') game.fastForward = true;
  }
  function releaseShoot() {
    game.fastForward = false;
  }
  function launchShot() {
    const c = game.cue;
    game.shot = { first: null, pocketed: [], scratch: false };
    game.cueStick.anchor = { x: c.x, y: c.y }; // the cue stays where the shot was played
    P.strike(c, game.aim, P.speedFor(game.power), game.spinA, game.spinB);
    game.shots++;
    game.phase = 'roll';
    game.followT = 0;
    audio.play('cue', game.power);
    if (navigator.vibrate) try { navigator.vibrate(10); } catch (err) { /* ignore */ }
    spray(c.x - Math.cos(game.aim) * R, c.y - Math.sin(game.aim) * R, '#7aa8ff', 6 + Math.round(game.power * 8), 0.25 + game.power * 0.4, 0.008);
    updateHud();
  }

  // The balls have stopped: fouls, ball in hand, or the end of the game.
  function settleShot() {
    const shot = game.shot;
    const potted = shot.pocketed.filter((p) => p.n !== 0);
    const foul = shot.scratch ? 'scratch — ball in hand' : shot.first == null ? 'no ball hit' : null;
    if (foul) {
      game.fouls++;
      audio.play('foul');
      note(`Foul: ${foul} (+1)`, 'bad');
    } else if (potted.length > 1) note(`${potted.length} balls down!`, 'good');
    else if (!potted.length) note('No pot', 'info', 1500);
    updateHud();
    if (!liveBalls().length) return finish();
    if (shot.scratch) beginPlace('anywhere');
    else beginAim();
    save();
  }

  function finish() {
    game.phase = 'done';
    game.inGame = false;
    clearSave();
    const score = game.shots + game.fouls;
    const best = loadJSON(BEST_KEY, null);
    const isBest = !best || score < best.score;
    if (isBest) saveJSON(BEST_KEY, { score, shots: game.shots, fouls: game.fouls, time: Math.round(game.elapsed), date: Date.now() });
    audio.play('clear');
    toast('Table cleared!', `${score} ${score === 1 ? 'shot' : 'shots'}`, 2200);
    setTimeout(() => {
      els.resultTitle.textContent = isBest ? 'New best!' : 'Table cleared!';
      els.resultBody.innerHTML = '';
      const sc = document.createElement('div');
      sc.className = 'score';
      sc.textContent = `${score} shots`;
      const d = document.createElement('div');
      d.textContent = `${game.shots} strokes${game.fouls ? ` + ${game.fouls} ${game.fouls === 1 ? 'foul' : 'fouls'}` : ', no fouls'} · ${fmtTime(game.elapsed)}`;
      const b = document.createElement('div');
      b.className = 'muted';
      b.textContent = isBest ? (best ? `Previous best: ${best.score}` : 'Your first clearance.') : `Best: ${best.score} shots`;
      els.resultBody.append(sc, d, b);
      els.result.classList.remove('hidden');
    }, 2300);
  }
  const fmtTime = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

  // ---------------------------------------------------------------------------------------------
  // Frame loop
  let lastT = performance.now();
  function frame(now) {
    const dt = Math.min(0.05, (now - lastT) / 1000);
    lastT = now;
    update(dt);
    if (game.cue) {
      fitView(false);
      game.renderer.draw(game, now / 1000);
    }
    requestAnimationFrame(frame);
  }

  function update(dt) {
    if (game.aimHold && game.phase === 'aim' && (game.aimHoldT += dt) > 0) {
      const rate = 0.0012 * (1 + Math.min(game.aimHoldT, 2.5) * 5);
      game.aim += game.aimHold * rate * dt * 10;
    }
    if (game.inGame && els.menu.classList.contains('hidden')) game.elapsed += dt;
    const cs = game.cueStick;
    switch (game.phase) {
      case 'aim':
        cs.angle += Pool.util.angleDiff(game.aim, cs.angle) * Math.min(1, dt * 14);
        cs.pull = lerp(cs.pull, 0.015 + game.power * 0.03, Math.min(1, dt * 8));
        cs.alpha = Math.min(1, cs.alpha + dt * 3);
        updateGuide();
        break;
      case 'place':
        cs.angle = game.aim;
        cs.alpha = Math.max(0, cs.alpha - dt * 4);
        break;
      case 'strike': {
        // Draw back in proportion to the strength, then drive through.
        game.strikeT += dt;
        cs.angle = game.aim;
        const back = 0.02 + game.power * MAX_PULL;
        if (game.strikeT < PULL_TIME) cs.pull = lerp(cs.pull, back, Math.min(1, dt * 18));
        else cs.pull = lerp(back, -0.004, Math.min(1, (game.strikeT - PULL_TIME) / PUSH_TIME));
        if (game.strikeT >= PULL_TIME + PUSH_TIME) launchShot();
        break;
      }
      case 'roll': {
        game.followT += dt;
        cs.pull = Math.max(-0.05 - game.power * 0.06, cs.pull - dt * 0.6);
        cs.alpha = Math.max(0, 1 - Math.max(0, game.followT - 0.35) * 2.5);
        const steps = game.fastForward ? 4 : 1;
        for (let s = 0; s < steps && game.phase === 'roll'; s++) {
          handleEvents(P.step(game.sim, dt, []));
          if (!P.anyMoving(game.sim)) { game.phase = 'settle'; game.settleT = 0.4; }
        }
        break;
      }
      case 'settle':
        game.settleT -= dt;
        if (game.settleT <= 0) settleShot();
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
      if (ev.type === 'ball') {
        if (shot && shot.first == null && (ev.a === 0 || ev.b === 0)) shot.first = ev.a === 0 ? ev.b : ev.a;
        audio.play('ball', ev.speed);
        if (ev.speed > 2.5) spray(ev.x, ev.y, 'rgba(255,255,255,0.8)', 3, 0.4, 0.004);
      } else if (ev.type === 'cushion') {
        if (ev.kind === 'jaw') audio.play('jaw', ev.speed);
        else if (ev.speed > 0.15) audio.play('cushion', ev.speed);
      } else if (ev.type === 'pocket') {
        if (shot) {
          shot.pocketed.push({ n: ev.n, pocket: ev.pocket });
          if (ev.n === 0) shot.scratch = true;
        }
        audio.play('pocket', ev.speed);
        if (ev.n === 0) note('Scratch! The cue ball went down', 'bad');
        else note(`The ${ev.n} drops in the ${game.table.pockets[ev.pocket].name}`, 'good');
      }
    }
  }

  // ---------------------------------------------------------------------------------------------
  // Particles and camera
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
  function updateCamera(dt) {
    if (!game.cue) return;
    game.zoom = Math.exp(lerp(Math.log(game.zoom), Math.log(game.zoomTarget), 1 - Math.exp(-dt * 6)));
    const f = game.phase === 'roll' && game.cue.pocketed ? game.focus : game.cue;
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
    if (hudCache[key] !== text) { hudCache[key] = text; el.textContent = text; }
  }
  function updateHud(force) {
    if (!game.cue) return;
    if (force) Object.keys(hudCache).forEach((k) => delete hudCache[k]);
    const playing = ['roll', 'settle', 'done'].includes(game.phase);
    setText(els.shots, 'shots', playing ? `Shots: ${game.shots}` : `Shot ${game.shots + 1}`);
    setText(els.fouls, 'fouls', game.fouls ? `${game.fouls} ${game.fouls === 1 ? 'foul' : 'fouls'} (+${game.fouls})` : 'No fouls');
    els.fouls.classList.toggle('bad', game.fouls > 0);
    const live = liveBalls();
    setText(els.left, 'left', game.phase === 'place' ? `✋ Ball in hand · ${live.length} left` : `${live.length} left`);
    const key = live.map((b) => b.n).join(',');
    if (hudCache.tray !== key) {
      hudCache.tray = key;
      els.tray.innerHTML = '';
      for (const n of live.map((b) => b.n).sort((a, b) => a - b)) {
        const img = document.createElement('img');
        img.src = Rn.ballIcon(n, Math.round(15 * game.dpr), game.look);
        img.alt = String(n);
        els.tray.append(img);
      }
    }
  }
  function updateShootButton() {
    const labels = { place: 'PLACE ✓', aim: 'SHOOT', strike: 'SHOOT', roll: 'HOLD ⏩', settle: '…' };
    const label = labels[game.phase] || '…';
    if (hudCache.shoot !== label) {
      hudCache.shoot = label;
      els.shoot.textContent = label;
      els.shoot.classList.toggle('place', game.phase === 'place');
    }
    const enabled = ['place', 'aim', 'roll'].includes(game.phase);
    if (els.shoot.disabled === enabled) els.shoot.disabled = !enabled;
    const free = canAdjust();
    if (hudCache.free !== free) {
      hudCache.free = free;
      els.aimLeft.disabled = els.aimRight.disabled = !free;
      els.powerTrack.style.opacity = free ? 1 : 0.6;
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
  // One message line under the HUD; tap to dismiss.
  let noteTimer = null;
  function note(text, level = 'info', ms = 3200) {
    clearTimeout(noteTimer);
    els.notify.innerHTML = '';
    if (!text) return;
    const el = document.createElement('div');
    el.className = 'note ' + level;
    const t = document.createElement('span');
    t.className = 'txt';
    t.textContent = text;
    el.append(t);
    el.addEventListener('click', () => { els.notify.innerHTML = ''; });
    els.notify.append(el);
    noteTimer = setTimeout(() => { els.notify.innerHTML = ''; }, ms);
  }

  // ---------------------------------------------------------------------------------------------
  // Saving
  function save() {
    if (!game.inGame || game.phase === 'loading') return;
    saveJSON(SAVE_KEY, {
      balls: game.balls.map((b) => ({ n: b.n, x: +b.x.toFixed(5), y: +b.y.toFixed(5), p: b.pocketed ? 1 : 0 })),
      shots: game.shots, fouls: game.fouls, elapsed: Math.round(game.elapsed),
      hand: game.phase === 'place' ? game.handZone : null,
    });
  }
  function clearSave() {
    try { localStorage.removeItem(SAVE_KEY); } catch (e) { /* ignore */ }
  }
  function loadSave() {
    const s = loadJSON(SAVE_KEY, null);
    if (!s || !Array.isArray(s.balls) || s.balls.length !== 16 || !s.balls.some((b) => b.n === 0)) return null;
    return s;
  }
  function resume(s) {
    const rng = new Pool.RNG(7);
    const balls = s.balls.map((b) => {
      const ball = P.createBall(b.n, b.x, b.y, rng);
      if (b.p) Object.assign(ball, { pocketed: true, sinkT: 1 });
      return ball;
    });
    const cue = balls.find((b) => b.n === 0);
    startWith(balls, { shots: s.shots | 0, fouls: s.fouls | 0, elapsed: s.elapsed || 0, hand: s.hand || (cue.pocketed ? 'anywhere' : null) });
  }

  // ---------------------------------------------------------------------------------------------
  // Menus
  function hideOverlays() {
    for (const o of [els.menu, els.result, els.style]) o.classList.add('hidden');
  }
  function showMenu() {
    save();
    hideOverlays();
    els.menu.classList.remove('hidden');
    toggleSpinWindow(false);
    const s = game.inGame ? null : loadSave();
    const canContinue = game.inGame || !!s;
    els.continueBtn.classList.toggle('hidden', !canContinue);
    els.continueInfo.classList.toggle('hidden', !canContinue);
    if (canContinue) {
      const left = game.inGame ? liveBalls().length : s.balls.filter((b) => b.n !== 0 && !b.p).length;
      const shots = game.inGame ? game.shots + game.fouls : s.shots + s.fouls;
      els.continueInfo.textContent = `${left} balls left · ${shots} shots so far`;
    }
    els.play.className = canContinue ? 'secondary' : 'primary';
    const best = loadJSON(BEST_KEY, null);
    els.best.textContent = best ? `🏆 Best clearance: ${best.score} shots (${fmtTime(best.time || 0)})` : '';
  }

  // Table style screen: cloth, rails, room and guide, with a live preview.
  function buildStyle() {
    const opt = (wrap, list, key, render) => {
      wrap.innerHTML = '';
      for (const [id, v] of Object.entries(list)) {
        const b = document.createElement('button');
        render(b, v);
        b.title = v.name;
        b.setAttribute('aria-label', v.name);
        b.dataset.id = id;
        b.addEventListener('click', () => setStyle(key, id));
        wrap.append(b);
      }
    };
    const css = (c) => `rgb(${c[0]},${c[1]},${c[2]})`;
    opt(els.clothOpts, TH.CLOTHS, 'cloth', (b, v) => { b.className = 'swatch'; b.style.background = css(v.cloth); });
    opt(els.railOpts, TH.RAILS, 'rail', (b, v) => {
      b.className = 'swatch';
      b.style.background = `linear-gradient(135deg, ${css(v.rail)}, ${css(v.railDark)})`;
      if (v.trim) { b.style.outline = `2px solid ${css(v.trim)}`; b.style.outlineOffset = '-7px'; }
    });
    opt(els.roomOpts, TH.ROOMS, 'room', (b, v) => { b.className = 'chip'; b.textContent = `${v.emoji} ${v.name}`; });
    opt(els.guideOpts, { full: { name: 'Full' }, short: { name: 'Short' }, off: { name: 'Off' } }, 'guide', (b, v) => { b.className = 'chip'; b.textContent = v.name; });
    syncStyle();
  }
  function syncStyle() {
    for (const [wrap, key] of [[els.clothOpts, 'cloth'], [els.railOpts, 'rail'], [els.roomOpts, 'room'], [els.guideOpts, 'guide']]) {
      for (const b of wrap.children) b.classList.toggle('on', b.dataset.id === game.settings[key]);
    }
  }
  function setStyle(key, id) {
    audio.unlock();
    game.settings[key] = id;
    saveJSON(STYLE_KEY, game.settings);
    const prevMusic = game.look.music;
    game.look = TH.makeLook(game.settings);
    syncStyle();
    drawPreview();
    updateGuide(true);
    if (game.look.music !== prevMusic && game.inGame && Pool.music) Pool.music.play(game.look.music);
    hudCache.tray = null;
  }
  function showStyle() {
    els.style.classList.remove('hidden');
    syncStyle();
    requestAnimationFrame(drawPreview);
  }
  let previewTimer = null;
  function drawPreview() {
    clearTimeout(previewTimer);
    previewTimer = setTimeout(() => {
      const c = els.stylePreview, w = c.clientWidth, h = c.clientHeight;
      if (!w) return;
      const dpr = game.dpr;
      c.width = Math.round(w * dpr); c.height = Math.round(h * dpr);
      // The table turned sideways, filling the preview.
      const span = T.L + 2 * T.RAIL + 0.2, spanW = T.W + 2 * T.RAIL + 0.2;
      const s = Math.min(c.width / span, c.height / spanW);
      const layer = Rn.buildLayer(game.table, game.look, s);
      const ctx = c.getContext('2d');
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, c.width, c.height);
      ctx.setTransform(0, -s, s, 0, c.width / 2, c.height / 2);
      ctx.drawImage(layer.canvas, layer.x0, layer.y0, layer.w, layer.h);
      // A few balls so the cloth has something on it.
      const r = new Rn.Renderer(document.createElement('canvas'));
      r.view = { s, rot: true };
      r.dpr = 1;
      const balls = T.rackBalls(new Pool.RNG(3)).map((b) => P.createBall(b.n, b.x, b.y, new Pool.RNG(b.n * 31)));
      balls.push(P.createBall(0, 0.12, T.L * 0.3));
      for (const b of balls) {
        const sp = r.ballSprite(b, game.look);
        const rr = sp.N / 2 / s;
        ctx.drawImage(sp.canvas, b.x - rr, b.y - rr, 2 * rr, 2 * rr);
      }
    }, 30);
  }
  function closeStyle() {
    els.style.classList.add('hidden');
    if (game.inGame) fitView(true);
  }

  // ---------------------------------------------------------------------------------------------
  // Input
  const pointers = new Map();
  let pinch = null, placeDrag = null;

  function aimAt(sx, sy) {
    if (game.phase !== 'aim' || !game.cue) return;
    const w = game.renderer.toWorld(sx, sy);
    const c = game.cue;
    if (Math.hypot(w.x - c.x, w.y - c.y) * game.renderer.view.s < 14) return;
    game.aim = Math.atan2(w.y - c.y, w.x - c.x);
  }
  function moveCueTo(x, y) {
    const p = T.nearestPlace(game.table, game.balls, x, y, game.handZone);
    if (!p) return;
    game.cue.x = p.x;
    game.cue.y = p.y;
    game.placeOk = T.placeOk(game.table, game.balls, p.x, p.y, game.handZone);
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
      // Mouse: the ball jumps to the pointer.  Touch: drag it by the finger's movement so the finger
      // doesn't hide it, unless the finger lands right on it.
      const onBall = Math.hypot(w.x - game.cue.x, w.y - game.cue.y) < R * 4;
      placeDrag = { sx: e.clientX, sy: e.clientY, bx: game.cue.x, by: game.cue.y, abs: e.pointerType === 'mouse' || onBall, id: e.pointerId };
      if (placeDrag.abs) moveCueTo(w.x, w.y);
      return;
    }
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    aimAt(e.clientX, e.clientY);
  });
  els.canvas.addEventListener('pointermove', (e) => {
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch && pointers.size >= 2) {
      const [a, b] = [...pointers.values()];
      setZoom((pinch.zoom * Math.hypot(a.x - b.x, a.y - b.y)) / pinch.d);
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
    aimAt(e.clientX, e.clientY);
  });
  const endPointer = (e) => {
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinch = null;
    if (placeDrag && placeDrag.id === e.pointerId) placeDrag = null;
  };
  els.canvas.addEventListener('pointerup', endPointer);
  els.canvas.addEventListener('pointercancel', endPointer);
  els.canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    setZoom(game.zoomTarget * Math.exp(-e.deltaY * 0.0015));
  }, { passive: false });

  els.shoot.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    try { els.shoot.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    els.shoot.classList.add('pressed');
    pressShoot();
  });
  const shootUp = () => { els.shoot.classList.remove('pressed'); releaseShoot(); };
  els.shoot.addEventListener('pointerup', shootUp);
  els.shoot.addEventListener('pointercancel', shootUp);

  const holdAim = (btn, dir) => {
    btn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      if (game.phase !== 'aim') return;
      game.aim += dir * 0.0008; // about 0.05°
      game.aimHold = dir;
      game.aimHoldT = -0.3; // a pause before it starts repeating
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
    if (open) { syncSound(); syncMusic(); }
  };
  els.btnQuick.addEventListener('click', (e) => {
    e.stopPropagation();
    audio.unlock();
    setQuick(els.quickMenu.classList.contains('hidden'));
  });
  document.addEventListener('pointerdown', (e) => {
    if (!els.quickMenu.contains(e.target) && e.target !== els.btnQuick) setQuick(false);
  });
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
  const syncMusic = () => stateLabel(els.btnMusic, '♫ Music', Pool.music.enabled);
  els.btnSound.addEventListener('click', () => { audio.unlock(); audio.toggle(); syncSound(); });
  els.btnMusic.addEventListener('click', () => {
    audio.unlock();
    const on = Pool.music.toggle();
    syncMusic();
    note(on ? `♫ Music on${Pool.music.current ? ' — ' + Pool.music.current : ''}` : 'Music off', 'music', 2500);
  });
  els.btnNextTrack.addEventListener('click', () => { audio.unlock(); Pool.music.next(); setQuick(false); });
  els.btnNew.addEventListener('click', () => {
    setQuick(false);
    if (!game.inGame || game.shots === 0 || confirm('Start a new game? This one will be lost.')) newGame();
  });
  els.btnStyle.addEventListener('click', () => { setQuick(false); showStyle(); });
  els.btnStyleSide.addEventListener('click', () => { audio.unlock(); showStyle(); });
  els.btnMenu.addEventListener('click', () => { setQuick(false); showMenu(); });
  Pool.music.onTrack = (name) => setTimeout(() => { if (Pool.music.enabled && game.inGame) note(`♫ ${name}`, 'music', 3000); }, 2500);

  window.addEventListener('keydown', (e) => {
    if (!els.menu.classList.contains('hidden') || !els.style.classList.contains('hidden')) return;
    if (e.code === 'Space' || e.code === 'Enter') {
      e.preventDefault();
      if (!e.repeat) pressShoot();
    } else if (e.code === 'ArrowLeft' || e.code === 'ArrowRight') {
      if (game.phase === 'aim') game.aim += (e.code === 'ArrowLeft' ? -1 : 1) * (e.shiftKey ? 0.02 : 0.0008);
      e.preventDefault();
    } else if (e.code === 'ArrowUp' || e.code === 'ArrowDown') {
      if (canAdjust()) setPower(game.power + (e.code === 'ArrowUp' ? 1 : -1) * (e.shiftKey ? 0.05 : 0.01));
      e.preventDefault();
    } else if (e.code === 'KeyS') toggleSpinWindow();
    else if (e.code === 'KeyZ') setZoom(game.zoomTarget > 1.05 ? 1 : 2);
    else if (e.code === 'KeyN') Pool.music.next();
    else if (e.code === 'KeyM') { audio.toggle(); syncSound(); }
  });
  window.addEventListener('keyup', (e) => {
    if (e.code === 'Space' || e.code === 'Enter') releaseShoot();
  });

  // Block browser gestures that fight the game on mobile.
  document.addEventListener('gesturestart', (e) => e.preventDefault());
  document.addEventListener('dblclick', (e) => e.preventDefault());
  document.addEventListener('contextmenu', (e) => e.preventDefault());

  // Menu wiring.
  els.play.addEventListener('click', () => { audio.unlock(); clearSave(); newGame(); });
  els.continueBtn.addEventListener('click', () => {
    audio.unlock();
    if (game.inGame) { hideOverlays(); return; }
    const s = loadSave();
    if (s) resume(s);
  });
  els.btnStyleMenu.addEventListener('click', showStyle);
  els.styleDone.addEventListener('click', closeStyle);
  els.again.addEventListener('click', () => { audio.unlock(); newGame(); });
  els.resultMenu.addEventListener('click', showMenu);
  window.addEventListener('pagehide', save);
  document.addEventListener('visibilitychange', () => { if (document.hidden) save(); });

  // ---------------------------------------------------------------------------------------------
  // Boot
  buildStyle();
  resize();
  updatePowerUi();
  drawSpin();
  showMenu();
  setupOffline();
  requestAnimationFrame((t) => { lastT = t; requestAnimationFrame(frame); });

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
    newGame, setSpin, setPower, confirmPlace, toggleSpinWindow, showStyle,
    shoot(angle, power, a = 0, b = 0) {
      if (game.phase === 'place') confirmPlace();
      game.aim = angle;
      game.spinA = a;
      game.spinB = b;
      game.power = power;
      launchShot();
    },
  };
})();
