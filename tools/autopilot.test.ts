// Every difficulty of every race (Ledge Run, Two-Key Door, Trust Bridge) can actually be finished in time
// by the autopilot, alone. Alone means Two-Key Door's doors only open on their rare timer.
import { describe, expect, it } from 'vitest';
import { Course, DIFFICULTIES, SECTIONS, buildLedgeRun, buildRound, newPlayer, step, updateWorld, type Level } from '../packages/shared/src/index.ts';
import { Autopilot } from './autopilot.ts';

describe('Ledge Run can be finished', () => {
  for (const diff of DIFFICULTIES) {
    // two random draws, and one course with every obstacle in it
    for (const seed of [1, 2, 0]) {
      it(`${diff}, ${seed ? `seed ${seed}` : 'every section'}`, () => {
        race(seed ? buildLedgeRun(seed, diff) : buildLedgeRun(7, diff, SECTIONS), `${diff} seed ${seed}`);
      }, 60_000);
    }
  }
});

describe('the other races can be finished, even as the last, hardest round', () => {
  for (const type of ['twokey', 'bridge'] as const) {
    for (const diff of DIFFICULTIES) {
      for (const seed of [1, 2]) {
        it(`${type} ${diff}, seed ${seed}`, () => race(buildRound(type, seed, diff, 2), `${type} ${diff} seed ${seed}`), 60_000);
      }
    }
  }
});

function race(lv: Level, label: string) {
  const c = new Course(lv);
  c.world.racing = true;
  const p = newPlayer(lv, 0);
  const pilot = new Autopilot(lv, 0);
  let deaths = 0;
  let t = 0;
  for (; t < lv.timerTicks && !p.finished; t++) {
    const wasDead = p.dead;
    step(p, pilot.next(p, c.world, t), 0, c, t);
    updateWorld(c, [p], t);
    if (p.dead && !wasDead) deaths++;
  }
  console.log(`${label}: ${p.finished ? `finished in ${(t / 60).toFixed(1)} s` : `stuck at x ${Math.round(p.x)} of ${lv.finishX}`}, ${deaths} falls`);
  expect(p.finished).toBe(true);
}
