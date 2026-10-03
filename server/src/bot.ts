// Bot brains: what a bot presses each tick. The same brain runs inside the game server (the host adds
// bots with the ` key in the lobby, see Room.addBot) and in tools/bots.ts (test bots that connect like a
// browser). Races (Ledge Run, Two-Key Door, Trust Bridge) are the autopilot (tools/autopilot.ts); Hot
// Plate and Tail Tag have their own simple rules below.
// Each has a personality on top: Ava mostly helps (pulls people up, holds doors), Bo mostly hurts
// (shoves, grabs and throws), Cy and Dee do a bit of both.
import {
  BTN, Course, GRAB_RANGE, HALF_H, PUSH_RANGE, onButton, type Difficulty, type PlayerState, type RoundInfo,
} from '../../packages/shared/src/index.ts';
import { Autopilot } from '../../tools/autopilot.ts';

/** hesitate and blunder: how human they race (see Sloppiness in autopilot.ts) */
export interface Personality {
  name: string;
  help: number;
  push: number;
  grab: number;
  hesitate: number;
  blunder: number;
}

export const PERSONALITIES: Personality[] = [
  { name: 'Ava', help: 0.9, push: 0.1, grab: 0.1, hesitate: 0.3, blunder: 0.02 },
  { name: 'Bo', help: 0.15, push: 0.85, grab: 0.35, hesitate: 0.2, blunder: 0.03 },
  { name: 'Cy', help: 0.5, push: 0.5, grab: 0.3, hesitate: 0.35, blunder: 0.04 },
  { name: 'Dee', help: 0.5, push: 0.4, grab: 0.25, hesitate: 0.25, blunder: 0.03 },
];

/** A bot's name in the room. The "(bot)" ending is how everyone tells them apart from real players. */
export const botName = (p: Personality) => `${p.name} (bot)`;

// bot skill follows the difficulty (3.4): sloppier on Easy, sharper on Hard
const SLOPPY: Record<Difficulty, number> = { easy: 1.6, normal: 1, hard: 0.6 };

/** Another bean, as a bot sees it. */
export interface Bean extends PlayerState {
  id: number;
}

/** What a bot looks at to decide one tick. */
export interface BotView {
  me: PlayerState; // its own bean, before this tick
  others: Bean[];
  course: Course;
  tick: number; // the tick these buttons are for
  round: RoundInfo;
}

// The layout buffer the brain uses: 0 and 1 are step()'s, 2 the room's (see Course.layout).
const BUF = 3;

export class BotBrain {
  readonly cfg: Personality;
  private readonly slot: number;
  private readonly random: () => number;
  private course: Course | null = null;
  private pilot: Autopilot | null = null;
  private v!: BotView;
  private lastB = 0;
  private grabHold = 0; // ticks left to keep holding grab (then let go = throw)
  private holdDoor = 0; // ticks left standing on a door plate for someone behind
  private doorBtn: unknown = null; // which plate
  private readonly decided = new Map<number, boolean>(); // per hanging bean: will I help them?
  private chase: { id: number; until: number } | null = null; // go after someone to shove or grab them
  private pref: number[] = []; // Hot Plate: each bot leans to its own favourite tiles

  constructor(cfg: Personality, slot: number, random: () => number = Math.random) {
    this.cfg = cfg;
    this.slot = slot;
    this.random = random;
  }

  /** Buttons for tick `v.tick`. */
  think(v: BotView): number {
    this.v = v;
    if (v.course !== this.course) {
      // a new round (or back to the lobby): a new course to learn
      this.course = v.course;
      const k = SLOPPY[v.round.diff];
      this.pilot = new Autopilot(v.course.level, this.slot, { hesitate: this.cfg.hesitate * k, blunder: this.cfg.blunder * k, random: this.random });
      this.pref = [];
      this.holdDoor = 0;
    }
    const b = this.decide();
    this.lastB = b;
    return b;
  }

  private decide(): number {
    const { me, round, course } = this.v;
    if (me.dead || me.heldBy || me.finished) return 0;
    if (me.holding && this.grabHold <= 0) return BTN.right; // let go: throw
    const mode = course.level.mode;
    if (mode === 'hunt') return round.phase === 'play' ? this.tag() : 0;
    if (mode === 'survival') return this.social() ?? this.plate();
    return this.social() ?? this.pilot!.next(me, course.world, this.v.tick);
  }

  /** Press a button only if it was not already held last tick (so it counts as a fresh press). */
  private press(b: number, bit: number): number {
    return this.lastB & bit ? b : b | bit;
  }

  /** Helping and hurting. Returns buttons, or null to just race. */
  private social(): number | null {
    const { me, others, round, course, tick } = this.v;
    const cfg = this.cfg;
    // someone hanging nearby: decide once whether to help, then go pull them up
    const hanger = others.find((o) => o.hanging && Math.abs(o.x - me.x) < 160 && Math.abs(o.y - me.y) < 90);
    if (hanger && !this.decided.has(hanger.id)) this.decided.set(hanger.id, this.random() < cfg.help);
    for (const k of this.decided.keys()) if (!others.some((o) => o.id === k && o.hanging)) this.decided.delete(k);
    if (hanger && this.decided.get(hanger.id) && !me.holding && me.grounded) {
      const toward = Math.sign(hanger.x - me.x) || 1;
      const dx = (hanger.x - me.x) * toward;
      if (dx > GRAB_RANGE - 10) return toward > 0 ? BTN.right : BTN.left;
      return this.press(toward > 0 ? BTN.right : BTN.left, BTN.grab);
    }

    // grabbed someone: keep holding grab for a while (from the press on), then let go to throw
    if (this.grabHold > 0) {
      this.grabHold--;
      return BTN.right | BTN.grab;
    }

    // doors: a helpful bot holds the plate for someone behind it
    if (round.phase === 'play') {
      for (const btn of course.level.gates.flatMap((g) => g.buttons)) {
        if (this.holdDoor > 0 && this.doorBtn === btn) {
          this.holdDoor--;
          return onButton(me, btn) ? 0 : me.x < (btn.x0 + btn.x1) / 2 ? BTN.right : BTN.left;
        }
        const behind = others.some((o) => !o.finished && !o.dead && o.x < btn.x0 && o.x > btn.x0 - 600);
        if (onButton(me, btn) && behind && this.random() < cfg.help * 0.05) { this.holdDoor = 180; this.doorBtn = btn; return 0; }
      }
    }

    // now and then, go after a bean nearby (more often for the meaner bots)
    const chase = this.chase;
    if (chase && (tick > chase.until || !others.some((o) => o.id === chase.id && !o.dead && !o.heldBy && !o.finished))) this.chase = null;
    if (!this.chase && this.random() < (cfg.push + cfg.grab) * 0.01) {
      const near = others.filter((o) => !o.dead && !o.heldBy && !o.finished && o.protect <= 0 && Math.abs(o.x - me.x) < 300 && Math.abs(o.y - me.y) < 50);
      if (near.length) this.chase = { id: near[Math.floor(this.random() * near.length)].id, until: tick + 120 };
    }
    const target = this.chase ? others.find((o) => o.id === this.chase!.id) : undefined;
    if (!target || !me.grounded) return null;
    const runDir = Math.sign(target.x - me.x) || 1;
    const b0 = runDir > 0 ? BTN.right : BTN.left;
    const dx = (target.x - me.x) * runDir;
    if (dx < PUSH_RANGE - 15 && Math.abs(target.y - me.y) < 60 && me.facing === runDir) {
      this.chase = null;
      if (this.random() < cfg.push / (cfg.push + cfg.grab) && me.pushCd <= 0) return this.press(b0, BTN.push);
      if (me.grabCd <= 0) { this.grabHold = 20 + Math.floor(this.random() * 50); return this.press(b0, BTN.grab); }
      return null;
    }
    return b0;
  }

  /** What is under the feet, a step ahead: ground, a hole worth jumping, or the end of the world. */
  private ahead(me: PlayerState, dir: number): 'ground' | 'hole' | 'end' {
    const boxes = this.v.course.layout(this.v.tick, BUF);
    const feet = me.y + HALF_H;
    const under = (x: number, below: number) => boxes.some((b) => b.on && x >= b.x && x <= b.x + b.w && b.top >= feet - 150 && b.top <= feet + below);
    if (under(me.x + dir * 45, 60)) return 'ground';
    for (let d = 90; d <= 330; d += 30) if (under(me.x + dir * d, 160)) return 'hole';
    return 'end';
  }

  /** Mash jump to climb back up. */
  private climb(): number {
    return this.v.tick % 2 ? BTN.jump : 0;
  }

  /** Hot Plate: stand on the tile of your layer that drops last (each bot leans to its own favourites). */
  private plate(): number {
    const { me, course, tick } = this.v;
    if (me.hanging) return this.climb();
    if (!me.grounded) return 0;
    const boxes = course.layout(tick, BUF);
    const feet = me.y + HALF_H;
    let best = -1;
    let score = -Infinity;
    course.level.solids.forEach((s, i) => {
      const b = boxes[i];
      if (!b.on || b.shake > 0 || Math.abs(b.top - feet) > 30) return;
      const v = (s.dropAt ?? 0) - Math.abs(b.x + b.w / 2 - me.x) * 0.5 + (this.pref[i] ??= this.random() * 120);
      if (v > score) { score = v; best = i; }
    });
    if (best < 0) return 0;
    const mid = boxes[best].x + boxes[best].w / 2;
    if (Math.abs(mid - me.x) < 18) return 0;
    return mid > me.x ? BTN.right : BTN.left;
  }

  /** Tail Tag: with a tail, keep away from whoever is hunting it; without one, go and grab one. */
  private tag(): number {
    const { me, others } = this.v;
    if (me.hanging) return this.climb();
    const live = others.filter((o) => !o.dead && !o.heldBy);
    const nearest = (list: Bean[]) => list.sort((a, b) => Math.hypot(a.x - me.x, a.y - me.y) - Math.hypot(b.x - me.x, b.y - me.y))[0];
    let dir: number;
    let target: Bean | undefined;
    if (me.tail) {
      const hunter = nearest(live.filter((o) => !o.tail));
      if (!hunter || Math.hypot(hunter.x - me.x, hunter.y - me.y) > 420) return 0;
      dir = hunter.x > me.x ? -1 : 1;
    } else {
      target = nearest(live.filter((o) => o.tail));
      if (!target) return 0;
      dir = Math.sign(target.x - me.x) || 1;
      if (Math.abs(target.x - me.x) < GRAB_RANGE - 10 && Math.abs(target.y - me.y) < 60 && me.grabCd <= 0) {
        return me.facing === dir ? this.press(0, BTN.grab) : dir > 0 ? BTN.right : BTN.left;
      }
    }
    const road = me.grounded ? this.ahead(me, dir) : 'ground';
    if (road === 'end') return 0; // cornered: nowhere to go but the pit
    let b = dir > 0 ? BTN.right : BTN.left;
    const above = target && target.y < me.y - 80 && Math.abs(target.x - me.x) < 220;
    if (me.grounded && (road === 'hole' || above || this.random() < 0.004)) b |= BTN.jump;
    else if (!me.grounded && me.vy < 0) b |= BTN.jump; // hold it for the full height
    return b;
  }
}
