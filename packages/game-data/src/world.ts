import type { BuildingId } from './ids';

/** Island grid (§10.6). A tile is 1,000 engine units. */
export const GRID = 30;
/** The 2-tile shoreline ring where nothing can be built. */
export const SHORE = 2;
export const BUILD_MIN = SHORE;
export const BUILD_MAX = GRID - SHORE; // exclusive

export interface LayoutBuilding {
  /** Stable instance id inside one player's layout (not part of the sealed hash). */
  id: string;
  type: BuildingId;
  level: number;
  x: number;
  y: number;
}

export interface Layout {
  v: 1;
  buildings: LayoutBuilding[];
}

export const FACTIONS = [
  {
    id: 'thornmarch',
    name: 'Thornmarch',
    terrain: 'Pine and birch forests',
    look: 'Wardens in green cloaks, carved timber halls, antler motifs',
    colors: { primary: '#3f6b3a', secondary: '#e8dfc8', metal: '#8c8f86' },
  },
  {
    id: 'hollowdeep',
    name: 'Hollowdeep',
    terrain: 'Mountain halls under snow peaks',
    look: 'Broad stonewrights, runic iron, lantern-lit forges',
    colors: { primary: '#4b5563', secondary: '#e07b28', metal: '#6d6a65' },
  },
  {
    id: 'skyrend',
    name: 'Skyrend Compact',
    terrain: 'High cliffs, dragon eyries',
    look: 'Drake-tamers, sailcloth, bronze scale armour',
    colors: { primary: '#27527a', secondary: '#c08a3e', metal: '#b07d3c' },
  },
  {
    id: 'ashenfen',
    name: 'Ashen Fen',
    terrain: 'Misty marsh, standing stones',
    look: 'Mystics, bog-oak totems, will-o’-wisp lights',
    colors: { primary: '#5b3f7a', secondary: '#a9a6a0', metal: '#77736c' },
  },
] as const;
export type FactionId = (typeof FACTIONS)[number]['id'];

export const PERSONALITIES = [
  { id: 'bold', name: 'Bold', line: 'Charges first and asks later.' },
  { id: 'cunning', name: 'Cunning', line: 'Wins the battle before it starts.' },
  { id: 'steadfast', name: 'Steadfast', line: 'Holds the line, whatever comes.' },
  { id: 'merry', name: 'Merry', line: 'Laughs loudest when the odds are worst.' },
] as const;
export type PersonalityId = (typeof PERSONALITIES)[number]['id'];

export const OFFICERS = [
  { role: 'general', title: 'General', name: '' },
  { role: 'architect', title: 'Architect', name: 'Master Mason Orrin' },
  { role: 'strategist', title: 'Strategist', name: 'Captain Sefa Brightspear' },
  { role: 'night_captain', title: 'Night Captain', name: 'Watch-Captain Hale' },
  { role: 'intel', title: 'Intelligence Officer', name: 'Whisper' },
] as const;
export type OfficerRole = (typeof OFFICERS)[number]['role'];

// ---------------------------------------------------------------- layouts ---

class LayoutBuilder {
  private counts = new Map<string, number>();
  readonly buildings: LayoutBuilding[] = [];
  add(type: BuildingId, x: number, y: number, level = 1) {
    const n = (this.counts.get(type) ?? 0) + 1;
    this.counts.set(type, n);
    this.buildings.push({ id: `${type}-${n}`, type, level, x, y });
    return this;
  }
  /** Walls along the perimeter of the square [x0..x1] × [y0..y1] (inclusive). */
  ring(x0: number, y0: number, x1: number, y1: number, level = 1) {
    for (let x = x0; x <= x1; x++) {
      this.add('wall', x, y0, level);
      this.add('wall', x, y1, level);
    }
    for (let y = y0 + 1; y < y1; y++) {
      this.add('wall', x0, y, level);
      this.add('wall', x1, y, level);
    }
    return this;
  }
  line(x0: number, y0: number, x1: number, y1: number, level = 1) {
    const dx = Math.sign(x1 - x0);
    const dy = Math.sign(y1 - y0);
    let x = x0;
    let y = y0;
    for (;;) {
      this.add('wall', x, y, level);
      if (x === x1 && y === y1) break;
      x += dx;
      y += dy;
    }
    return this;
  }
  build(): Layout {
    return { v: 1, buildings: this.buildings };
  }
}

/** The base every new player starts with (Citadel 1). */
export function starterLayout(): Layout {
  return new LayoutBuilder()
    .add('citadel', 13, 13)
    .add('bowtower', 13, 8)
    .add('goldworks', 8, 13)
    .add('lumbercamp', 19, 13)
    .add('treasury', 13, 19)
    .add('timberyard', 8, 8)
    .add('musterhall', 19, 19)
    .add('warcamp', 19, 7)
    .ring(12, 12, 17, 17)
    .add('caltrops', 15, 11)
    .add('caltrops', 11, 15)
    .build();
}

function briarholt(): Layout {
  return new LayoutBuilder()
    .add('citadel', 12, 14)
    .add('bowtower', 17, 15)
    .add('goldworks', 6, 8)
    .add('lumbercamp', 20, 8)
    .add('treasury', 6, 19)
    .add('timberyard', 20, 20)
    .add('musterhall', 13, 20)
    .add('warcamp', 13, 6)
    .line(10, 12, 17, 12)
    .line(10, 13, 10, 18)
    .add('caltrops', 18, 13)
    .add('caltrops', 11, 19)
    .build();
}

function kragmoorDeep(): Layout {
  return new LayoutBuilder()
    .add('citadel', 13, 13, 2)
    .add('bowtower', 10, 10, 2)
    .add('bowtower', 17, 17, 2)
    .add('stonethrower', 17, 10, 1)
    .add('treasury', 10, 17, 2)
    .add('goldworks', 5, 13, 2)
    .add('goldworks', 13, 4, 1)
    .add('lumbercamp', 22, 13, 2)
    .add('lumbercamp', 13, 22, 1)
    .add('timberyard', 5, 22, 2)
    .add('musterhall', 22, 5, 2)
    .add('warcamp', 4, 4, 2)
    .ring(9, 9, 20, 20, 2)
    .add('caltrops', 13, 11)
    .add('caltrops', 16, 18)
    .add('caltrops', 11, 15)
    .add('caltrops', 18, 14)
    .build();
}

function saltspireEyrie(): Layout {
  return new LayoutBuilder()
    .add('citadel', 13, 13, 3)
    .add('obelisk', 9, 9, 2)
    .add('bowtower', 13, 9, 3)
    .add('ballista', 18, 9, 2)
    .add('bowtower', 9, 18, 3)
    .add('treasury', 13, 18, 3)
    .add('bowtower', 18, 18, 3)
    .add('stonethrower', 9, 13, 2)
    .add('stonethrower', 18, 13, 2)
    .add('emberwell', 9, 16, 2)
    .add('goldworks', 4, 4, 2)
    .add('goldworks', 23, 4, 2)
    .add('lumbercamp', 4, 23, 2)
    .add('lumbercamp', 23, 23, 2)
    .add('treasury', 13, 23, 2)
    .add('timberyard', 4, 13, 2)
    .add('timberyard', 23, 13, 2)
    .add('musterhall', 13, 3, 3)
    .add('warcamp', 3, 8, 2)
    .add('warcamp', 23, 8, 2)
    .ring(8, 8, 21, 21, 3)
    .ring(12, 12, 17, 17, 3)
    .add('caltrops', 16, 10, 2)
    .add('caltrops', 12, 10, 2)
    .add('caltrops', 16, 19, 2)
    .add('caltrops', 12, 19, 2)
    .add('caltrops', 10, 12, 2)
    .add('caltrops', 19, 16, 2)
    .build();
}

export type Difficulty = 'easy' | 'medium' | 'hard';

export interface NpcIsland {
  key: string;
  name: string;
  owner: string;
  difficulty: Difficulty;
  blurb: string;
  stored: { gold: number; timber: number };
  layout: () => Layout;
}

/** The seeded demo world (§10.8). */
export const NPC_ISLANDS: readonly NpcIsland[] = [
  {
    key: 'briarholt',
    name: 'Briarholt',
    owner: 'Thane Wulfric of Briarholt',
    difficulty: 'easy',
    blurb: 'A timber hamlet behind a half-built wall.',
    stored: { gold: 3000, timber: 3000 },
    layout: briarholt,
  },
  {
    key: 'kragmoor',
    name: 'Kragmoor Deep',
    owner: 'Stonewright Agna Kragmoor',
    difficulty: 'medium',
    blurb: 'A walled quarry-hold with a basalt thrower.',
    stored: { gold: 6000, timber: 6000 },
    layout: kragmoorDeep,
  },
  {
    key: 'saltspire',
    name: 'Saltspire Eyrie',
    owner: 'Drake-Mother Ysolde',
    difficulty: 'hard',
    blurb: 'A double-walled eyrie with a rune obelisk and a wyrm ballista.',
    stored: { gold: 9000, timber: 9000 },
    layout: saltspireEyrie,
  },
];

