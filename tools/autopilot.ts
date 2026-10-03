// A simple racing brain: every few ticks, try a dozen short moves (run to the edge, jump, double jump,
// wait...) with the real movement code on a scratch copy of the course, and keep the one that gets
// furthest without dying. The course is deterministic, so this sees the moving platform, hammers and
// fans coming. Each move reacts as it plays out (runs until the edge, stops once it has landed), so a
// move is one sensible action, not a fixed button pattern.
// Used by the bots, and by a test that checks every difficulty can be finished.
import {
  BTN, Course, clonePlayer, cloneWorld, step, type Level, type PlayerState, type WorldState,
} from '../packages/shared/src/index.ts';

const R = BTN.right, L = BTN.left, J = BTN.jump, D = BTN.dive;
const PLAN_TICKS = 80; // how far ahead each move is tried
const REPLAN_EVERY = 6;

type Start = 'now' | 'edge' | 'run' | 'wait' | 'delay' | 'back' | 'mash';
type Style = 'full' | 'double' | 'hop' | 'dive' | 'press';
interface Spec {
  start: Start;
  style: Style;
}

const MOVES: Spec[] = [
  { start: 'edge', style: 'double' }, // run up to the edge, jump, double jump
  { start: 'edge', style: 'full' },
  { start: 'edge', style: 'dive' },
  { start: 'run', style: 'full' }, // run, stop at the edge
  { start: 'now', style: 'full' },
  { start: 'now', style: 'double' },
  { start: 'now', style: 'hop' },
  { start: 'now', style: 'press' }, // let go and press again: a double jump right now, in the air
  { start: 'delay', style: 'double' }, // wait a moment, then jump
  { start: 'wait', style: 'full' },
  { start: 'back', style: 'full' },
  { start: 'mash', style: 'full' }, // climb a ledge
];

const WAIT: Spec = { start: 'wait', style: 'full' };

function jumpButtons(k: number, style: Style): number {
  switch (style) {
    case 'full': return J;
    case 'double': return k < 14 ? J : k < 18 ? 0 : J;
    case 'hop': return k < 5 ? J : 0;
    case 'dive': return k < 12 ? J : k === 12 ? D : 0;
    case 'press': return k < 1 ? 0 : J;
  }
}

/** Plays one move, tick by tick, reacting to where the bean is. */
class MoveRunner {
  private i = 0;
  private jumpAt = -1;
  private landed = false;
  private readonly spec: Spec;
  constructor(spec: Spec) {
    this.spec = spec;
  }

  /**
   * `edge`: how far the right edge of whatever you stand on is (Infinity in the air).
   * `backBelt`: standing on a belt that carries you back (standing still there means sliding off).
   */
  buttons(s: PlayerState, edge: number, backBelt = false): number {
    const { start, style } = this.spec;
    const i = this.i++;
    if (this.jumpAt >= 0 && !this.landed && i > this.jumpAt + 3 && s.grounded) this.landed = true;
    if (this.landed) return backBelt ? R : 0;
    if (this.jumpAt >= 0) return R | jumpButtons(i - this.jumpAt, style);
    if (s.hanging) return start === 'mash' && i % 2 ? J : 0;
    switch (start) {
      case 'now': this.jumpAt = i; return R | jumpButtons(0, style);
      case 'edge':
        if ((s.grounded && edge < 28) || i >= 50) { this.jumpAt = i; return R | jumpButtons(0, style); }
        return R;
      case 'run': return s.grounded && edge < 22 ? 0 : R;
      case 'delay':
        if (i >= 10) { this.jumpAt = i; return R | jumpButtons(0, style); }
        return 0;
      case 'back': return i < 14 ? L : 0;
      case 'mash': return 0;
      case 'wait': return 0;
    }
  }
}

/** How human the autopilot plays. 0 and 0 = perfect (the tests use that). */
export interface Sloppiness {
  hesitate: number; // chance per decision to just stand there for a moment
  blunder: number; // chance per decision to do something random (which can mean falling)
  random: () => number;
}

export class Autopilot {
  private runner = new MoveRunner(MOVES[0]);
  private planAt = -Infinity;
  private readonly scratch: Course;
  private readonly sloppy: Sloppiness;
  readonly slot: number;

  constructor(level: Level, slot: number, sloppy: Partial<Sloppiness> = {}) {
    this.scratch = new Course(level);
    this.slot = slot;
    this.sloppy = { hesitate: 0, blunder: 0, random: Math.random, ...sloppy };
  }

  /** Buttons for tick t. `p` and `world` are as they are before that tick. */
  next(p: PlayerState, world: WorldState, t: number): number {
    if (t - this.planAt >= REPLAN_EVERY || t < this.planAt) {
      const { hesitate, blunder, random } = this.sloppy;
      const roll = hesitate || blunder ? random() : 1;
      const spec = roll < hesitate ? WAIT : roll < hesitate + blunder ? MOVES[Math.floor(random() * MOVES.length)] : this.replan(p, world, t);
      this.runner = new MoveRunner(spec);
      this.planAt = t;
    }
    this.scratch.world = world;
    return this.runner.buttons(p, this.edge(p, t), this.backBelt(p));
  }

  private backBelt(s: PlayerState): boolean {
    return s.grounded && s.plat >= 0 && (this.scratch.level.solids[s.plat].belt ?? 0) < 0;
  }

  private edge(s: PlayerState, t: number): number {
    if (!s.grounded || s.plat < 0) return Infinity;
    const r = this.scratch.layout(t, 2)[s.plat];
    return r.x + r.w - s.x;
  }

  private replan(p: PlayerState, world: WorldState, t: number): Spec {
    let best = -Infinity;
    let bestSpec = MOVES[0];
    for (const spec of MOVES) {
      const s = clonePlayer(p);
      this.scratch.world = cloneWorld(world);
      const run = new MoveRunner(spec);
      let i = 0;
      for (; i < PLAN_TICKS && !s.dead && !s.finished; i++) {
        step(s, run.buttons(s, this.edge(s, t + i), this.backBelt(s)), this.slot, this.scratch, t + i);
      }
      // still in the air: let it come down first, or a doomed jump looks like progress
      for (let k = 0; k < 90 && !s.grounded && !s.hanging && !s.dead && !s.finished; k++, i++) {
        step(s, 0, this.slot, this.scratch, t + i);
      }
      const score = s.dead ? -1e9 + s.x : s.x + (s.finished ? 1e6 : 0) - (s.hanging ? 200 : 0) + (s.grounded ? 30 : 0);
      if (score > best + 0.5) { best = score; bestSpec = spec; }
    }
    return bestSpec;
  }
}
