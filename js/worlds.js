// Venue definitions: every tour is played in one world with its own table look, room, lighting, cloth
// physics and a twist.  Colours are [r, g, b]; physics values are relative to a standard 9-ft table.
(function () {
  const Pool = globalThis.Pool;

  const WORLDS = {
    pub: {
      id: 'pub', name: 'Pub', emoji: '🍺', label: 'The local pub',
      twist: null,
      blurb: 'Classic green baize, warm lamps and a sticky floor.',
      cloth: [44, 120, 62], clothDark: [24, 76, 38], cushion: [36, 104, 52],
      rail: [92, 52, 28], railDark: [52, 26, 12], railLight: [140, 88, 50], grain: 0.22,
      trim: null, diamond: [236, 226, 196], pocket: 'leather', pocketColor: [40, 26, 18],
      floor: 'boards', floorA: [70, 44, 26], floorB: [54, 32, 18],
      lamp: [255, 214, 150], lampK: 0.55, ambient: 0.62, glow: null,
      decor: 'pub',
      env: { slide: 0.2, roll: 0.012, cushionE: 0.78, cushionMu: 0.2, gravity: 1, pocketK: 1.04, spinDecay: 9 },
      venues: ['The Crooked Cue', 'The Red Lion', 'The Rack & Ruin', 'The Chalk & Cheese', 'The Kiss Shot Arms', 'The Old Baize', 'The Black Ball Inn', 'The Snooker Loopy'],
      music: 'pub',
    },
    tournament: {
      id: 'tournament', name: 'Tournament hall', emoji: '🏆', label: 'Tournament hall',
      twist: 'Fast cloth, lively cushions, tight pockets',
      blurb: 'Fast new cloth, lively cushions and tight pro pockets.',
      cloth: [34, 102, 178], clothDark: [18, 58, 116], cushion: [28, 90, 160],
      rail: [26, 26, 30], railDark: [8, 8, 10], railLight: [70, 72, 80], grain: 0.06,
      trim: [190, 192, 200], diamond: [232, 236, 244], pocket: 'pro', pocketColor: [14, 14, 16],
      floor: 'carpet', floorA: [32, 34, 48], floorB: [24, 26, 38],
      lamp: [240, 246, 255], lampK: 0.7, ambient: 0.52, glow: null,
      decor: 'tournament',
      env: { slide: 0.18, roll: 0.0085, cushionE: 0.86, cushionMu: 0.16, gravity: 1, pocketK: 0.93, spinDecay: 7.5 },
      parK: 1.18,
      venues: ['Grand Masters Arena', 'The Crucible Hall', 'Diamond Cup Pavilion', 'Champions Court', 'The Golden Break Open', 'Rack Masters Dome'],
      music: 'tournament',
    },
    casino: {
      id: 'casino', name: 'Casino', emoji: '🎰', label: 'Casino lounge',
      twist: 'A lucky pocket each rack: pot into it for −1 shot',
      blurb: 'Red velvet, brass trim and one lucky pocket per rack.',
      cloth: [158, 30, 44], clothDark: [96, 12, 24], cushion: [140, 24, 38],
      rail: [96, 34, 22], railDark: [50, 14, 8], railLight: [150, 66, 44], grain: 0.16,
      trim: [214, 172, 84], diamond: [240, 206, 120], pocket: 'gold', pocketColor: [30, 10, 8],
      floor: 'casino', floorA: [72, 16, 30], floorB: [40, 8, 20],
      lamp: [255, 226, 170], lampK: 0.6, ambient: 0.55, glow: null,
      decor: 'casino',
      env: { slide: 0.2, roll: 0.011, cushionE: 0.8, cushionMu: 0.2, gravity: 1, pocketK: 1, spinDecay: 9 },
      venues: ['The Lucky Seven', 'Golden Rail Casino', 'The High Roller', 'Club Jackpot', 'The Velvet Ace', 'Royal Flush Lounge'],
      music: 'casino',
    },
    saloon: {
      id: 'saloon', name: 'Saloon', emoji: '🤠', label: 'Wild West saloon',
      twist: 'Worn slow cloth, dead cushions — and the table leans',
      blurb: 'A worn old table that isn\'t quite level. Big pockets, though.',
      cloth: [92, 112, 52], clothDark: [58, 70, 30], cushion: [80, 98, 44],
      rail: [150, 98, 52], railDark: [96, 58, 28], railLight: [196, 142, 88], grain: 0.35,
      trim: null, diamond: [226, 214, 176], pocket: 'net', pocketColor: [36, 22, 12],
      floor: 'sawdust', floorA: [132, 94, 56], floorB: [104, 70, 40],
      lamp: [255, 196, 120], lampK: 0.6, ambient: 0.58, glow: null,
      decor: 'saloon',
      env: { slide: 0.24, roll: 0.0165, cushionE: 0.68, cushionMu: 0.24, gravity: 1, pocketK: 1.14, spinDecay: 11, tilt: 0.0024 },
      venues: ['The Dusty Spur', 'Last Chance Saloon', 'The Rattlesnake', 'Tumbleweed Tavern', 'The Gold Nugget', 'Dead Man\'s Hand'],
      music: 'saloon',
    },
    space: {
      id: 'space', name: 'Space station', emoji: '🚀', label: 'Orbital lounge',
      twist: 'Low gravity: balls slide and roll much further',
      blurb: 'Glowing cloth in 0.45 g. Spin lasts forever; go gently.',
      cloth: [66, 40, 150], clothDark: [30, 16, 82], cushion: [56, 34, 132],
      rail: [96, 104, 120], railDark: [44, 48, 60], railLight: [190, 200, 220], grain: 0,
      trim: [90, 240, 255], diamond: [120, 250, 255], pocket: 'portal', pocketColor: [6, 4, 20],
      floor: 'deck', floorA: [36, 40, 52], floorB: [26, 28, 38],
      lamp: [190, 170, 255], lampK: 0.5, ambient: 0.6, glow: [90, 240, 255],
      decor: 'space',
      env: { slide: 0.2, roll: 0.012, cushionE: 0.84, cushionMu: 0.18, gravity: 0.45, pocketK: 1.02, spinDecay: 9 },
      venues: ['Orbital Lounge 7', 'Kepler Rec Deck', 'The Event Horizon', 'Lagrange Point Bar', 'Station Nebula', 'The Zero-G Club'],
      music: 'space',
    },
    beach: {
      id: 'beach', name: 'Beach bar', emoji: '🌴', label: 'Beach bar',
      twist: 'Sand blown onto the cloth slows the balls',
      blurb: 'Teal cloth, bamboo rails and drifts of sand on the table.',
      cloth: [24, 150, 150], clothDark: [10, 96, 102], cushion: [20, 132, 134],
      rail: [196, 162, 92], railDark: [140, 108, 52], railLight: [232, 206, 140], grain: 0.1,
      trim: null, diamond: [250, 246, 230], pocket: 'net', pocketColor: [40, 30, 20],
      floor: 'sand', floorA: [222, 196, 142], floorB: [204, 176, 120],
      lamp: [255, 240, 200], lampK: 0.4, ambient: 0.78, glow: null,
      decor: 'beach',
      env: { slide: 0.21, roll: 0.0135, cushionE: 0.76, cushionMu: 0.2, gravity: 1, pocketK: 1.08, spinDecay: 9.5, sand: true },
      venues: ['The Driftwood Shack', 'Coconut Cove Bar', 'The Salty Pelican', 'Tiki Pockets', 'Sunset Reef Club', 'The Barefoot Break'],
      music: 'beach',
    },
  };
  const WORLD_ORDER = ['pub', 'tournament', 'casino', 'saloon', 'space', 'beach'];

  // A seed's world comes from its own hash, so a seed always plays in the same place.
  function worldForSeed(seed) {
    const h = Pool.hashString('world:' + String(seed).toLowerCase());
    return WORLDS[WORLD_ORDER[h % WORLD_ORDER.length]];
  }

  Pool.WORLDS = WORLDS;
  Pool.WORLD_ORDER = WORLD_ORDER;
  Pool.worldForSeed = worldForSeed;
})();
