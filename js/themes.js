// Table style: the player picks a cloth, a rail finish and a room.  Purely cosmetic — every table plays
// the same.  Colours are [r, g, b].
(function () {
  const Pool = globalThis.Pool;

  const CLOTHS = {
    green: { name: 'Classic green', cloth: [44, 120, 62] },
    blue: { name: 'Tournament blue', cloth: [34, 102, 178] },
    red: { name: 'Casino red', cloth: [158, 30, 44] },
    burgundy: { name: 'Burgundy', cloth: [106, 22, 40] },
    purple: { name: 'Purple', cloth: [76, 44, 150] },
    teal: { name: 'Teal', cloth: [24, 146, 146] },
    olive: { name: 'Olive', cloth: [96, 112, 52] },
    grey: { name: 'Slate grey', cloth: [88, 96, 104] },
    black: { name: 'Black', cloth: [34, 36, 40] },
  };

  const RAILS = {
    oak: { name: 'Oak', rail: [150, 98, 52], railDark: [96, 58, 28], grain: 0.3, trim: null, diamond: [236, 226, 196], pocket: 'leather', pocketColor: [40, 26, 18] },
    walnut: { name: 'Walnut', rail: [92, 52, 28], railDark: [52, 26, 12], grain: 0.22, trim: null, diamond: [236, 226, 196], pocket: 'leather', pocketColor: [40, 26, 18] },
    mahogany: { name: 'Mahogany & brass', rail: [110, 36, 22], railDark: [56, 14, 8], grain: 0.16, trim: [214, 172, 84], diamond: [240, 206, 120], pocket: 'gold', pocketColor: [30, 10, 8] },
    black: { name: 'Black lacquer', rail: [30, 30, 34], railDark: [8, 8, 10], grain: 0.05, trim: [190, 192, 200], diamond: [232, 236, 244], pocket: 'pro', pocketColor: [14, 14, 16] },
    maple: { name: 'Maple', rail: [212, 170, 112], railDark: [160, 118, 66], grain: 0.18, trim: null, diamond: [60, 40, 24], pocket: 'net', pocketColor: [36, 22, 12] },
    bamboo: { name: 'Bamboo', rail: [196, 162, 92], railDark: [140, 108, 52], grain: 0.1, trim: null, diamond: [250, 246, 230], pocket: 'net', pocketColor: [40, 30, 20] },
    chrome: { name: 'Chrome & neon', rail: [96, 104, 120], railDark: [44, 48, 60], grain: 0, trim: [90, 240, 255], diamond: [120, 250, 255], pocket: 'portal', pocketColor: [6, 4, 20] },
  };

  // Rooms set the floor, the lamps, the props around the table and the music.
  const ROOMS = {
    pub: { name: 'Pub', emoji: '🍺', floor: 'boards', floorA: [70, 44, 26], floorB: [54, 32, 18], lamp: [255, 214, 150], lampK: 0.55, ambient: 0.62, glow: null },
    hall: { name: 'Tournament hall', emoji: '🏆', floor: 'carpet', floorA: [32, 34, 48], floorB: [24, 26, 38], lamp: [240, 246, 255], lampK: 0.7, ambient: 0.52, glow: null, decor: 'tournament', music: 'tournament' },
    casino: { name: 'Casino', emoji: '🎰', floor: 'casino', floorA: [72, 16, 30], floorB: [40, 8, 20], lamp: [255, 226, 170], lampK: 0.6, ambient: 0.55, glow: null },
    saloon: { name: 'Saloon', emoji: '🤠', floor: 'sawdust', floorA: [132, 94, 56], floorB: [104, 70, 40], lamp: [255, 196, 120], lampK: 0.6, ambient: 0.58, glow: null },
    space: { name: 'Space station', emoji: '🚀', floor: 'deck', floorA: [36, 40, 52], floorB: [26, 28, 38], lamp: [190, 170, 255], lampK: 0.5, ambient: 0.6, glow: [90, 240, 255] },
    beach: { name: 'Beach bar', emoji: '🌴', floor: 'sand', floorA: [222, 196, 142], floorB: [204, 176, 120], lamp: [255, 240, 200], lampK: 0.4, ambient: 0.78, glow: null },
  };

  const DEFAULT = { cloth: 'green', rail: 'walnut', room: 'pub', guide: 'full' };
  const ENV = { slide: 0.2, roll: 0.012, cushionE: 0.8, cushionMu: 0.2, gravity: 1, pocketK: 1.02, spinDecay: 9 };

  const shade = (c, k) => c.map((v) => Math.round(v * k));

  // Everything the renderer needs for one combination.
  function makeLook(s) {
    const c = CLOTHS[s.cloth] || CLOTHS.green, r = RAILS[s.rail] || RAILS.walnut;
    const roomId = ROOMS[s.room] ? s.room : 'pub';
    const room = ROOMS[roomId];
    return {
      id: roomId + ':' + s.cloth + ':' + s.rail,
      music: room.music || roomId,
      decor: room.decor || roomId,
      cloth: c.cloth, clothDark: shade(c.cloth, 0.6), cushion: shade(c.cloth, 0.88),
      rail: r.rail, railDark: r.railDark, grain: r.grain, trim: r.trim || (roomId === 'space' ? room.glow : null),
      diamond: r.diamond, pocket: r.pocket, pocketColor: r.pocketColor,
      floor: room.floor, floorA: room.floorA, floorB: room.floorB,
      lamp: room.lamp, lampK: room.lampK, ambient: room.ambient, glow: room.glow || (r.pocket === 'portal' ? [90, 240, 255] : null),
      env: ENV,
    };
  }

  Pool.themes = { CLOTHS, RAILS, ROOMS, DEFAULT, ENV, makeLook };
})();
