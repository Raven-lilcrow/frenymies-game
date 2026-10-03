// The 4 new round courses: they build, the parts that make each one work behave.
import { describe, expect, it } from 'vitest';
import { HALF_H } from './constants.ts';
import { POOL, ROUND_TEXT, buildRound, buildTrustBridge } from './courses.ts';
import { DIFFICULTIES, type RoundType } from './level.ts';
import { BTN, newPlayer, step, type PlayerState } from './sim.ts';
import { Course, updateWorld } from './world.ts';

const ALL: RoundType[] = [...POOL, 'bridge'];

describe('every round', () => {
  it('builds the same course from the same numbers, on every difficulty', () => {
    for (const type of ALL) {
      for (const d of DIFFICULTIES) {
        expect(buildRound(type, 9, d, 1)).toEqual(buildRound(type, 9, d, 1));
        const lv = buildRound(type, 9, d);
        expect(lv.type).toBe(type);
        expect(lv.mode).toBe(ROUND_TEXT[type].mode);
        expect(lv.timerTicks).toBeGreaterThan(30 * 60);
        // the spawn point is above something to stand on
        const sp = lv.checkpoints[0];
        expect(lv.solids.some((s) => sp.sx >= s.x && sp.sx + 165 <= s.x + s.w + 120 && s.top > sp.sy)).toBe(true);
      }
    }
  });

  it('later rounds of a match are a notch harder', () => {
    const a = buildRound('twokey', 4, 'normal', 0), b = buildRound('twokey', 4, 'normal', 2);
    const speed = (lv: typeof a) => lv.hammers.map((h) => h.speed).concat(lv.bars.map((x) => Math.abs(x.speed)), lv.solids.filter((s) => s.belt).map((s) => -s.belt!), lv.fans.map((f) => -f.push));
    // same seed, same pieces, faster
    expect(speed(b).every((v, i) => v > speed(a)[i])).toBe(true);
  });

  it('races have a finish line, the arenas do not', () => {
    for (const type of ALL) {
      const lv = buildRound(type, 3, 'normal');
      expect(lv.finishX > 0).toBe(lv.mode === 'race' || lv.mode === 'final');
    }
  });
});

describe('Hot Plate', () => {
  it('tiles shake, then drop for good, the top layer before the bottom one is gone', () => {
    const lv = buildRound('hotplate', 2, 'normal');
    const c = new Course(lv);
    c.world.lock = 100;
    const on = (t: number) => c.layout(t).filter((b) => b.on && b.top < 1000).length;
    expect(on(100)).toBe(lv.solids.length); // every tile is there at the start (2 layers of 14)
    expect(lv.solids.length).toBe(28);
    expect(c.layout(100).every((b) => b.shake === 0)).toBe(true);
    const tiles = lv.solids.map((s) => s.dropAt!);
    const firstDrop = Math.min(...tiles);
    expect(c.layout(100 + firstDrop - 10).some((b) => b.shake > 0)).toBe(true);
    expect(on(100 + lv.timerTicks)).toBe(0); // all gone by the end
    const top = lv.solids.filter((s) => s.top < 700).map((s) => s.dropAt!);
    const bottom = lv.solids.filter((s) => s.top > 700).map((s) => s.dropAt!);
    expect(Math.max(...top)).toBeLessThan(Math.max(...bottom));
  });

  it('hanging on a tile that drops lets go', () => {
    const lv = buildRound('hotplate', 2, 'normal');
    const c = new Course(lv);
    const i = 3;
    const s = lv.solids[i];
    const p = newPlayer(lv, 0);
    Object.assign(p, { hanging: true, hangPlat: i, hangSide: 1, hangT: 2.5, x: s.x + s.w + 16, y: s.top + 10, grounded: false, plat: -1 });
    const dropTick = s.dropAt!;
    for (let t = dropTick - 5; t < dropTick + 5; t++) step(p, 0, 0, c, t);
    expect(p.hanging).toBe(false);
  });
});

describe('Trust Bridge', () => {
  it('a plank holds a couple of beans but breaks under too many', () => {
    const lv = buildTrustBridge(5, 'normal');
    const c = new Course(lv);
    const i = lv.solids.findIndex((s) => s.kind === 'plank');
    const r = lv.solids[i];
    const bean = (dx: number): PlayerState => Object.assign(newPlayer(lv, 0), { x: r.x + 40 + dx, y: r.top - HALF_H, grounded: true, plat: i });
    updateWorld(c, [bean(0), bean(50)], 10);
    expect(c.world.trig[i]).toBe(-1);
    updateWorld(c, [bean(0), bean(50), bean(100)], 11);
    expect(c.world.trig[i]).toBe(11);
    expect(c.layout(11 + 40)[i].on).toBe(false);
    expect(lv.plankLimit).toBe(3);
    expect(buildTrustBridge(5, 'hard').plankLimit).toBe(2);
  });
});

describe('Two-Key Door', () => {
  it('has 3 doors that stay shut unless held (or their rare timer)', () => {
    const lv = buildRound('twokey', 8, 'hard');
    expect(lv.gates).toHaveLength(3);
    expect(lv.gates.every((g) => g.autoEverySec >= 12)).toBe(true);
    const c = new Course(lv);
    // nobody on a plate: shut whenever the timer is not opening them
    let t = 0;
    while (lv.gates.some((_, i) => c.gateAuto(i, t))) t++;
    updateWorld(c, [], t);
    expect(lv.gates.every((g) => c.layout(t + 1)[g.solid].top === lv.solids[g.solid].top)).toBe(true);
  });
});

describe('Tail Tag', () => {
  it('is an arena with no finish: running right forever never finishes you', () => {
    const lv = buildRound('tailtag', 1, 'normal');
    const c = new Course(lv);
    c.world.racing = true;
    const p = newPlayer(lv, 0);
    for (let t = 0; t < 600; t++) step(p, BTN.right, 0, c, t);
    expect(p.finished).toBe(false);
  });
});
