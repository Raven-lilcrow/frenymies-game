import { describe, expect, it } from 'vitest';
import { CLIMB_PRESSES, DT, HALF_H, HANG_TIME, JUMP_HEIGHT, RESPAWN_DELAY } from './constants.ts';
import { buildTestLevel } from './level.ts';
import { BTN, INTENT, newPlayer as newBean, spawnPoint, step, type PlayerState } from './sim.ts';
import { Course } from './world.ts';

// the old all-static test level, so these numbers never change
const lv = buildTestLevel();
const course = new Course(lv);
let now = 0;
const tick = (p: PlayerState, buttons: number, slot = 0) => step(p, buttons, slot, course, now++);
const newPlayer = (slot: number) => newBean(lv, slot);

const run = (p: PlayerState, buttons: number, ticks: number, slot = 0) => {
  for (let i = 0; i < ticks; i++) tick(p, buttons, slot);
  return p;
};

const settled = () => run(newPlayer(0), 0, 60);

describe('movement', () => {
  it('lands on the start platform', () => {
    const p = settled();
    expect(p.grounded).toBe(true);
    expect(p.y).toBe(800 - HALF_H);
  });

  it('a held jump reaches about the designed height', () => {
    const p = settled();
    const ground = p.y;
    let top = p.y;
    for (let i = 0; i < 90; i++) {
      tick(p, BTN.jump, 0);
      top = Math.min(top, p.y);
    }
    const height = ground - top;
    // the apex hang makes it go a little higher than JUMP_HEIGHT
    expect(height).toBeGreaterThan(JUMP_HEIGHT * 0.95);
    expect(height).toBeLessThan(JUMP_HEIGHT * 1.25);
    expect(p.grounded).toBe(true);
  });

  it('a tap jump is lower than a held jump', () => {
    const p = settled();
    const ground = p.y;
    let top = p.y;
    tick(p, BTN.jump, 0);
    for (let i = 0; i < 60; i++) {
      tick(p, 0, 0);
      top = Math.min(top, p.y);
    }
    expect(ground - top).toBeLessThan(JUMP_HEIGHT * 0.6);
  });

  it('a second press in the air double jumps, a third does nothing', () => {
    // hold jump, let go for one tick, press again (and again)
    const height = (presses: number) => {
      const p = settled();
      const ground = p.y;
      let top = p.y;
      for (let i = 0; i < 120; i++) {
        const gapTick = [18, 30].slice(0, presses - 1).includes(i);
        tick(p, gapTick ? 0 : BTN.jump, 0);
        top = Math.min(top, p.y);
      }
      return ground - top;
    };
    expect(height(2)).toBeGreaterThan(height(1) + 60);
    expect(height(3)).toBeLessThanOrEqual(height(2)); // no third jump (letting go even cuts the rise a little)
  });

  it('runs at run speed and dives faster', () => {
    const p = settled();
    run(p, BTN.right, 40);
    expect(p.vx).toBeGreaterThan(355);
    tick(p, BTN.right | BTN.dive, 0);
    expect(p.vx).toBe(580);
    expect(p.diving).toBe(true);
  });

  it('cannot run through a wall', () => {
    // the tall block starts at x = 2960; stand on the pad platform's left side and run right
    const p = newPlayer(0);
    p.x = 2650; p.y = 740; p.cp = 2;
    run(p, BTN.right, 30);
    // the pad bounces you up and onto the block, or you stop at its face; never inside it
    const inside = p.x > 2960 - 15 && p.x < 2960 + 260 + 15 && p.y > 560 + HALF_H;
    expect(inside).toBe(false);
  });

  it('falling off the map respawns at the checkpoint after the delay', () => {
    const p = settled();
    let ticks = 0;
    while (!p.dead && ticks < 600) { tick(p, BTN.right, 0); ticks++; }
    expect(p.dead).toBe(true);
    run(p, 0, Math.ceil(RESPAWN_DELAY / DT) + 1);
    expect(p.dead).toBe(false);
    const s = spawnPoint(lv, 0, 0);
    expect(p.x).toBe(s.x);
  });
});

describe('ledges', () => {
  // just right of the second platform (x 820 to 1000, top 760), falling straight down
  const besideEdge = () => {
    const p = newPlayer(0);
    p.x = 1020; p.y = 700; p.vx = 0; p.vy = 0;
    return p;
  };

  it('falling past an edge grabs the ledge', () => {
    const p = besideEdge();
    run(p, 0, 20);
    expect(p.hanging).toBe(true);
    expect(p.hangSide).toBe(1);
    expect(p.facing).toBe(-1);
  });

  it('mashing jump climbs up', () => {
    const p = besideEdge();
    run(p, 0, 20);
    let climbed = 0;
    for (let i = 0; i < CLIMB_PRESSES * 2; i++) climbed |= tick(p, i % 2 ? 0 : BTN.jump, 0);
    expect(climbed & INTENT.climbed).toBeTruthy();
    expect(p.hanging).toBe(false);
    run(p, 0, 10);
    expect(p.grounded).toBe(true);
    expect(p.y).toBe(760 - HALF_H);
  });

  it('lets go when the hang timer runs out', () => {
    const p = besideEdge();
    run(p, 0, 20);
    run(p, 0, Math.ceil(HANG_TIME / DT) + 1);
    expect(p.hanging).toBe(false);
  });

  it('shove and grab presses are reported, with cooldowns', () => {
    const p = settled();
    expect(tick(p, BTN.push, 0) & INTENT.push).toBeTruthy();
    tick(p, 0, 0);
    expect(tick(p, BTN.push, 0) & INTENT.push).toBe(0); // still cooling down
    expect(tick(p, BTN.grab, 0) & INTENT.grab).toBeTruthy();
  });
});

describe('determinism (prediction depends on it)', () => {
  const script = (i: number) => [BTN.right, BTN.right | BTN.jump, BTN.jump, 0, BTN.left, BTN.dive, BTN.right | BTN.jump, BTN.push, BTN.grab][(i * 7 + (i >> 3)) % 9];

  it('the same inputs give exactly the same result', () => {
    const a = newPlayer(1), b = newPlayer(1);
    for (let i = 0; i < 900; i++) { step(a, script(i), 1, course, i); step(b, script(i), 1, course, i); }
    expect(a).toEqual(b);
  });

  it('survives a JSON round trip mid-run, like a snapshot does', () => {
    const a = newPlayer(2);
    let b = newPlayer(2);
    for (let i = 0; i < 900; i++) {
      step(a, script(i), 2, course, i);
      step(b, script(i), 2, course, i);
      if (i % 37 === 0) b = JSON.parse(JSON.stringify(b)) as PlayerState;
    }
    expect(b).toEqual(a);
  });
});
