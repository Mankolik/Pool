// Procedural soundtrack: a small Web Audio sequencer with synthesised instruments and two tracks per
// venue (pub blues, tournament ambience, casino swing and bossa, saloon honky-tonk, space synthwave,
// beach calypso and reggae).  Tracks are generated from a chord progression, a scale and a seeded
// melody, with walking bass lines and comping, so there are no audio files to download.
(function () {
  const Pool = globalThis.Pool;

  const CHORDS = {
    maj: [0, 4, 7], min: [0, 3, 7], maj7: [0, 4, 7, 11], min7: [0, 3, 7, 10], dom7: [0, 4, 7, 10], dom9: [0, 4, 7, 10, 14],
    m9: [0, 3, 7, 10, 14], maj9: [0, 4, 7, 11, 14], sus4: [0, 5, 7], m7b5: [0, 3, 6, 10], six: [0, 4, 7, 9], dim7: [0, 3, 6, 9],
  };
  const MAJ = [0, 2, 4, 5, 7, 9, 11], MIN = [0, 2, 3, 5, 7, 8, 10], DORIAN = [0, 2, 3, 5, 7, 9, 10], MIXO = [0, 2, 4, 5, 7, 9, 10];
  const BLUES = [0, 3, 5, 6, 7, 10], MAJPENTA = [0, 2, 4, 7, 9], MINPENTA = [0, 3, 5, 7, 10], LYDIAN = [0, 2, 4, 6, 7, 9, 11];

  // steps: steps per beat; bpc: bars per chord; swing: delay of off-steps (fraction of a step).
  // bass: { inst, pat } (R root, O octave, 5 fifth, 3 third, . rest) or { inst, walk: true } (walking bass).
  // comp: { inst, pat } chord stabs; arp: { inst, every }; lead: { inst, density, oct }.
  const TRACKS = {
    pub: [
      { name: 'Last Orders', bpm: 76, beats: 4, steps: 3, root: 58, scale: BLUES, bpc: 1, swing: 0,
        chords: [[0, 'dom7'], [5, 'dom7'], [0, 'dom7'], [0, 'dom7'], [5, 'dom7'], [5, 'dom7'], [0, 'dom7'], [0, 'dom7'], [7, 'dom9'], [5, 'dom7'], [0, 'dom7'], [7, 'dom7']],
        bass: { inst: 'upright', walk: true }, comp: { inst: 'rhodes', pat: '..x..x...x..' },
        lead: { inst: 'sax', density: 0.36, oct: 12 }, drums: { brush: 'x.xx.xx.xx.x', kick: 'x.....x.....' } },
      { name: 'Chalk Dust Shuffle', bpm: 112, beats: 4, steps: 2, root: 53, scale: MAJPENTA, bpc: 1, swing: 0.33,
        chords: [[0, 'six'], [9, 'min7'], [2, 'min7'], [7, 'dom7']],
        bass: { inst: 'upright', walk: true }, comp: { inst: 'piano', pat: '..x...x.' },
        lead: { inst: 'piano', density: 0.5, oct: 24 }, drums: { ride: 'x.xxx.xx', hat: '..x...x.' } },
    ],
    tournament: [
      { name: 'Under the Lights', bpm: 90, beats: 4, steps: 4, root: 50, scale: MIN, bpc: 2,
        chords: [[0, 'm9'], [8, 'maj7'], [3, 'maj9'], [10, 'sus4']],
        pad: 'strings', bass: { inst: 'sub', pat: 'R.......R.....5.' }, arp: { inst: 'glass', every: 2 },
        lead: { inst: 'piano', density: 0.16, oct: 24 }, drums: { tick: '..x...x...x...x.', kick: 'x.......x.......' } },
      { name: 'Match Point', bpm: 68, beats: 4, steps: 4, root: 57, scale: DORIAN, bpc: 2,
        chords: [[0, 'min7'], [5, 'dom9'], [0, 'min7'], [10, 'maj7']],
        pad: 'strings', lead: { inst: 'piano', density: 0.3, oct: 12 }, arp: { inst: 'glass', every: 4 } },
    ],
    casino: [
      { name: 'High Roller Swing', bpm: 168, beats: 4, steps: 2, root: 55, scale: MAJ, bpc: 1, swing: 0.34,
        chords: [[0, 'six'], [9, 'dom7'], [2, 'min7'], [7, 'dom7'], [4, 'min7'], [9, 'dom7'], [2, 'min7'], [7, 'dom9']],
        bass: { inst: 'upright', walk: true }, comp: { inst: 'brass', pat: '...x....' },
        lead: { inst: 'trumpet', density: 0.42, oct: 12 }, drums: { ride: 'x.xxx.xx', hat: '..x...x.', kick: 'x.......' } },
      { name: 'Velvet Lounge', bpm: 124, beats: 4, steps: 2, root: 52, scale: DORIAN, bpc: 2,
        chords: [[0, 'min7'], [5, 'dom9'], [3, 'maj7'], [8, 'maj7'], [2, 'm7b5'], [7, 'dom7']],
        bass: { inst: 'upright', pat: 'R..5R..5' }, comp: { inst: 'nylon', pat: 'x.xx.x.x' },
        lead: { inst: 'rhodes', density: 0.32, oct: 24 }, drums: { rim: 'x..x..x.', shaker: 'xxxxxxxx' } },
    ],
    saloon: [
      { name: 'Honky-Tonk Break', bpm: 132, beats: 4, steps: 2, root: 55, scale: MAJPENTA, bpc: 1,
        chords: [[0, 'maj'], [0, 'maj'], [5, 'maj'], [0, 'maj'], [7, 'dom7'], [5, 'maj'], [0, 'maj'], [7, 'dom7']],
        bass: { inst: 'tuba', pat: 'R...5...' }, comp: { inst: 'honky', pat: '..x...x.' },
        lead: { inst: 'honky', density: 0.55, oct: 24 }, drums: { brush: '..x...x.', kick: 'x...x...' } },
      { name: 'Dusty Spurs', bpm: 96, beats: 3, steps: 2, root: 52, scale: MAJ, bpc: 1,
        chords: [[0, 'maj'], [5, 'maj'], [7, 'maj'], [0, 'maj'], [9, 'min'], [5, 'maj'], [7, 'dom7'], [0, 'maj']],
        bass: { inst: 'upright', pat: 'R.5.5.' }, arp: { inst: 'banjo', every: 1 },
        lead: { inst: 'harmonica', density: 0.34, oct: 12 } },
    ],
    space: [
      { name: 'Orbital Lounge', bpm: 104, beats: 4, steps: 4, root: 57, scale: MIN, bpc: 1,
        chords: [[0, 'min7'], [8, 'maj7'], [3, 'maj7'], [10, 'sus4']],
        pad: 'lush', bass: { inst: 'synthBass', pat: 'R.RO.R.RR.RO.R.R' }, arp: { inst: 'sqArp', every: 1 },
        lead: { inst: 'synthLead', density: 0.22, oct: 12 }, drums: { kick: 'x...x...x...x...', snare: '....x.......x...', hat: '..x...x...x...x.' } },
      { name: 'Zero-G Drift', bpm: 70, beats: 4, steps: 4, root: 62, scale: LYDIAN, bpc: 2,
        chords: [[0, 'maj9'], [2, 'maj'], [7, 'maj7'], [4, 'min7']],
        pad: 'lush', bass: { inst: 'sub', pat: 'R.......R.......' }, lead: { inst: 'bleep', density: 0.18, oct: 24 }, arp: { inst: 'glass', every: 3 } },
    ],
    beach: [
      { name: 'Tiki Pockets', bpm: 118, beats: 4, steps: 2, root: 60, scale: MAJ, bpc: 1,
        chords: [[0, 'maj'], [5, 'maj'], [7, 'dom7'], [0, 'maj']],
        bass: { inst: 'upright', pat: 'R..R5..5' }, comp: { inst: 'nylon', pat: '.x.x.xx.' },
        lead: { inst: 'steel', density: 0.62, oct: 12 }, drums: { conga: 'x..x..x.', shaker: 'xxxxxxxx', clave: 'x..x...x' } },
      { name: 'Sunset Reef', bpm: 76, beats: 4, steps: 2, root: 55, scale: MIXO, bpc: 2,
        chords: [[0, 'maj'], [10, 'maj'], [5, 'maj'], [0, 'maj']],
        bass: { inst: 'synthBass', pat: 'R..5.O.5' }, comp: { inst: 'organ', pat: '.x.x.x.x' },
        lead: { inst: 'steel', density: 0.3, oct: 12 }, drums: { kick: '....x...', rim: '....x...', hat: 'x.x.x.x.' } },
    ],
  };

  let ctx = null, out = null, echo = null, noiseBuf = null;
  let enabled = true;
  try { enabled = localStorage.getItem('pool.music') !== '0'; } catch (e) { /* storage unavailable */ }
  let world = null, trackIdx = 0, track = null, step = 0, nextT = 0, timer = null, onTrack = null, wanted = null;
  const VOLUME = 0.15;
  // Loudness trims so every track sits at roughly the same level (measured with renderOffline).
  const TRIM = {
    'Under the Lights': 0.5, 'Match Point': 1.5, 'Zero-G Drift': 0.57, 'Sunset Reef': 1.7, 'Chalk Dust Shuffle': 1.12, 'Dusty Spurs': 1.15,
  };
  const level = () => VOLUME * (track ? TRIM[track.name] || 1 : 1);

  const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
  function hashStr(s) {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }
  function rngFrom(seed) {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // ---- Instruments ------------------------------------------------------------------------------
  function env(g, t, a, peak, d, sustain = 0.0001) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + a);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0001, sustain), t + a + d);
  }
  function voice(t, freq, type, dur, peak, { attack = 0.005, cutoff = 4000, cutoffEnd = null, q = 0.7, send = 0, detune = 0, release = 0.05, hold = false, vib = 0, vibRate = 5.5 } = {}) {
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    o.detune.value = detune;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.Q.value = q;
    f.frequency.setValueAtTime(cutoff, t);
    if (cutoffEnd) f.frequency.exponentialRampToValueAtTime(cutoffEnd, t + Math.max(0.05, dur));
    const g = ctx.createGain();
    if (hold) {
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(peak, t + attack);
      g.gain.setValueAtTime(peak, t + Math.max(attack, dur - release));
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur + release);
    } else env(g, t, attack, peak, dur);
    o.connect(f).connect(g).connect(out);
    if (send) {
      const s = ctx.createGain();
      s.gain.value = send;
      g.connect(s).connect(echo);
    }
    if (vib) {
      const lfo = ctx.createOscillator(), lg = ctx.createGain();
      lfo.frequency.value = vibRate;
      lg.gain.value = freq * vib;
      lfo.connect(lg).connect(o.frequency);
      lfo.start(t + 0.1);
      lfo.stop(t + dur + release + 0.1);
    }
    o.start(t);
    o.stop(t + dur + release + 0.1);
    return o;
  }
  const INST = {
    // Keys.
    piano: (t, m, d, v) => {
      voice(t, mtof(m), 'triangle', 1.1, 0.13 * v, { cutoff: 3600, cutoffEnd: 900, send: 0.12 });
      voice(t, mtof(m) * 2, 'sine', 0.4, 0.03 * v);
    },
    rhodes: (t, m, d, v) => {
      voice(t, mtof(m), 'sine', 1.3, 0.13 * v, { send: 0.18, vib: 0.002, vibRate: 4.5 });
      voice(t, mtof(m) * 3.0, 'sine', 0.18, 0.035 * v);
    },
    honky: (t, m, d, v) => {
      // Two slightly out-of-tune strings per note: the bar-room upright.
      voice(t, mtof(m), 'triangle', 0.7, 0.09 * v, { cutoff: 3000, cutoffEnd: 800, detune: -9 });
      voice(t, mtof(m), 'triangle', 0.7, 0.09 * v, { cutoff: 3000, cutoffEnd: 800, detune: 11 });
    },
    organ: (t, m, d, v) => {
      for (const [k, a] of [[1, 0.05], [2, 0.03], [3, 0.015]]) voice(t, mtof(m) * k, 'sine', Math.min(0.22, d), a * v, { attack: 0.01, hold: true, release: 0.05 });
    },
    glass: (t, m, d, v) => {
      voice(t, mtof(m + 12), 'sine', 1.6, 0.06 * v, { send: 0.35 });
      voice(t, mtof(m + 12) * 2.76, 'sine', 0.4, 0.015 * v, { send: 0.2 });
    },
    // Strings and winds.
    nylon: (t, m, d, v) => voice(t, mtof(m), 'triangle', 0.6, 0.12 * v, { cutoff: 2400, cutoffEnd: 500 }),
    banjo: (t, m, d, v) => voice(t, mtof(m + 12), 'sawtooth', 0.28, 0.05 * v, { cutoff: 4200, cutoffEnd: 1200, q: 3 }),
    sax: (t, m, d, v) => voice(t, mtof(m), 'sawtooth', Math.max(0.15, d * 0.95), 0.055 * v, { attack: 0.04, cutoff: 1500, q: 2.5, hold: true, release: 0.08, send: 0.15, vib: 0.006, vibRate: 5 }),
    trumpet: (t, m, d, v) => voice(t, mtof(m), 'sawtooth', Math.max(0.1, d * 0.85), 0.05 * v, { attack: 0.025, cutoff: 2600, q: 1.5, hold: true, release: 0.05, send: 0.12, vib: 0.005 }),
    brass: (t, m, d, v) => voice(t, mtof(m), 'sawtooth', 0.16, 0.04 * v, { attack: 0.02, cutoff: 2000, cutoffEnd: 900, q: 1.2 }),
    harmonica: (t, m, d, v) => voice(t, mtof(m), 'square', Math.max(0.15, d * 0.9), 0.035 * v, { attack: 0.03, cutoff: 1800, q: 1.4, hold: true, release: 0.08, send: 0.15, vib: 0.008, vibRate: 6 }),
    steel: (t, m, d, v) => {
      voice(t, mtof(m), 'sine', 0.7, 0.11 * v, { send: 0.15 });
      voice(t, mtof(m) * 2.01, 'sine', 0.35, 0.05 * v);
      voice(t, mtof(m) * 3.02, 'sine', 0.12, 0.03 * v);
    },
    // Synths.
    synthLead: (t, m, d, v) => voice(t, mtof(m), 'sawtooth', Math.max(0.15, d), 0.05 * v, { attack: 0.02, cutoff: 2600, hold: true, release: 0.12, send: 0.3, detune: 7, vib: 0.004 }),
    bleep: (t, m, d, v) => voice(t, mtof(m), 'square', 0.25, 0.045 * v, { cutoff: 2500, send: 0.45 }),
    sqArp: (t, m, d, v) => voice(t, mtof(m), 'square', 0.18, 0.035 * v, { cutoff: 1800, cutoffEnd: 600, send: 0.35 }),
    // Bass.
    upright: (t, m, d, v) => voice(t, mtof(m), 'triangle', Math.min(0.6, d * 1.1), 0.34 * v, { cutoff: 800, cutoffEnd: 220, attack: 0.008 }),
    tuba: (t, m, d, v) => voice(t, mtof(m), 'sawtooth', Math.min(0.35, d), 0.12 * v, { cutoff: 520, q: 1.5, attack: 0.02, hold: true, release: 0.06 }),
    sub: (t, m, d, v) => voice(t, mtof(m), 'sine', Math.min(0.9, d), 0.32 * v, { attack: 0.01, hold: true, release: 0.08 }),
    synthBass: (t, m, d, v) => voice(t, mtof(m), 'sawtooth', Math.min(0.22, d), 0.14 * v, { cutoff: 700, cutoffEnd: 180, q: 4 }),
  };
  const PADS = {
    strings: { type: 'sawtooth', cutoff: 1100, peak: 0.028, detune: 9 },
    lush: { type: 'sawtooth', cutoff: 1500, peak: 0.03, detune: 14 },
  };
  function pad(t, notes, dur, kind) {
    const p = PADS[kind];
    for (const m of notes) for (const dt of [-p.detune, p.detune])
      voice(t, mtof(m), p.type, dur, p.peak, { attack: Math.min(0.8, dur * 0.3), hold: true, release: 0.9, cutoff: p.cutoff, detune: dt, send: 0.1 });
  }
  function noiseHit(t, dur, type, freq, peak, q = 1) {
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    env(g, t, 0.002, peak, dur);
    src.connect(f).connect(g).connect(out);
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur + 0.05);
  }
  function thump(t, f0, f1, dur, peak) {
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const g = ctx.createGain();
    env(g, t, 0.003, peak, dur);
    o.connect(g).connect(out);
    o.start(t);
    o.stop(t + dur + 0.05);
  }
  const DRUMS = {
    kick: (t, v) => thump(t, 120, 45, 0.26, 0.45 * v),
    snare: (t, v) => { noiseHit(t, 0.16, 'bandpass', 1800, 0.22 * v, 0.8); thump(t, 220, 160, 0.08, 0.1 * v); },
    hat: (t, v) => noiseHit(t, 0.04, 'highpass', 7500, 0.06 * v),
    ride: (t, v) => { noiseHit(t, 0.35, 'highpass', 6000, 0.05 * v); voice(t, 3200, 'sine', 0.3, 0.008 * v); },
    brush: (t, v) => noiseHit(t, 0.12, 'bandpass', 3500, 0.05 * v, 0.6),
    rim: (t, v) => { noiseHit(t, 0.03, 'bandpass', 2400, 0.12 * v, 4); thump(t, 900, 700, 0.03, 0.05 * v); },
    shaker: (t, v) => noiseHit(t, 0.06, 'bandpass', 6500, 0.045 * v, 1.5),
    clave: (t, v) => voice(t, 2500, 'sine', 0.06, 0.07 * v),
    conga: (t, v) => { thump(t, 260, 190, 0.18, 0.2 * v); noiseHit(t, 0.03, 'bandpass', 1500, 0.04 * v, 2); },
    tick: (t, v) => noiseHit(t, 0.02, 'highpass', 9000, 0.05 * v),
  };

  // ---- Arrangement ---------------------------------------------------------------------------------
  function scaleNotes(def, lo, hi) {
    const out = [];
    for (let m = lo; m <= hi; m++) if (def.scale.includes((((m - def.root) % 12) + 12) % 12)) out.push(m);
    return out;
  }
  // A seeded melody for one pass of the progression: chord tones on strong beats, scale steps between.
  function makeMelody(def, seed) {
    const rnd = rngFrom(seed);
    const per = def.beats * def.steps, bars = def.chords.length * def.bpc;
    const base = def.root + def.lead.oct;
    const notes = scaleNotes(def, base - 5, base + 14);
    const i0 = notes.findIndex((m) => m >= base + 4);
    let idx = i0 < 0 ? 0 : i0;
    const mel = [];
    for (let bar = 0; bar < bars; bar++) {
      const [deg, q] = def.chords[Math.floor(bar / def.bpc) % def.chords.length];
      const pcs = CHORDS[q].map((i) => (((deg + i) % 12) + 12) % 12);
      for (let s = 0; s < per; s++) {
        const strong = s % def.steps === 0;
        const p = def.lead.density * (s === 0 ? 1.5 : strong ? 1.2 : 0.55);
        if (rnd() >= p) { mel.push(null); continue; }
        if (strong) {
          let best = idx, bestD = 99;
          notes.forEach((m, i) => {
            if (!pcs.includes((((m - def.root) % 12) + 12) % 12)) return;
            const d = Math.abs(i - idx) + rnd() * 2.5;
            if (d < bestD) { bestD = d; best = i; }
          });
          idx = best;
        } else {
          idx += [-2, -1, -1, 1, 1, 2][Math.floor(rnd() * 6)];
          idx = Math.max(0, Math.min(notes.length - 1, idx));
        }
        mel.push(notes[idx]);
      }
    }
    return mel.map((m, i) => {
      if (m == null) return null;
      let len = 1;
      while (i + len < mel.length && mel[i + len] == null && len < def.steps * 2) len++;
      return { m, len };
    });
  }
  // Walking bass: a chord tone on every beat, with a chromatic step into the next chord's root.
  function makeWalk(def, seed) {
    const rnd = rngFrom(seed);
    const bars = def.chords.length * def.bpc, line = [];
    for (let bar = 0; bar < bars; bar++) {
      const [deg, q] = def.chords[Math.floor(bar / def.bpc) % def.chords.length];
      const [ndeg] = def.chords[Math.floor((bar + 1) / def.bpc) % def.chords.length];
      const root = def.root - 24 + deg;
      const tones = CHORDS[q].map((i) => root + (i > 11 ? i - 12 : i));
      for (let b = 0; b < def.beats; b++) {
        let m;
        if (b === 0) m = root;
        else if (b === def.beats - 1) {
          let next = def.root - 24 + ndeg;
          while (next - root > 7) next -= 12;
          while (root - next > 7) next += 12;
          m = next + (rnd() < 0.5 ? -1 : 1);
        } else m = tones[1 + Math.floor(rnd() * (tones.length - 1))] + (rnd() < 0.2 ? 12 : 0);
        line.push(m);
      }
    }
    return line;
  }
  function prepare(def) {
    const seed = hashStr(def.name);
    const A = def.lead ? makeMelody(def, seed) : null, B = def.lead ? makeMelody(def, seed ^ 0x9e3779b9) : null;
    const walk = def.bass && def.bass.walk ? makeWalk(def, seed ^ 0x51ed) : null;
    const per = def.beats * def.steps, bars = def.chords.length * def.bpc;
    const loopSec = (bars * def.beats * 60) / def.bpm;
    return { ...def, A, B, walk, per, bars, loopSec, loops: Math.max(3, Math.round(110 / loopSec)) };
  }

  function scheduleStep(t0) {
    const d = track;
    const stepDur = 60 / d.bpm / d.steps;
    const s = step % d.per;
    const barIdx = Math.floor(step / d.per);
    const bar = barIdx % d.bars;
    const loop = Math.floor(barIdx / d.bars);
    if (loop >= d.loops) return 'next';
    const t = t0 + (d.swing && s % 2 === 1 ? d.swing * stepDur : 0);
    const [deg, q] = d.chords[Math.floor(bar / d.bpc) % d.chords.length];
    const root = d.root + deg;
    const tones = CHORDS[q].map((i) => root + i);
    const first = loop === 0, last = loop === d.loops - 1;
    if (s === 0 && bar % d.bpc === 0 && d.pad) {
      const dur = (d.bpc * d.beats * 60) / d.bpm;
      pad(t, tones.slice(0, 4).map((m) => (m >= d.root + 12 ? m - 12 : m)), dur, d.pad);
    }
    // Bass: a walking line on the beats, or a pattern.
    if (d.bass) {
      if (d.walk) {
        if (s % d.steps === 0) INST[d.bass.inst](t, d.walk[(bar * d.beats + s / d.steps) % d.walk.length], stepDur * d.steps, s === 0 ? 1 : 0.85);
      } else {
        const ch = d.bass.pat[s % d.bass.pat.length];
        const map = { R: 0, O: 12, 5: 7, 3: tones[1] - root };
        if (ch in map) INST[d.bass.inst](t, root - 12 + map[ch], stepDur * 2, 1);
      }
    }
    // Comping: chord stabs on the pattern.
    if (d.comp && !first) {
      const ch = d.comp.pat[s % d.comp.pat.length];
      if (ch === 'x') for (const m of tones.slice(1, 4)) INST[d.comp.inst](t, m, stepDur * 1.5, 0.55);
    }
    if (d.arp && s % d.arp.every === 0) {
      const seq = [...tones, ...tones.slice(1, -1).reverse()];
      INST[d.arp.inst](t, seq[(step / d.arp.every) % seq.length | 0] + 12, stepDur * d.arp.every, 0.8);
    }
    // Melody (enters after the intro pass; phrases A A B A).
    if (d.lead && !first) {
      const phrase = [d.A, d.A, d.B, d.A][loop % 4];
      const n = phrase[bar * d.per + s];
      if (n) INST[d.lead.inst](t, n.m, n.len * stepDur, s % d.steps === 0 ? 1 : 0.8);
    }
    if (d.drums && !first && !last) {
      for (const k in d.drums) {
        const pat = d.drums[k];
        if (pat[s % pat.length] === 'x') DRUMS[k](t, s % d.steps === 0 ? 1 : 0.7);
      }
    }
    return null;
  }

  function scheduleUntil(horizon) {
    while (track && nextT < horizon) {
      if (scheduleStep(nextT) === 'next') {
        nextTrack(true);
        return;
      }
      nextT += 60 / track.bpm / track.steps;
      step++;
    }
  }
  function tick() {
    if (!ctx || !track || !enabled) return;
    if (nextT < ctx.currentTime) nextT = ctx.currentTime + 0.05; // resumed after a pause
    scheduleUntil(ctx.currentTime + 0.15);
  }

  function setup(audioCtx) {
    ctx = audioCtx;
    out = ctx.createGain();
    out.gain.value = 0;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -18;
    comp.ratio.value = 3;
    out.connect(comp).connect(ctx.destination);
    // Echo send (a small room).
    echo = ctx.createGain();
    const dl = ctx.createDelay(1.5), fb = ctx.createGain(), lp = ctx.createBiquadFilter();
    dl.delayTime.value = 0.29;
    fb.gain.value = 0.3;
    lp.type = 'lowpass';
    lp.frequency.value = 2200;
    echo.connect(dl).connect(lp).connect(fb).connect(dl);
    lp.connect(out);
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const ch = noiseBuf.getChannelData(0);
    for (let i = 0; i < ch.length; i++) ch[i] = Math.random() * 2 - 1;
  }

  function startTrack(idx, fadeIn = 1.5) {
    const list = TRACKS[world] || TRACKS.pub;
    trackIdx = ((idx % list.length) + list.length) % list.length;
    track = prepare(list[trackIdx]);
    step = 0;
    nextT = ctx.currentTime + 0.1;
    const g = out.gain;
    g.cancelScheduledValues(ctx.currentTime);
    g.setValueAtTime(g.value, ctx.currentTime);
    g.linearRampToValueAtTime(enabled ? level() : 0, ctx.currentTime + fadeIn);
    if (onTrack) onTrack(track.name);
  }
  function nextTrack(auto) {
    if (!ctx || !world) return;
    const g = out.gain, now = ctx.currentTime;
    g.cancelScheduledValues(now);
    g.setValueAtTime(g.value, now);
    g.linearRampToValueAtTime(0, now + (auto ? 1.2 : 0.4));
    track = null;
    setTimeout(() => startTrack(trackIdx + 1), auto ? 1400 : 450);
  }

  function play(worldId) {
    wanted = worldId;
    if (!ctx) return; // starts once audio is unlocked by a tap
    if (world === worldId && track) return;
    world = worldId;
    if (!timer) timer = setInterval(tick, 25);
    startTrack(Math.floor(Math.random() * 2));
  }

  Pool.music = {
    TRACKS,
    attach(audioCtx) {
      if (ctx) return;
      setup(audioCtx);
      if (wanted) play(wanted);
    },
    play,
    next() { if (track || world) nextTrack(false); },
    get enabled() { return enabled; },
    get current() { return track ? track.name : null; },
    set onTrack(fn) { onTrack = fn; },
    toggle() {
      enabled = !enabled;
      try { localStorage.setItem('pool.music', enabled ? '1' : '0'); } catch (e) { /* ignore */ }
      if (ctx && out) {
        const now = ctx.currentTime;
        out.gain.cancelScheduledValues(now);
        out.gain.setValueAtTime(out.gain.value, now);
        out.gain.linearRampToValueAtTime(enabled && track ? level() : 0, now + 0.4);
      }
      return enabled;
    },
    // Offline rendering for tests and loudness trims.
    async renderOffline(OfflineCtx, worldId, idx, seconds) {
      const saved = { ctx, out, echo, noiseBuf, world, track, step, nextT, trackIdx };
      const oc = new OfflineCtx(1, 22050 * seconds, 22050);
      setup(oc);
      world = worldId;
      trackIdx = idx;
      track = prepare((TRACKS[worldId] || TRACKS.pub)[idx]);
      track.loops = 99;
      step = track.per * track.bars;
      nextT = 0;
      out.gain.value = level();
      scheduleUntil(seconds);
      const buf = await oc.startRendering();
      ({ ctx, out, echo, noiseBuf, world, track, step, nextT, trackIdx } = saved);
      return buf;
    },
  };
})();
