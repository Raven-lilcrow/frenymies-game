// What a course is made of (solids, obstacles, checkpoints), the difficulty table, and the seeded random
// numbers every course is built from. The courses themselves are in courses.ts.

export type Difficulty = 'easy' | 'normal' | 'hard';
export const DIFFICULTIES: Difficulty[] = ['easy', 'normal', 'hard'];

export interface DifficultyConfig {
  label: string;
  sections: number; // how many obstacle sections a match draws
  gap: number; // gap size multiplier
  speed: number; // obstacle speed multiplier
  secPerSection: number; // the timer is 30 s plus this per section
  checkpoints: number; // including the start
  fakeTiles: number; // fake tiles out of 4 on the bridge
  hammers: number;
}

export const DIFFICULTY: Record<Difficulty, DifficultyConfig> = {
  easy: { label: 'Easy', sections: 8, gap: 0.85, speed: 0.8, secPerSection: 22, checkpoints: 6, fakeTiles: 1, hammers: 1 },
  normal: { label: 'Normal', sections: 10, gap: 1, speed: 1, secPerSection: 18, checkpoints: 5, fakeTiles: 1, hammers: 1 },
  hard: { label: 'Hard', sections: 12, gap: 1.15, speed: 1.25, secPerSection: 15, checkpoints: 4, fakeTiles: 2, hammers: 2 },
};

/** Difficulty numbers for one round: the match's level, a notch harder for each later round. */
export function tuning(difficulty: Difficulty, ramp = 0): DifficultyConfig {
  const d = DIFFICULTY[difficulty];
  return { ...d, gap: d.gap * (1 + 0.05 * ramp), speed: d.speed * (1 + 0.1 * ramp) };
}

export type Section = 'hops' | 'hammer' | 'mover' | 'belt' | 'bar' | 'falling' | 'bridge' | 'fan' | 'gate' | 'seesaw';
export const SECTIONS: Section[] = ['hops', 'hammer', 'mover', 'belt', 'bar', 'falling', 'bridge', 'fan', 'gate', 'seesaw'];
export const SECTION_NAMES: Record<Section, string> = {
  hops: 'Hops', hammer: 'Hammer', mover: 'Moving platform', belt: 'Conveyor belt', bar: 'Rotating bar',
  falling: 'Falling platforms', bridge: 'Fake tiles', fan: 'Giant fan', gate: 'Gate', seesaw: 'Seesaw',
};

export interface Rect {
  x: number; // left
  top: number;
  w: number;
  h: number;
}

export type SolidKind =
  | 'static' | 'mover' | 'belt' | 'falling' | 'fake' | 'balanceL' | 'balanceR' | 'gate'
  | 'timed' // drops at a set moment of the round (Hot Plate tiles)
  | 'plank'; // breaks when too many beans stand on it (Trust Bridge)

/** The 5 rounds in the pool, and how each one is won. */
export type RoundType = 'ledge' | 'hotplate' | 'twokey' | 'tailtag' | 'bridge';
export type RoundMode = 'race' | 'survival' | 'hunt' | 'final';

/** Anything you can stand on or bump into. Where the moving ones are at any tick comes from world.ts. */
export interface Solid extends Rect {
  kind: SolidKind;
  ledge: boolean; // can you hang off its edges
  belt?: number; // conveyor: carries you this many px/s
  tile?: boolean; // one tile of a bridge (drawn with a seam; real and fake ones look the same)
  mover?: { minX: number; maxX: number; speed: number; phase: number };
  dropAt?: number; // 'timed': ticks after the round starts when it drops
  gate?: number; // 'gate': index into Level.gates
}

export interface Hammer {
  px: number; // pivot
  py: number;
  len: number;
  amp: number; // swing angle (radians)
  speed: number; // radians per second
  phase: number;
  r: number; // head radius
}

export interface Bar {
  cx: number; // pivot
  cy: number;
  len: number; // half length (pivot to tip)
  speed: number; // radians per second, sign = direction
  phase: number;
}

export interface Fan {
  x: number; // wind zone
  top: number;
  w: number;
  h: number;
  push: number; // px/s per second, negative = blows back toward the start
  onSec: number;
  offSec: number;
  phase: number; // seconds
}

export interface Gate {
  solid: number; // index of the gate solid
  x: number; // the gate line
  buttons: Array<{ x0: number; x1: number; top: number }>;
  autoEverySec: number; // opens by itself this often (so a solo player is never stuck)
  autoOpenSec: number;
  phase: number;
}

export interface Checkpoint {
  x: number; // counts once you stand past x + 20
  sx: number; // respawn point (body center)
  sy: number;
}

export interface Level {
  type: RoundType;
  mode: RoundMode;
  seed: number;
  difficulty: Difficulty;
  name: string;
  sections: Section[]; // obstacles in course order
  width: number;
  solids: Solid[];
  pads: Array<{ x0: number; x1: number; top: number }>;
  hammers: Hammer[];
  bars: Bar[];
  fans: Fan[];
  gates: Gate[];
  balance: { left: number; right: number; top: number } | null; // indexes of the two seesaw halves
  checkpoints: Checkpoint[];
  finishX: number; // 0: no finish line (arenas)
  finishTop: number;
  timerTicks: number;
  plankLimit: number; // a plank breaks once this many beans stand on it
  tails: number; // Tail Tag: how many tails are handed out
}

/** Small, fast, deterministic random numbers from a seed (mulberry32). */
export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The milestone 2 and 3 test level, everything static. The tests use it because its numbers never change. */
export function buildTestLevel(): Level {
  const rects: Array<[number, number, number, number]> = [
    [0, 800, 700, 300], [820, 760, 180, 40], [1110, 710, 160, 40], [1380, 760, 200, 40], [1680, 800, 360, 300],
    [2120, 780, 300, 40], [2600, 780, 360, 320], [2960, 560, 260, 540], [3380, 700, 220, 40], [3760, 700, 540, 400],
  ];
  return {
    type: 'ledge', mode: 'race', seed: 0, difficulty: 'normal', name: 'Test level', sections: [], width: 4300,
    solids: rects.map(([x, top, w, h]) => ({ kind: 'static' as const, x, top, w, h, ledge: true })),
    pads: [{ x0: 2860, x1: 2940, top: 780 }],
    hammers: [], bars: [], fans: [], gates: [], balance: null, plankLimit: 99, tails: 0,
    checkpoints: [
      { x: 0, sx: 150, sy: 740 }, { x: 1680, sx: 1720, sy: 740 }, { x: 2600, sx: 2650, sy: 720 }, { x: 2960, sx: 3020, sy: 500 },
    ],
    finishX: 3950, finishTop: 700, timerTicks: 100 * 60,
  };
}
