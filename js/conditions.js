// Table conditions: optional rules for a game, chosen before the break and fixed for the whole game.
// Each one is independent, so they can be mixed freely.  The table's look (themes.js) never affects play.
(function () {
  const Pool = globalThis.Pool;
  const BASE = Pool.themes.ENV;

  const CONDITIONS = [
    { id: 'cloth', name: 'Cloth speed', icon: '🧶', options: [
      { id: 'slow', name: 'Slow', hint: 'Worn cloth: balls stop sooner', env: { roll: 0.0165, slide: 0.24 } },
      { id: 'normal', name: 'Normal' },
      { id: 'fast', name: 'Fast', hint: 'New cloth: balls run further', env: { roll: 0.0085, slide: 0.18, spinDecay: 7.5 } },
    ] },
    { id: 'cushions', name: 'Cushions', icon: '🛞', options: [
      { id: 'dead', name: 'Dead', hint: 'Balls come off the rails slowly', env: { cushionE: 0.66, cushionMu: 0.24 } },
      { id: 'normal', name: 'Normal' },
      { id: 'lively', name: 'Lively', hint: 'Fast, bouncy rails', env: { cushionE: 0.88, cushionMu: 0.16 } },
    ] },
    { id: 'pockets', name: 'Pockets', icon: '🕳️', options: [
      { id: 'tight', name: 'Tight', hint: 'Pro-size pockets', env: { pocketK: 0.9 } },
      { id: 'normal', name: 'Normal' },
      { id: 'generous', name: 'Generous', hint: 'Bar-table buckets', env: { pocketK: 1.16 } },
    ] },
    { id: 'gravity', name: 'Gravity', icon: '🪐', options: [
      { id: 'normal', name: 'Normal' },
      { id: 'low', name: 'Low (0.45 g)', hint: 'Less friction: balls slide and roll much further, spin lasts', env: { gravity: 0.45 } },
    ] },
    { id: 'lean', name: 'Table lean', icon: '📐', options: [
      { id: 'off', name: 'Level' },
      { id: 'on', name: 'Leaning', hint: 'Slow balls drift downhill — watch the spirit level' },
    ] },
    { id: 'sand', name: 'Sand on the cloth', icon: '🏖️', options: [
      { id: 'off', name: 'Clean' },
      { id: 'on', name: 'Sandy', hint: 'Patches of sand slow balls rolling through them' },
    ] },
    { id: 'lucky', name: 'Lucky pocket', icon: '★', options: [
      { id: 'off', name: 'Off' },
      { id: 'on', name: 'On', hint: 'Pot into the gold pocket on a clean shot for −1; then it moves' },
    ] },
  ];
  const STANDARD = Object.fromEntries(CONDITIONS.map((c) => [c.id, c.id === 'lean' || c.id === 'sand' || c.id === 'lucky' ? 'off' : 'normal']));

  function option(cond, id) {
    const c = CONDITIONS.find((q) => q.id === cond);
    return c.options.find((o) => o.id === id) || c.options.find((o) => o.id === STANDARD[cond]);
  }
  // Fill in anything missing or unknown with the standard setting.
  function normalize(sel) {
    const out = {};
    for (const c of CONDITIONS) out[c.id] = option(c.id, sel && sel[c.id]).id;
    return out;
  }
  const isStandard = (sel) => CONDITIONS.every((c) => normalize(sel)[c.id] === STANDARD[c.id]);
  // A stable key for the best-score table.
  const key = (sel) => (isStandard(sel) ? 'standard' : CONDITIONS.map((c) => normalize(sel)[c.id]).join('-'));

  // The physics environment for a selection.
  function envFor(sel) {
    const env = { ...BASE };
    for (const c of CONDITIONS) Object.assign(env, option(c.id, normalize(sel)[c.id]).env || {});
    return env;
  }

  // The random parts (lean direction, sand patches, first lucky pocket), drawn once at the start of a game.
  function rollExtras(sel, rng) {
    const s = normalize(sel);
    const ex = { tilt: null, sand: [], lucky: -1 };
    if (s.lean === 'on') {
      const a = rng.float(0, Math.PI * 2), m = 0.0024 * rng.float(0.85, 1.15);
      ex.tilt = { a, m, x: Math.cos(a) * m, y: Math.sin(a) * m };
    }
    if (s.sand === 'on') {
      const n = rng.int(3, 5);
      for (let k = 0; k < n; k++) {
        const a = rng.float(0, Math.PI);
        ex.sand.push({ x: rng.float(-0.5, 0.5), y: rng.float(-1.1, 1.1), rx: rng.float(0.08, 0.2), ry: rng.float(0.05, 0.12), c: Math.cos(a), s: Math.sin(a), k: rng.float(2.5, 4), a });
      }
    }
    if (s.lucky === 'on') ex.lucky = rng.int(0, 5);
    return ex;
  }

  // Short summary for the HUD and menus, e.g. "Fast cloth · Low g · ★".
  function summary(sel) {
    const s = normalize(sel);
    if (isStandard(s)) return 'Standard table';
    const parts = [];
    if (s.cloth !== 'normal') parts.push(`${option('cloth', s.cloth).name} cloth`);
    if (s.cushions !== 'normal') parts.push(`${option('cushions', s.cushions).name} cushions`);
    if (s.pockets !== 'normal') parts.push(`${option('pockets', s.pockets).name} pockets`);
    if (s.gravity === 'low') parts.push('Low g');
    if (s.lean === 'on') parts.push('Leaning');
    if (s.sand === 'on') parts.push('Sandy');
    if (s.lucky === 'on') parts.push('Lucky ★');
    return parts.join(' · ');
  }

  Pool.conditions = { CONDITIONS, STANDARD, option, normalize, isStandard, key, envFor, rollExtras, summary };
})();
