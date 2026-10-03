// The 5 rounds' courses, each built from a seed, the match difficulty and how far into the match it is
// (`ramp`: 0 for round 1, 1 for round 2, 2 for the final; each one a notch harder). The server and every
// browser build the exact same course from those numbers, so only they are ever sent over the network.
//
// All courses are put together from the same pieces (a Builder): a start, obstacle sections that each
// end on a safe landing where a checkpoint can go, and an ending.
import {
  SECTIONS, rng, tuning, type Checkpoint, type Difficulty, type DifficultyConfig, type Level,
  type RoundMode, type RoundType, type Section, type Solid,
} from './level.ts';

const G = 800; // ground level
const DOOR_H = 340; // doors: taller than a double jump

class Builder {
  x = 0;
  readonly level: Level;
  readonly d: DifficultyConfig;
  readonly rand: () => number;
  private candidates: Checkpoint[] = []; // places a checkpoint could go, in course order

  constructor(type: RoundType, mode: RoundMode, name: string, seed: number, difficulty: Difficulty, ramp: number) {
    this.d = tuning(difficulty, ramp);
    this.rand = rng(seed);
    this.level = {
      type, mode, seed, difficulty, name, sections: [], width: 0, solids: [], pads: [], hammers: [], bars: [], fans: [],
      gates: [], balance: null, checkpoints: [], finishX: 0, finishTop: 0, timerTicks: 0, plankLimit: 99, tails: 0,
    };
  }

  between(a: number, b: number): number {
    return a + (b - a) * this.rand();
  }
  gap(base: number): number {
    return Math.round(base * this.d.gap * this.between(0.9, 1.1));
  }
  shuffle<T>(a: T[]): T[] {
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(this.rand() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }
  add(s: Omit<Solid, 'ledge'> & { ledge?: boolean }): number {
    this.level.solids.push({ ledge: true, ...s });
    return this.level.solids.length - 1;
  }
  ground(x: number, top: number, w: number, h = 1100 - top): number {
    return this.add({ kind: 'static', x, top, w, h });
  }
  cpAt(x: number, top: number): void {
    this.candidates.push({ x, sx: x + 40, sy: top - 60 });
  }

  start(w = 700): void {
    this.ground(0, G, w);
    this.x = w;
  }

  /** The safe ground every section ends on (a checkpoint can go here). */
  landing(w = 280): void {
    this.cpAt(this.x, G);
    this.ground(this.x, G, w);
    this.x += w;
  }

  // ---------- obstacle sections (Ledge Run draws from these; other courses reuse some) ----------

  section(s: Section): void {
    this[s]();
  }

  /**
   * n sections from the pool in a random order. Once the pool is used up it is shuffled again (longer
   * courses repeat some), never the same section twice in a row, and the seesaw only once (one per course).
   */
  draw(pool: readonly Section[], n: number): Section[] {
    const out: Section[] = [];
    while (out.length < n) {
      const next = this.shuffle(pool.filter((s) => s !== 'seesaw' || !out.includes('seesaw')));
      if (next[0] === out[out.length - 1] && next.length > 1) next.push(next.shift()!);
      out.push(...next.slice(0, n - out.length));
    }
    return out;
  }

  /** Three hops up and down. */
  hops(): void {
    for (const lift of [40, 90, 40]) {
      this.x += this.gap(130);
      const w = Math.round(this.between(160, 200));
      this.ground(this.x, G - lift + Math.round(this.between(-12, 12)), w, 40);
      this.x += w;
    }
    this.x += this.gap(130);
    this.landing();
  }

  /** A platform under a swinging hammer (two on Hard, out of step). Not a checkpoint: nobody should respawn under a hammer. */
  hammer(): void {
    this.x += this.gap(110);
    this.ground(this.x, G, 400);
    const n = this.d.hammers;
    for (let i = 0; i < n; i++) {
      const px = this.x + (n === 1 ? 200 : 130 + i * 140);
      this.level.hammers.push({ px, py: 500, len: 272, amp: 1.05, speed: 1.9 * this.d.speed, phase: i * Math.PI + this.between(0, Math.PI * 2), r: 30 });
    }
    this.x += 400;
    this.x += this.gap(100);
    this.landing();
  }

  /** A moving platform across a wide gap. */
  mover(): void {
    const span = this.gap(560);
    const w = 170;
    const x = this.x;
    this.add({ kind: 'mover', x: x + 50, top: 780, w, h: 20, ledge: false, mover: { minX: x + 50, maxX: x + span - 50 - w, speed: 150 * this.d.speed, phase: this.rand() } });
    this.x += span;
    this.landing();
  }

  /** A conveyor belt that pushes you back toward the gap behind it. */
  belt(): void {
    this.x += this.gap(100);
    this.add({ kind: 'belt', x: this.x, top: G, w: 440, h: 300, belt: -130 * this.d.speed });
    this.x += 440;
    this.landing();
  }

  /** A rotating bar: pass while it is flat, or jump the low arm. */
  bar(): void {
    this.x += this.gap(100);
    this.ground(this.x, G, 380);
    this.level.bars.push({ cx: this.x + 190, cy: G - 90, len: 110, speed: (this.rand() < 0.5 ? -1 : 1) * 1.5 * this.d.speed, phase: this.between(0, Math.PI * 2) });
    this.x += 380;
    this.x += this.gap(90);
    this.landing();
  }

  /** Falling platforms over a pit. */
  falling(): void {
    for (let i = 0; i < 3; i++) {
      this.x += this.gap(95);
      this.add({ kind: 'falling', x: this.x, top: 790 - i * 15 + Math.round(this.between(-10, 10)), w: 120, h: 24, ledge: false });
      this.x += 120;
    }
    this.x += this.gap(95);
    this.landing();
  }

  /** A bridge of 4 tiles over a pit; some are fake and give way when stepped on. */
  bridge(): void {
    const fake = new Set(this.shuffle([0, 1, 2, 3]).slice(0, this.d.fakeTiles));
    this.x += 6;
    for (let i = 0; i < 4; i++) {
      if (fake.has(i)) this.add({ kind: 'fake', x: this.x, top: G, w: 110, h: 30, ledge: false, tile: true });
      else this.add({ kind: 'static', x: this.x, top: G, w: 110, h: 30, tile: true });
      this.x += 110;
    }
    this.x += 6;
    this.landing();
  }

  /** A gap with a fan that blows you back now and then: jump while it is off. */
  fan(): void {
    const span = this.gap(240);
    this.level.fans.push({ x: this.x, top: 520, w: span, h: 300, push: -1500 * this.d.speed, onSec: 2, offSec: 1.6, phase: this.between(0, 3.6) });
    this.x += span;
    this.landing();
  }

  /** A gate with a button on each side that holds it open for everyone ("hold the door"). */
  gate(autoEverySec = 7, autoOpenSec = 1.4): void {
    this.x += this.gap(90);
    const x = this.x;
    this.cpAt(x, G);
    this.ground(x, G, 720);
    const gx = x + 330;
    const lv = this.level;
    // taller than a double jump reaches (about 260), so the only ways past are a plate or a throw
    const solid = this.add({ kind: 'gate', x: gx, top: G - DOOR_H, w: 24, h: DOOR_H, ledge: false, gate: lv.gates.length });
    lv.gates.push({
      solid, x: gx + 12,
      buttons: [{ x0: x + 90, x1: x + 170, top: G }, { x0: x + 520, x1: x + 600, top: G }],
      autoEverySec, autoOpenSec, phase: this.between(0, autoEverySec),
    });
    this.x += 720;
  }

  /** A seesaw over a pit: your weight tips your side down. */
  seesaw(): void {
    this.x += this.gap(80);
    const left = this.add({ kind: 'balanceL', x: this.x, top: 790, w: 180, h: 24, ledge: false });
    const right = this.add({ kind: 'balanceR', x: this.x + 180, top: 790, w: 180, h: 24, ledge: false });
    this.level.balance = { left, right, top: 790 };
    this.x += 360;
    this.x += this.gap(80);
    this.landing();
  }

  // ---------- endings ----------

  /** Bounce pad up onto the tall block, then the finish. */
  padFinish(): void {
    this.x += this.gap(80);
    this.cpAt(this.x, 780);
    this.ground(this.x, 780, 360);
    this.level.pads.push({ x0: this.x + 260, x1: this.x + 340, top: 780 });
    this.x += 360;
    this.ground(this.x, 560, 260);
    this.x += 260;
    this.x += this.gap(150);
    this.flatFinish(700);
  }

  /** A plain finish platform. */
  flatFinish(top = G): void {
    this.ground(this.x, top, 600);
    this.level.finishX = this.x + 200;
    this.level.finishTop = top;
    this.x += 600;
  }

  /** Close the course: width, timer, and checkpoints spread evenly over the candidates. */
  done(timerSec: number, checkpoints = this.d.checkpoints): Level {
    const lv = this.level;
    lv.width = this.x;
    lv.timerTicks = Math.round(timerSec * 60);
    if (!lv.checkpoints.length) lv.checkpoints.push({ x: 0, sx: 150, sy: G - 60 });
    const c = this.candidates;
    const extra = Math.min(checkpoints - 1, c.length);
    for (let i = 0; i < extra; i++) lv.checkpoints.push(c[extra === 1 ? 0 : Math.round((i * (c.length - 1)) / (extra - 1))]);
    return lv;
  }
}

// ---------- the 5 rounds ----------

/**
 * Ledge Run (race). `only` forces these sections in this order (the tests use it to get every obstacle);
 * otherwise the seed picks DIFFICULTY.sections of them in a random order.
 */
export function buildLedgeRun(seed: number, difficulty: Difficulty, only?: Section[], ramp = 0): Level {
  const b = new Builder('ledge', 'race', 'Ledge Run', seed, difficulty, ramp);
  const sections = only ?? b.draw(SECTIONS, b.d.sections);
  b.level.sections = sections;
  b.start();
  for (const s of sections) b.section(s);
  b.padFinish();
  return b.done(30 + sections.length * b.d.secPerSection);
}

/**
 * Two-Key Door (race, co-op): 3 doors that open while someone stands on a plate. They open by
 * themselves too, but rarely, so going together is much faster. Something different between the doors.
 */
export function buildTwoKeyDoor(seed: number, difficulty: Difficulty, ramp = 0): Level {
  const b = new Builder('twokey', 'race', 'Two-Key Door', seed, difficulty, ramp);
  const auto = { easy: 10, normal: 13, hard: 16 }[difficulty];
  const between = b.draw(['hops', 'falling', 'fan', 'belt', 'bar', 'mover'], 4);
  b.level.sections = ['gate', between[0], between[1], 'gate', between[2], between[3], 'gate'];
  b.start();
  b.gate(auto, 1.5);
  b.section(between[0]);
  b.section(between[1]);
  b.gate(auto, 1.5);
  b.section(between[2]);
  b.section(between[3]);
  b.gate(auto, 1.5);
  b.x += b.gap(100);
  b.flatFinish();
  return b.done(30 + 3 * (auto + 8) + between.length * b.d.secPerSection, 6);
}

/**
 * Trust Bridge (final): a long bridge of planks over the pit. A plank breaks when too many beans stand
 * on it at once, so cross together carefully, or shove someone off to lighten it. First across wins.
 */
export function buildTrustBridge(seed: number, difficulty: Difficulty, ramp = 0): Level {
  const b = new Builder('bridge', 'final', 'Trust Bridge', seed, difficulty, ramp);
  const planks = { easy: 16, normal: 20, hard: 24 }[difficulty];
  b.level.plankLimit = difficulty === 'hard' ? 2 : 3;
  b.level.sections = [];
  b.start();
  for (let i = 0; i < planks; i++) {
    b.x += b.gap(55);
    b.add({ kind: 'plank', x: b.x, top: G - 10 + Math.round(b.between(-25, 25)), w: 200, h: 22 });
    b.x += 200;
    if (i % 4 === 3 && i < planks - 1) {
      b.x += b.gap(55);
      if (i % 8 === 7 && difficulty !== 'easy') b.hammer(); // every other stop is a hammer to get past
      else b.landing(240);
    }
  }
  b.x += b.gap(70);
  b.flatFinish();
  return b.done(40 + planks * 4 + b.level.hammers.length * 8, 6);
}

/**
 * Hot Plate (survival): two layers of tiles over the pit. Tiles shake, then drop one by one; fall
 * through the top layer and you land on the bottom one, fall off that and you are out. Last bean
 * standing wins.
 */
export function buildHotPlate(seed: number, difficulty: Difficulty, ramp = 0): Level {
  const b = new Builder('hotplate', 'survival', 'Hot Plate', seed, difficulty, ramp);
  const lv = b.level;
  const tiles = 14;
  const tw = 110, seam = 6, x0 = 400;
  const every = ({ easy: 4, normal: 3.2, hard: 2.6 }[difficulty] / b.d.speed) * 60; // ticks between drops
  const first = 4 * 60;
  const tiers = [620, 900];
  let t = first;
  let last = 0;
  tiers.forEach((top, tier) => {
    const order = b.shuffle([...Array(tiles).keys()]);
    // the bottom layer starts dropping before the top one is gone, so nobody can just wait down there
    if (tier === 1) t = first + every * tiles * 0.6;
    const at = new Map(order.map((k, n) => [k, Math.round(t + n * every * (tier ? 1.15 : 1))]));
    for (let k = 0; k < tiles; k++) {
      const dropAt = at.get(k)!;
      last = Math.max(last, dropAt);
      b.add({ kind: 'timed', x: x0 + k * (tw + seam), top, w: tw, h: 24, dropAt, tile: true });
    }
  });
  lv.sections = [];
  lv.checkpoints = [{ x: 0, sx: x0 + (tiles * (tw + seam)) / 2 - 82, sy: tiers[0] - 60 }];
  b.x = x0 + tiles * (tw + seam) + 400;
  return b.done(last / 60 + 6, 1);
}

/**
 * Tail Tag (hunt): an arena with a few ledges and two holes. Some beans start with a tail. Grab a
 * tail holder to steal theirs; grab someone without one to pass yours on. Hold a tail at the end to score.
 */
export function buildTailTag(seed: number, difficulty: Difficulty, ramp = 0): Level {
  const b = new Builder('tailtag', 'hunt', 'Tail Tag', seed, difficulty, ramp);
  const lv = b.level;
  lv.tails = 2;
  const hole = b.gap(90);
  // the floor, in three parts with a hole between each
  const parts = [600, 640, 600];
  let x = 300;
  parts.forEach((w, i) => {
    b.ground(x, G, w);
    x += w + (i < 2 ? hole : 0);
  });
  const mid = 300 + parts[0] + hole + parts[1] / 2;
  // ledges to jump up to
  b.ground(300 + 120, 640 + Math.round(b.between(-15, 15)), 240, 30);
  b.ground(mid - 140, 490, 280, 30);
  b.ground(x - 360, 640 + Math.round(b.between(-15, 15)), 240, 30);
  if (difficulty !== 'easy') {
    lv.bars.push({ cx: mid, cy: G - 90, len: 110, speed: (b.rand() < 0.5 ? -1 : 1) * 1.3 * b.d.speed, phase: b.between(0, Math.PI * 2) });
  }
  lv.sections = [];
  // spawn in the middle, or on the first floor part when the bar is in the middle
  lv.checkpoints = [{ x: 0, sx: (difficulty === 'easy' ? mid : 300 + parts[0] / 2) - 82, sy: G - 60 }];
  b.x = x + 300;
  return b.done({ easy: 90, normal: 100, hard: 120 }[difficulty], 1);
}

export interface RoundInfoText {
  name: string;
  mode: RoundMode;
  goal: string; // one line on the round card
  help: string;
  hurt: string;
}

export const ROUND_TEXT: Record<RoundType, RoundInfoText> = {
  ledge: { name: 'Ledge Run', mode: 'race', goal: 'Race to the finish. The first 3 score 3, 2, 1 points.', help: 'Pull people up, hold the door, throw them across a gap', hurt: 'Shove them off a ledge' },
  twokey: { name: 'Two-Key Door', mode: 'race', goal: 'Doors open while someone stands on a plate. The first 3 through score 3, 2, 1.', help: 'Hold the plate for the others', hurt: 'Step off the plate halfway' },
  hotplate: { name: 'Hot Plate', mode: 'survival', goal: 'Tiles drop one by one. Fall off the bottom and you are out. Last ones standing score 3, 2, 1.', help: 'Throw someone onto a safe tile, pull them up', hurt: 'Drag them onto a shaking tile' },
  tailtag: { name: 'Tail Tag', mode: 'hunt', goal: 'Grab a tail holder to steal it. Hold a tail when time runs out: +3.', help: 'Grab someone without a tail to pass yours', hurt: 'Steal it, or shove the holder off' },
  bridge: { name: 'Trust Bridge', mode: 'final', goal: 'The final. Planks break under too many beans. First across wins the crown: +5.', help: 'Cross together, pull them up', hurt: 'Shove someone off to lighten the plank' },
};

/** Rounds 1 and 2 of every match are drawn from these; the final is always Trust Bridge. */
export const POOL: RoundType[] = ['ledge', 'hotplate', 'twokey', 'tailtag'];
export const FINAL: RoundType = 'bridge';

/** Build any round. Every round of a match has its own seed, from the match seed. */
export function buildRound(type: RoundType, seed: number, difficulty: Difficulty, ramp = 0): Level {
  switch (type) {
    case 'ledge': return buildLedgeRun(seed, difficulty, undefined, ramp);
    case 'twokey': return buildTwoKeyDoor(seed, difficulty, ramp);
    case 'hotplate': return buildHotPlate(seed, difficulty, ramp);
    case 'tailtag': return buildTailTag(seed, difficulty, ramp);
    case 'bridge': return buildTrustBridge(seed, difficulty, ramp);
  }
}

