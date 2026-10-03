// Synthesised sound effects (no audio files): cue strikes, ball clicks, cushions, jaws and the rumble of
// a ball running down the return track.
(function () {
  const Pool = globalThis.Pool;
  let ctx = null;
  let out = null;
  let muted = false;
  try { muted = localStorage.getItem('pool.muted') === '1'; } catch (e) { /* storage unavailable */ }

  function unlock() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      ctx = new AC();
      out = ctx.createDynamicsCompressor();
      out.threshold.value = -14;
      out.ratio.value = 6;
      out.connect(ctx.destination);
      if (Pool.music) Pool.music.attach(ctx);
    }
    if (ctx.state === 'suspended' && !document.hidden) ctx.resume();
  }
  // Pause all audio while the app is in the background (and resume when it comes back).
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => {
      if (!ctx) return;
      if (document.hidden) ctx.suspend();
      else ctx.resume();
    });
  }

  let noiseBuf = null;
  function noiseBuffer() {
    if (!noiseBuf) {
      const len = ctx.sampleRate;
      noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    }
    return noiseBuf;
  }

  function noise(dur, freq, q, gain, type = 'bandpass', delay = 0, attack = 0.002) {
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer();
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    const t = ctx.currentTime + delay;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(out);
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur + 0.05);
  }

  function tone(freq, dur, gain, type = 'sine', delay = 0, slide = 0) {
    const o = ctx.createOscillator();
    o.type = type;
    const t = ctx.currentTime + delay;
    o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(freq * slide, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.003);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(out);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  // Ball-on-ball "clack": a bright, very short click whose pitch wanders a little.
  function clack(v, delay = 0) {
    const k = Math.min(1, v / 4);
    const f = 2600 + Math.random() * 900;
    tone(f, 0.03, 0.05 + 0.4 * k, 'sine', delay);
    tone(f * 1.52, 0.02, 0.02 + 0.15 * k, 'sine', delay);
    noise(0.025, 4200, 1.4, 0.04 + 0.35 * k, 'bandpass', delay, 0.001);
  }

  const sfx = {
    cue(power) {
      tone(1700, 0.04, 0.12 + 0.3 * power, 'triangle');
      noise(0.05, 3200, 0.9, 0.08 + 0.35 * power, 'bandpass', 0, 0.001);
      tone(240, 0.06, 0.05 + 0.1 * power, 'sine', 0, 0.7);
    },
    miscue() { tone(900, 0.09, 0.2, 'square', 0, 1.6); noise(0.08, 5200, 2, 0.2); },
    ball(v) { clack(v); },
    cushion(v) {
      const k = Math.min(1, v / 4);
      noise(0.09, 260, 0.8, 0.06 + 0.4 * k, 'lowpass', 0, 0.002);
      tone(120, 0.08, 0.04 + 0.2 * k, 'sine', 0, 0.75);
    },
    jaw(v) {
      const k = Math.min(1, v / 3);
      tone(700, 0.04, 0.08 + 0.2 * k, 'triangle', 0, 0.8);
      noise(0.05, 900, 1, 0.1 + 0.2 * k, 'bandpass');
    },
    pocket(v) {
      const k = Math.min(1, v / 3);
      tone(95, 0.18, 0.25 + 0.2 * k, 'sine', 0.02, 0.6);
      noise(0.12, 500, 0.7, 0.15 + 0.2 * k, 'lowpass', 0.02);
      // Rattling away down the ball return.
      noise(0.9, 180, 0.5, 0.12, 'lowpass', 0.25, 0.15);
      clack(0.6, 0.55);
      clack(0.4, 0.95);
    },
    chalk() { noise(0.18, 5200, 1.2, 0.08, 'bandpass', 0, 0.01); noise(0.12, 4800, 1.2, 0.06, 'bandpass', 0.2, 0.01); },
    place() { tone(520, 0.05, 0.08, 'triangle'); noise(0.04, 1200, 1, 0.08); },
    foul() { tone(196, 0.22, 0.12, 'square'); tone(147, 0.32, 0.12, 'square', 0.18); },
    good() { [523, 659, 784, 1046].forEach((f, i) => tone(f, 0.18, 0.12, 'sine', i * 0.08)); },
    jackpot() { [784, 988, 1175, 1568, 1976].forEach((f, i) => tone(f, 0.16, 0.1, 'triangle', i * 0.06)); noise(0.5, 7000, 1, 0.05, 'highpass', 0.3, 0.05); },
    clear() { [392, 523, 659, 784, 1046, 1318].forEach((f, i) => tone(f, 0.3, 0.1, 'sine', i * 0.07)); },
    tick() { tone(1500, 0.02, 0.05, 'square'); },
  };

  // Many collisions can land in one frame (the break): keep the loudest few.
  let budget = 0, budgetT = 0;
  function play(name, ...args) {
    if (muted || !ctx || ctx.state !== 'running') return;
    if (name === 'ball' || name === 'cushion') {
      const now = ctx.currentTime;
      if (now - budgetT > 0.03) { budgetT = now; budget = 0; }
      if (++budget > 6) return;
    }
    try { sfx[name](...args); } catch (e) { /* ignore audio errors */ }
  }

  Pool.audio = {
    unlock,
    play,
    get ctx() { return ctx; },
    get muted() { return muted; },
    toggle() {
      muted = !muted;
      try { localStorage.setItem('pool.muted', muted ? '1' : '0'); } catch (e) { /* ignore */ }
      return muted;
    },
  };
})();
