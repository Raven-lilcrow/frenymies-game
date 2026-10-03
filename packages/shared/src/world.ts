// The moving parts of a course, at any tick.
//
// Timed obstacles (moving platform, hammers, rotating bars, fans, the gates' own timers, Hot Plate tiles)
// are worked out from the tick alone, so every browser computes them itself and nothing about them is
// ever sent. Obstacles that react to beans are run by the server and sent in each snapshot as a small
// WorldState: when each falling platform, fake tile or plank went, and where the seesaw and gates are heading.
// Your own browser also marks the platforms you step on, so your prediction stays exact.
import { HALF_H, TICK_RATE } from './constants.ts';
import type { Level, Rect } from './level.ts';
import type { PlayerState } from './sim.ts';

export const FALL_SHAKE = 30; // ticks a falling platform shakes before it drops
export const FALL_RESET = 210; // ticks after being stepped on until it is back
export const FALL_G = 1800; // how fast it drops (px/s²)
export const FAKE_SHAKE = 12; // ticks a fake tile wobbles before it gives way
export const FAKE_RESET = 240;
export const BAL_MAX = 70; // how far each seesaw half moves up or down
export const BAL_SPEED = 1; // px per tick, per bean of difference
export const BAL_RETURN = 0.5; // px per tick back to level when nobody (or the same number) stands on each half
export const GATE_OPEN = 4 / TICK_RATE; // fraction per tick
export const GATE_CLOSE = 1.5 / TICK_RATE;
export const TIMED_SHAKE = 60; // ticks a Hot Plate tile shakes before it drops (for good)
export const PLANK_SHAKE = 24; // ticks a Trust Bridge plank creaks before it breaks
export const PLANK_RESET = 300;

/** A value moving toward a target at a steady rate, as it was at tick `t`. */
export interface Glide {
  v: number;
  to: number;
  rate: number; // per tick
  t: number;
}

export interface WorldState {
  trig: number[]; // per solid: the tick a falling platform, fake tile or plank went, -1 if not
  bal: Glide; // seesaw: + means the left half is down
  gates: Glide[]; // per gate: 0 closed, 1 open
  lock: number; // nobody can move before this tick (round intro and countdown); the round starts here
  racing: boolean; // crossing the finish line counts
}

export function newWorld(level: Level): WorldState {
  return {
    trig: level.solids.map(() => -1),
    bal: { v: 0, to: 0, rate: 0, t: 0 },
    gates: level.gates.map(() => ({ v: 0, to: 0, rate: 0, t: 0 })),
    lock: 0,
    racing: false,
  };
}

export function cloneWorld(w: WorldState): WorldState {
  return { ...w, trig: [...w.trig], bal: { ...w.bal }, gates: w.gates.map((g) => ({ ...g })) };
}

/**
 * Point a glide at a new target. Kept as it is if nothing changed: the motion is the same either way, and an
 * unchanged world is not sent to the browsers again (see snapcodec.ts).
 */
function reaim(g: Glide, to: number, rate: number, t: number): Glide {
  if (g.to === to && g.rate === rate) return g;
  return { v: glideAt(g, t), to, rate, t };
}

export function glideAt(g: Glide, t: number): number {
  const d = Math.max(0, t - g.t) * g.rate;
  return g.v < g.to ? Math.min(g.to, g.v + d) : Math.max(g.to, g.v - d);
}

/** How many ticks ago this solid was stepped on, or -1 if it is not active at tick t. */
export function trigAge(w: WorldState, i: number, t: number, reset: number): number {
  const t0 = w.trig[i];
  if (t0 < 0 || t < t0 || t - t0 >= reset) return -1;
  return t - t0;
}

/** A solid at one tick. `on` = false while it is gone (fallen, crumbled). `shake` 0..1 is only for drawing. */
export interface Box extends Rect {
  on: boolean;
  shake: number;
}

export class Course {
  readonly level: Level;
  world: WorldState;
  private bufs: Box[][];

  constructor(level: Level, world: WorldState = newWorld(level)) {
    this.level = level;
    this.world = world;
    this.bufs = [0, 1, 2, 3].map(() => level.solids.map((s) => ({ x: s.x, top: s.top, w: s.w, h: s.h, on: true, shake: 0 })));
  }

  /**
   * Where every solid is at tick t (fractions are fine, for drawing). Up to 4 layouts can be held at once:
   * step() uses buf 0 and 1, the room 2, drawing 2 and 3. Each call reuses its buffer.
   */
  layout(t: number, buf = 0): Box[] {
    const out = this.bufs[buf];
    const sec = t / TICK_RATE;
    const w = this.world;
    const lv = this.level;
    for (let i = 0; i < lv.solids.length; i++) {
      const s = lv.solids[i];
      const b = out[i];
      b.x = s.x; b.top = s.top; b.on = true; b.shake = 0;
      switch (s.kind) {
        case 'mover': {
          const m = s.mover!;
          const range = m.maxX - m.minX;
          const u = (sec * m.speed) / (2 * range) + m.phase;
          b.x = m.minX + range * (0.5 - 0.5 * Math.cos(2 * Math.PI * u));
          break;
        }
        case 'falling': {
          const e = trigAge(w, i, t, FALL_RESET);
          if (e < 0) break;
          if (e < FALL_SHAKE) { b.shake = 1; break; }
          const f = (e - FALL_SHAKE) / TICK_RATE;
          b.top = s.top + 0.5 * FALL_G * f * f;
          if (b.top > 1400) b.on = false;
          break;
        }
        case 'fake': {
          const e = trigAge(w, i, t, FAKE_RESET);
          if (e < 0) break;
          if (e < FAKE_SHAKE) b.shake = 1;
          else b.on = false;
          break;
        }
        case 'balanceL':
          b.top = s.top + glideAt(w.bal, t);
          break;
        case 'balanceR':
          b.top = s.top - glideAt(w.bal, t);
          break;
        case 'gate':
          b.top = s.top - glideAt(w.gates[s.gate!], t) * s.h;
          break;
        case 'timed': {
          const e = t - w.lock - s.dropAt!; // ticks since it dropped
          if (e < -TIMED_SHAKE) break;
          if (e < 0) { b.shake = 1 + e / TIMED_SHAKE; break; } // shakes harder and harder
          const f = e / TICK_RATE;
          b.top = s.top + 0.5 * FALL_G * f * f;
          if (b.top > 1400) b.on = false;
          break;
        }
        case 'plank': {
          const e = trigAge(w, i, t, PLANK_RESET);
          if (e < 0) break;
          if (e < PLANK_SHAKE) b.shake = 1;
          else b.on = false;
          break;
        }
      }
    }
    return out;
  }

  /** The hammer's head and swing at tick t. `swing` > 0: the head is moving right. */
  hammer(i: number, t: number) {
    const h = this.level.hammers[i];
    const ph = h.speed * (t / TICK_RATE) + h.phase;
    const a = h.amp * Math.sin(ph);
    return { a, x: h.px + Math.sin(a) * h.len, y: h.py + Math.cos(a) * h.len, swing: Math.cos(ph) };
  }

  /** The rotating bar's angle at tick t. */
  barAngle(i: number, t: number): number {
    const b = this.level.bars[i];
    return b.phase + b.speed * (t / TICK_RATE);
  }

  fanOn(i: number, t: number): boolean {
    const f = this.level.fans[i];
    const cycle = f.onSec + f.offSec;
    const u = (((t / TICK_RATE + f.phase) % cycle) + cycle) % cycle;
    return u < f.onSec;
  }

  /** A gate also opens by itself now and then, so nobody is ever stuck behind it alone. */
  gateAuto(i: number, t: number): boolean {
    const g = this.level.gates[i];
    const u = (t / TICK_RATE + g.phase) % g.autoEverySec;
    return u < g.autoOpenSec;
  }
}

/** True if a bean stands on this pressure plate. */
export function onButton(p: PlayerState, b: { x0: number; x1: number; top: number }): boolean {
  return !p.dead && p.grounded && Math.abs(p.y + HALF_H - b.top) < 1 && p.x > b.x0 && p.x < b.x1;
}

/**
 * Server only, once per tick after the beans moved: steer the parts that react to beans (seesaw, gates,
 * planks) and forget platforms that are back. Returns, per gate, which beans hold a button down.
 */
export function updateWorld(c: Course, beans: PlayerState[], t: number): PlayerState[][] {
  const w = c.world;
  const lv = c.level;
  for (let i = 0; i < w.trig.length; i++) {
    if (w.trig[i] >= 0 && t - w.trig[i] >= Math.max(FALL_RESET, FAKE_RESET, PLANK_RESET)) w.trig[i] = -1;
  }
  // planks break under too many beans
  if (lv.plankLimit < 99) {
    const load = new Map<number, number>();
    for (const p of beans) {
      if (!p.dead && p.grounded && p.plat >= 0 && lv.solids[p.plat].kind === 'plank') load.set(p.plat, (load.get(p.plat) ?? 0) + 1);
    }
    for (const [i, n] of load) if (n >= lv.plankLimit && trigAge(w, i, t, PLANK_RESET) < 0) w.trig[i] = t;
  }
  if (lv.balance) {
    const { left, right } = lv.balance;
    let l = 0, r = 0;
    for (const p of beans) {
      if (p.dead || !p.grounded) continue;
      if (p.plat === left) l++;
      else if (p.plat === right) r++;
    }
    const to = l === r ? 0 : l > r ? BAL_MAX : -BAL_MAX;
    const rate = l === r ? BAL_RETURN : BAL_SPEED * Math.abs(l - r);
    w.bal = reaim(w.bal, to, rate, t);
  }
  return lv.gates.map((g, i) => {
    const holders = beans.filter((p) => g.buttons.some((b) => onButton(p, b)));
    const open = holders.length > 0 || c.gateAuto(i, t);
    w.gates[i] = reaim(w.gates[i], open ? 1 : 0, open ? GATE_OPEN : GATE_CLOSE, t);
    return holders;
  });
}
