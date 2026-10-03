import { describe, expect, it } from 'vitest';
import { CREDIT_CAP, FREE_STEP, InputQueue, JITTER_TICKS, MAX_PER_TICK, STARVE_TICKS } from './inputQueue.ts';

const inputs = (from: number, n: number, buttons = 2): Array<[number, number, number]> =>
  Array.from({ length: n }, (_, i) => [from + i, buttons, 0]);

describe('InputQueue', () => {
  it('keeps a few inputs in hand, then applies one per tick', () => {
    const q = new InputQueue();
    const got: number[] = [];
    for (let t = 0; t < 100; t++) {
      q.push(inputs(t, 1));
      got.push(q.take().length);
    }
    expect(got.slice(0, JITTER_TICKS - 1)).toEqual(Array(JITTER_TICKS - 1).fill(0));
    expect(got.slice(JITTER_TICKS - 1).every((n) => n === 1)).toBe(true);
    expect(q.ack).toBe(99 - (JITTER_TICKS - 1));
  });

  it('smooths out inputs that arrive two at a time', () => {
    const q = new InputQueue();
    const got: number[] = [];
    for (let t = 0; t < 200; t++) {
      if (t % 2 === 1) q.push(inputs(t - 1, 2)); // a batch every other tick, like the browser sends
      got.push(q.take().length);
    }
    expect(got.slice(10).every((n) => n === 1)).toBe(true); // steady: never a tick without movement
  });

  it('ignores duplicates and old inputs', () => {
    const q = new InputQueue();
    q.push(inputs(0, 3));
    q.push(inputs(1, 3));
    expect(q.length).toBe(4);
  });

  it('catches up after a lag spike, up to MAX_PER_TICK a tick', () => {
    const q = new InputQueue();
    for (let t = 0; t < 10; t++) { q.push(inputs(t, 1)); q.take(); }
    // 20 ticks of nothing (a stall), then all 20 inputs arrive at once
    for (let t = 0; t < 20; t++) q.take();
    q.push(inputs(10, 20));
    // fast catch-up until only the jitter buffer is left, then back to one a tick
    let ticks = 0;
    while (q.length > JITTER_TICKS) {
      expect(q.take().length).toBeLessThanOrEqual(MAX_PER_TICK);
      ticks++;
    }
    expect(ticks).toBeLessThanOrEqual(6);
    expect(q.take()).toHaveLength(1);
  });

  it('keeps a frozen player falling with no buttons after a short wait', () => {
    const q = new InputQueue();
    q.push(inputs(0, JITTER_TICKS));
    for (let t = 0; t < JITTER_TICKS; t++) q.take();
    for (let t = 0; t < STARVE_TICKS; t++) expect(q.take()).toEqual([]);
    expect(q.take()).toEqual([{ buttons: FREE_STEP, viewTick: -1 }]);
    expect(q.ack).toBe(JITTER_TICKS - 1); // free steps do not pretend an input was applied
  });

  it('a player who has not sent anything yet waits at the spawn point', () => {
    const q = new InputQueue();
    for (let t = 0; t < 100; t++) expect(q.take()).toEqual([]);
  });

  it('a client sending twice as fast still moves at 60 ticks a second on average', () => {
    const q = new InputQueue();
    let seq = 0, applied = 0;
    const ticks = 600;
    for (let t = 0; t < ticks; t++) {
      q.push(inputs(seq, 2));
      seq += 2;
      applied += q.take().length;
    }
    expect(applied).toBeLessThanOrEqual(ticks + CREDIT_CAP);
  });
});
