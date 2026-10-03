// Ledge Run: the course builder, every obstacle, and that prediction stays exact with moving parts.
import { describe, expect, it } from 'vitest';
import { HALF_H, HAMMER_VX, TICK_RATE } from './constants.ts';
import { buildLedgeRun } from './courses.ts';
import { DIFFICULTIES, DIFFICULTY, SECTIONS, type Level, type SolidKind } from './level.ts';
import { BTN, INTENT, newPlayer, step, type PlayerState } from './sim.ts';
import { BAL_MAX, Course, FAKE_SHAKE, FALL_RESET, FALL_SHAKE, cloneWorld, updateWorld, type WorldState } from './world.ts';

const find = (lv: Level, kind: SolidKind, nth = 0) => lv.solids.map((s, i) => [s, i] as const).filter(([s]) => s.kind === kind)[nth][1];

/** A bean standing still in the middle of solid i, as it is at tick t. */
function standOn(c: Course, i: number, t: number, dx = 0): PlayerState {
  const r = c.layout(t)[i];
  const p = newPlayer(c.level, 0);
  Object.assign(p, { x: r.x + r.w / 2 + dx, y: r.top - HALF_H, vx: 0, vy: 0, grounded: true, plat: i, protect: 0 });
  return p;
}

function run(p: PlayerState, c: Course, from: number, n: number, buttons = 0): number {
  let intents = 0;
  for (let t = from; t < from + n; t++) intents |= step(p, buttons, 0, c, t);
  return intents;
}

describe('building Ledge Run', () => {
  it('the same seed and difficulty always build the same course, another seed changes it', () => {
    expect(buildLedgeRun(7, 'hard')).toEqual(buildLedgeRun(7, 'hard'));
    expect(JSON.stringify(buildLedgeRun(8, 'hard'))).not.toBe(JSON.stringify(buildLedgeRun(7, 'hard')));
  });

  it('each match draws its own sections in its own order, more on harder difficulties', () => {
    for (const d of DIFFICULTIES) {
      const lv = buildLedgeRun(11, d);
      expect(lv.sections.length).toBe(DIFFICULTY[d].sections);
      // all 10 get used before any repeats; never the same one twice in a row; the seesaw only once
      expect(new Set(lv.sections).size).toBe(Math.min(10, lv.sections.length));
      expect(lv.sections.every((s, i) => s !== lv.sections[i - 1])).toBe(true);
      expect(lv.sections.filter((s) => s === 'seesaw').length).toBeLessThanOrEqual(1);
    }
    const orders = new Set([1, 2, 3, 4, 5, 6].map((seed) => buildLedgeRun(seed, 'normal').sections.join()));
    expect(orders.size).toBeGreaterThan(4);
    // and the course really follows the draw: no gate unless the gate was drawn
    for (let seed = 1; seed < 20; seed++) {
      const lv = buildLedgeRun(seed, 'normal');
      expect(lv.gates.length > 0).toBe(lv.sections.includes('gate'));
      expect(lv.hammers.length > 0).toBe(lv.sections.includes('hammer'));
    }
  });

  it('difficulty changes the timer per section, hammers, fake tiles and checkpoints', () => {
    const easy = buildLedgeRun(1, 'easy', SECTIONS), hard = buildLedgeRun(1, 'hard', SECTIONS);
    expect(easy.timerTicks).toBeGreaterThan(hard.timerTicks);
    expect(hard.hammers.length).toBe(2);
    expect(hard.solids.filter((s) => s.kind === 'fake').length).toBe(2);
    for (const d of DIFFICULTIES) expect(buildLedgeRun(3, d).checkpoints.length).toBe(DIFFICULTY[d].checkpoints);
  });

  it('every gap can be jumped, on every difficulty', () => {
    // how far a running double jump carries you, measured with the real movement code
    const flat = new Course({ ...buildLedgeRun(1, 'easy'), solids: [{ kind: 'static', x: 0, top: 800, w: 400, h: 300, ledge: false }], hammers: [], bars: [], fans: [], pads: [], width: 9000 });
    const p = standOn(flat, 0, 0, -180);
    run(p, flat, 0, 30, BTN.right);
    const x0 = p.x;
    let t = 30;
    for (let i = 0; i < 200 && p.y < 820; i++, t++) step(p, i === 22 ? BTN.right : BTN.right | BTN.jump, 0, flat, t);
    const reach = p.x - x0;
    expect(reach).toBeGreaterThan(300);

    for (const d of DIFFICULTIES) {
      for (const seed of [1, 2, 3, 99, 12345]) {
        const lv = buildLedgeRun(seed, d, SECTIONS);
        const ground = lv.solids.filter((s) => s.kind !== 'mover' && s.kind !== 'gate').sort((a, b) => a.x - b.x);
        const movers = lv.solids.filter((s) => s.kind === 'mover');
        for (let i = 1; i < ground.length; i++) {
          const a = ground[i - 1], b = ground[i];
          const gapFrom = a.x + a.w, gapTo = b.x;
          if (movers.some((m) => m.x >= gapFrom && m.x < gapTo)) continue; // the moving platform carries you over
          expect(gapTo - gapFrom, `${d} seed ${seed} gap at x ${gapFrom}`).toBeLessThan(reach * 0.8);
        }
      }
    }
  });
});

describe('obstacles', () => {
  const lv = buildLedgeRun(42, 'normal', SECTIONS); // every obstacle

  it('the moving platform carries a bean standing on it', () => {
    const c = new Course(lv);
    const i = find(lv, 'mover');
    const p = standOn(c, i, 100);
    const dx = c.layout(130)[i].x - c.layout(100)[i].x;
    expect(Math.abs(dx)).toBeGreaterThan(20);
    const offset = p.x - c.layout(100)[i].x;
    run(p, c, 100, 30);
    expect(p.grounded).toBe(true);
    expect(p.plat).toBe(i);
    expect(p.x - c.layout(130)[i].x).toBeCloseTo(offset, 5);
  });

  it('a falling platform shakes, drops, then comes back', () => {
    const c = new Course(lv);
    const i = find(lv, 'falling');
    const top = lv.solids[i].top;
    const p = standOn(c, i, 0);
    run(p, c, 0, 2);
    expect(c.world.trig[i]).toBe(0);
    run(p, c, 2, FALL_SHAKE - 4);
    expect(p.grounded).toBe(true);
    expect(c.layout(FALL_SHAKE + 30)[i].top).toBeGreaterThan(top + 100);
    run(p, c, FALL_SHAKE - 2, 60);
    expect(p.y).toBeGreaterThan(top + 100);
    expect(c.layout(FALL_RESET + 1)[i].top).toBe(top);
  });

  it('a fake tile gives way, a real one holds', () => {
    const c = new Course(lv);
    const fake = standOn(c, find(lv, 'fake'), 0);
    run(fake, c, 0, FAKE_SHAKE + 3);
    expect(fake.grounded).toBe(false);
    const bridge = lv.solids.findIndex((s) => s.kind === 'static' && s.tile);
    const real = standOn(c, bridge, 0);
    run(real, c, 0, 60);
    expect(real.grounded).toBe(true);
  });

  it('the conveyor belt pushes you back', () => {
    const c = new Course(lv);
    const i = find(lv, 'belt');
    const p = standOn(c, i, 0);
    const x = p.x;
    run(p, c, 0, 30);
    expect(x - p.x).toBeCloseTo((-lv.solids[i].belt! * 30) / TICK_RATE, 0);
  });

  it('the hammer knocks you away', () => {
    const c = new Course(lv);
    const px = lv.hammers[0].px;
    const p = standOn(c, lv.solids.findIndex((s) => s.kind === 'static' && s.x < px && s.x + s.w > px), 0); // the hammer platform
    // find a tick when the head sweeps through where the bean stands
    let t = 0;
    while (t < 600 && Math.abs(c.hammer(0, t).x - p.x) > 10) t++;
    const intent = step(p, 0, 0, c, t);
    expect(intent & INTENT.hit).toBeTruthy();
    expect(Math.abs(p.vx)).toBe(HAMMER_VX);
    expect(p.stun).toBeGreaterThan(0);
  });

  it('the fan only blows while it is on', () => {
    const c = new Course(lv);
    const f = lv.fans[0];
    const inAir = () => Object.assign(newPlayer(lv, 0), { x: f.x + f.w / 2, y: f.top + 100, vx: 0, vy: 0, protect: 0 });
    let on = 0;
    while (!c.fanOn(0, on)) on++;
    let off = on;
    while (c.fanOn(0, off)) off++;
    const a = inAir(), b = inAir();
    step(a, 0, 0, c, on);
    step(b, 0, 0, c, off);
    expect(a.vx).toBeLessThan(-10);
    expect(b.vx).toBe(0);
  });

  it('the gate opens while someone stands on a button', () => {
    const c = new Course(lv);
    const g = lv.gates[0];
    const gi = g.solid;
    let t = 0;
    while (Array.from({ length: 61 }, (_, k) => c.gateAuto(0, t + k)).some(Boolean)) t++; // a moment when it stays shut by itself
    const p = newPlayer(lv, 0);
    const b = g.buttons[0];
    Object.assign(p, { x: (b.x0 + b.x1) / 2, y: b.top - HALF_H, grounded: true, plat: lv.solids.findIndex((s) => s.x <= b.x0 && s.x + s.w >= b.x1 && s.top === b.top) });
    const shut = c.layout(t)[gi].top;
    for (let k = 0; k < 30; k++) updateWorld(c, [p], t + k);
    expect(c.layout(t + 30)[gi].top).toBeLessThan(shut - 100);
    p.x = b.x1 + 50; // step off
    for (let k = 30; k < 60; k++) updateWorld(c, [p], t + k);
    expect(c.layout(t + 60)[gi].top).toBeGreaterThan(c.layout(t + 30)[gi].top);
  });

  it('the seesaw tips toward the side with more beans', () => {
    const c = new Course(lv);
    const { left, right } = lv.balance!;
    const p = standOn(c, left, 0);
    for (let t = 0; t < 200; t++) { step(p, 0, 0, c, t); updateWorld(c, [p], t); }
    expect(c.layout(200)[left].top).toBe(lv.solids[left].top + BAL_MAX);
    expect(c.layout(200)[right].top).toBe(lv.solids[right].top - BAL_MAX);
    expect(p.grounded).toBe(true); // rode it down
    expect(p.y + HALF_H).toBe(lv.solids[left].top + BAL_MAX);
  });
});

describe('round rules in the movement code', () => {
  const lv = buildLedgeRun(5, 'easy', SECTIONS);

  it('nobody moves before the start', () => {
    const c = new Course(lv);
    c.world.lock = 100;
    const p = standOn(c, 0, 0);
    const x = p.x;
    run(p, c, 0, 99, BTN.right);
    expect(p.x).toBe(x);
    run(p, c, 99, 2, 0);
    run(p, c, 101, 10, BTN.right);
    expect(p.x).toBeGreaterThan(x);
  });

  it('crossing the finish line during a race finishes you, then your buttons stop working', () => {
    const c = new Course(lv);
    c.world.racing = true;
    const last = lv.solids.length - 1;
    const p = standOn(c, last, 0);
    p.x = lv.finishX - 30;
    expect(run(p, c, 0, 20, BTN.right) & INTENT.finished).toBeTruthy();
    expect(p.finished).toBe(true);
    const x = p.x;
    run(p, c, 20, 60, BTN.left);
    expect(p.x).toBeGreaterThanOrEqual(x - 1);
  });

  it('the catch-up boost makes you run faster', () => {
    const c = new Course(lv);
    const a = standOn(c, 0, 0, -200), b = standOn(c, 0, 0, -200);
    b.boost = true;
    run(a, c, 0, 60, BTN.right);
    run(b, c, 0, 60, BTN.right);
    expect(b.x - a.x).toBeGreaterThan(30);
  });
});

describe('prediction with moving parts', () => {
  it('a copy of the world, sent like a snapshot, gives exactly the same run', () => {
    const lv = buildLedgeRun(77, 'hard', SECTIONS);
    const server = new Course(lv);
    let client = new Course(lv);
    const script = (i: number) => [BTN.right, BTN.right | BTN.jump, BTN.right, BTN.right | BTN.jump, BTN.dive | BTN.right, 0][(i * 5 + (i >> 4)) % 6];
    const a = newPlayer(lv, 1);
    let b = newPlayer(lv, 1);
    for (let t = 0; t < 1500; t++) {
      step(a, script(t), 1, server, t);
      step(b, script(t), 1, client, t);
      updateWorld(server, [a], t);
      updateWorld(client, [b], t);
      if (t % 37 === 0) {
        b = JSON.parse(JSON.stringify(b)) as PlayerState;
        client = new Course(lv, JSON.parse(JSON.stringify(cloneWorld(client.world))) as WorldState);
      }
    }
    expect(b).toEqual(a);
    expect(a.x).toBeGreaterThan(800); // it actually went somewhere
  });
});
