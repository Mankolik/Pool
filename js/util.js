// Shared helpers: seeded RNG, value noise, small vector and math utilities.
(function () {
  const Pool = (globalThis.Pool = globalThis.Pool || {});

  function mulberry32(a) {
    return function () {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function hashString(str) {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  function hash2(x, y, seed) {
    let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(seed | 0, 1442695041)) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  }

  class RNG {
    constructor(seed) {
      this.seed = seed >>> 0;
      this.next = mulberry32(this.seed);
    }
    float(a = 0, b = 1) {
      return a + (b - a) * this.next();
    }
    int(a, b) {
      return Math.floor(this.float(a, b + 1));
    }
    chance(p) {
      return this.next() < p;
    }
    sign() {
      return this.next() < 0.5 ? -1 : 1;
    }
    pick(arr) {
      return arr[Math.floor(this.next() * arr.length)];
    }
    // Standard normal draw (Box–Muller).
    gauss() {
      const u = Math.max(1e-9, this.next()), v = this.next();
      return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    }
    shuffle(arr) {
      for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(this.next() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
      }
      return arr;
    }
  }

  // Smooth 2D value noise with fractal Brownian motion, range roughly [-1, 1].
  class Noise2D {
    constructor(seed) {
      this.seed = seed | 0;
    }
    value(x, y) {
      const xi = Math.floor(x), yi = Math.floor(y);
      const xf = x - xi, yf = y - yi;
      const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
      const s = this.seed;
      const a = hash2(xi, yi, s), b = hash2(xi + 1, yi, s);
      const c = hash2(xi, yi + 1, s), d = hash2(xi + 1, yi + 1, s);
      return (a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v) * 2 - 1;
    }
    fbm(x, y, octaves = 4, lacunarity = 2, gain = 0.5) {
      let sum = 0, amp = 1, norm = 0, f = 1;
      for (let i = 0; i < octaves; i++) {
        sum += this.value(x * f + i * 17.3, y * f - i * 9.1) * amp;
        norm += amp;
        amp *= gain;
        f *= lacunarity;
      }
      return sum / norm;
    }
  }

  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  const smoothstep = (a, b, x) => {
    const t = clamp((x - a) / (b - a), 0, 1);
    return t * t * (3 - 2 * t);
  };
  // Signed smallest difference between two angles, in (-PI, PI].
  const angleDiff = (a, b) => {
    let d = (a - b) % (2 * Math.PI);
    if (d > Math.PI) d -= 2 * Math.PI;
    if (d <= -Math.PI) d += 2 * Math.PI;
    return d;
  };
  const rgb = (c, k = 1) => `rgb(${Math.round(clamp(c[0] * k, 0, 255))},${Math.round(clamp(c[1] * k, 0, 255))},${Math.round(clamp(c[2] * k, 0, 255))})`;
  const rgba = (c, a) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;
  const hex = (s) => [parseInt(s.slice(1, 3), 16), parseInt(s.slice(3, 5), 16), parseInt(s.slice(5, 7), 16)];

  Pool.RNG = RNG;
  Pool.Noise2D = Noise2D;
  Pool.hashString = hashString;
  Pool.hash2 = hash2;
  Pool.util = { clamp, lerp, smoothstep, angleDiff, rgb, rgba, hex };
})();
