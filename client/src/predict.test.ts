// Switching courses between rounds: the predicted bean must start fresh on the new course.
import { describe, expect, it } from 'vitest';
import { Course, HALF_H, buildRound, newPlayer } from '../../packages/shared/src/index.ts';
import { Predictor } from './predict.ts';

describe('Predictor.setCourse', () => {
  it('starts a fresh bean, so platform numbers from the old course never reach the new one', () => {
    const ledge = buildRound('ledge', 3, 'hard');
    const plate = buildRound('hotplate', 3, 'hard');
    const last = ledge.solids.length - 1;
    expect(last).toBeGreaterThanOrEqual(plate.solids.length); // the old platform does not exist in Hot Plate

    const pred = new Predictor(0, new Course(ledge), 100);
    const s = ledge.solids[last];
    Object.assign(pred.state, { x: s.x + 40, y: s.top - HALF_H, grounded: true, plat: last });
    for (let i = 0; i < 5; i++) pred.tick(0);

    // this is what used to happen at the start of a round: stepping the old state on the new course crashed
    const stale = new Predictor(0, new Course(ledge), 100);
    Object.assign(stale.state, { grounded: true, plat: last });
    stale.course = new Course(plate);
    expect(() => stale.tick(0)).toThrow();

    pred.setCourse(new Course(plate));
    expect(pred.state).toEqual(newPlayer(plate, 0)); // exactly where the server puts you at the start of the round
    for (let i = 0; i < 120; i++) expect(() => pred.tick(0)).not.toThrow();
    expect(pred.state.dead).toBe(false);
  });
});
