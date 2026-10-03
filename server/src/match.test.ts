// A whole match, and the rules of each round mode, driven tick by tick through a real Room.
import { describe, expect, it } from 'vitest';
import {
  BTN, COUNTDOWN_SEC, FINAL, FINAL_POINTS, FINISH_POINTS, HALF_H, INTRO_SEC, POOL, RESPAWN_DELAY, RESULTS_SEC, SHOW_SEC,
  TAIL_POINTS, rng, ticks, type GameEvent, type RoundType, type ServerMsg,
} from '../../packages/shared/src/index.ts';
import { Room, highlights, type Member } from './room.ts';

interface Rig {
  room: Room;
  ms: Member[];
  events: GameEvent[];
  seq: Map<number, number>;
}

function rig(n: number, rounds?: RoundType[], seed = 1): Rig {
  const room = new Room('MTCH', { jitterTicks: 1, rounds, random: rng(seed) });
  const events: GameEvent[] = [];
  const ms: Member[] = [];
  for (let i = 0; i < n; i++) {
    ms.push(room.join(`P${i}`, (msg: ServerMsg) => { if (msg.t === 'snap' && i === 0) events.push(...(msg.ev ?? [])); })!);
  }
  return { room, ms, events, seq: new Map() };
}

function run(r: Rig, n: number, buttons: (m: Member, t: number) => number = () => 0) {
  for (let t = 0; t < n; t++) {
    for (const m of r.ms) {
      const seq = r.seq.get(m.id) ?? 0;
      r.seq.set(m.id, seq + 1);
      m.queue.push([[seq, buttons(m, t), 1e9]]);
    }
    r.room.update();
  }
}

/** Ready everyone up and play out the intro: the round is on. */
function start(r: Rig) {
  for (const m of r.ms) r.room.setReady(m.id, true);
  run(r, ticks(INTRO_SEC + COUNTDOWN_SEC) + 1);
  expect(r.room.round.phase).toBe('play');
  for (const m of r.ms) m.state.protect = 0;
}

/** Play on until the round's results are up (it can end early, before its timer). */
function untilResults(r: Rig) {
  for (let i = 0; i < 20_000 && r.room.round.phase !== 'results'; i++) run(r, 1);
  expect(r.room.round.phase).toBe('results');
}

/** Drop a bean into the pit. */
const fall = (m: Member) => Object.assign(m.state, { x: 120, y: 1100, vx: 0, vy: 0, grounded: false, hanging: false, plat: -1 });

/** Stand a bean on the floor of Tail Tag's arena (left floor part). */
const stand = (m: Member, x: number, facing = 1) =>
  Object.assign(m.state, { x, y: 800 - HALF_H, vx: 0, vy: 0, facing, grounded: true, plat: 0, protect: 0 });

describe('a match', () => {
  it('is 2 rounds from the pool and the final, points carry over, and it ends on the show', () => {
    const r = rig(2);
    for (const m of r.ms) r.room.setReady(m.id, true);
    const { match } = r.room.round;
    expect(match).toHaveLength(3);
    expect(match[2]).toBe(FINAL);
    expect(POOL).toContain(match[0]);
    expect(POOL).toContain(match[1]);
    expect(match[0]).not.toBe(match[1]);
    const seen: RoundType[] = [];
    let carried = 0;
    for (let i = 0; i < 3; i++) {
      expect(r.room.round.index).toBe(i);
      expect(r.room.level.type).toBe(match[i]);
      seen.push(r.room.level.type);
      r.ms[0].points += 1; // as if they scored something this round
      carried += 1;
      untilResults(r);
      run(r, ticks(RESULTS_SEC) + 1);
    }
    expect(seen).toEqual(match);
    expect(r.room.round.phase).toBe('show');
    expect(r.ms[0].points).toBeGreaterThanOrEqual(carried);
    expect(r.room.round.results!.winners.length).toBeGreaterThan(0);
    run(r, ticks(SHOW_SEC) + 1);
    expect(r.room.round.phase).toBe('lobby');
    expect(r.room.level.type).toBe('ledge');
  });
});

describe('survival (Hot Plate)', () => {
  it('falling knocks you out for the round; the last one standing wins; places go by who lasted longest', () => {
    const r = rig(3, ['hotplate']);
    start(r);
    const [a, b, c] = r.ms;
    fall(a);
    run(r, 30);
    expect(a.state.out).toBe(true);
    expect(r.events.some((e) => e.k === 'out' && e.a === a.id)).toBe(true);
    run(r, ticks(RESPAWN_DELAY) + 30);
    expect(a.state.dead).toBe(true); // no respawn
    expect(r.room.round.phase).toBe('play');
    fall(b);
    run(r, 30);
    expect(r.room.round.phase).toBe('results');
    const rows = r.room.round.results!.rows;
    const place = (m: Member) => rows.find((x) => x.id === m.id)!;
    expect([place(c).place, place(b).place, place(a).place]).toEqual([1, 2, 3]);
    expect([c.points, b.points, a.points]).toEqual(FINISH_POINTS);
  });

  it('the tiles drop by themselves, so the round always ends', () => {
    const r = rig(1, ['hotplate']);
    start(r);
    untilResults(r);
    expect(r.ms[0].state.out).toBe(true); // nothing left to stand on
  });
});

describe('hunt (Tail Tag)', () => {
  it('hands out 2 tails to 4 players; grabbing a holder steals it, and it can\'t be snatched straight back', () => {
    const r = rig(4, ['tailtag']);
    start(r);
    const holders = r.ms.filter((m) => m.state.tail);
    expect(holders).toHaveLength(2);
    const h = holders[0];
    const x = r.ms.find((m) => !m.state.tail)!;
    stand(x, 500, 1);
    stand(h, 540, -1);
    run(r, 2, (m, t) => (m === x && t === 0 ? BTN.grab : 0));
    expect(x.state.tail).toBe(true);
    expect(h.state.tail).toBe(false);
    expect(r.events.some((e) => e.k === 'steal' && e.a === x.id && e.b === h.id)).toBe(true);
    // h grabs back at once: immune
    run(r, 30);
    stand(x, 540, 1);
    stand(h, 500, 1);
    run(r, 2, (m, t) => (m === h && t === 0 ? BTN.grab : 0));
    expect(x.state.tail).toBe(true);
  });

  it('grabbing someone without a tail passes yours on, and that is a help', () => {
    const r = rig(2, ['tailtag']);
    start(r);
    const h = r.ms.find((m) => m.state.tail)!;
    const o = r.ms.find((m) => m !== h)!;
    stand(h, 500, 1);
    stand(o, 540, -1);
    run(r, 2, (m, t) => (m === h && t === 0 ? BTN.grab : 0));
    expect(o.state.tail).toBe(true);
    expect(h.helps).toBe(1);
    expect(r.events.some((e) => e.k === 'pass')).toBe(true);
    // and it is this round's highlight
    run(r, r.room.round.end - r.room.tick + 2);
    expect(r.room.round.results!.highlights).toEqual([{ k: 'pass', a: h.id, b: o.id, n: 1 }]);
  });

  it('whoever holds a tail when time runs out scores', () => {
    const r = rig(2, ['tailtag']);
    start(r);
    const h = r.ms.find((m) => m.state.tail)!;
    const o = r.ms.find((m) => m !== h)!;
    for (const m of r.ms) stand(m, m === h ? 500 : 800);
    run(r, r.room.round.end - r.room.tick + 2);
    expect(r.room.round.phase).toBe('results');
    expect(h.points).toBe(TAIL_POINTS);
    expect(o.points).toBe(0);
  });
});

describe('the final (Trust Bridge)', () => {
  it('first across wins the crown and ends the round at once', () => {
    const r = rig(2, ['bridge']);
    start(r);
    const [a] = r.ms;
    const lv = r.room.level;
    Object.assign(a.state, { x: lv.finishX - 30, y: lv.finishTop - HALF_H, vx: 0, vy: 0, grounded: true, plat: lv.solids.length - 1 });
    run(r, 20, (m) => (m === a ? BTN.right : 0));
    expect(a.points).toBe(FINAL_POINTS);
    expect(r.room.round.phase).toBe('results');
    expect(r.events.some((e) => e.k === 'finish' && e.a === a.id && e.pts === FINAL_POINTS)).toBe(true);
  });
});

describe('highlights', () => {
  it('picks the biggest help and the biggest hurt between two players', () => {
    const book = new Map([
      ['save 1 2', { k: 'save' as const, a: 1, b: 2, n: 1 }],
      ['door 3 2', { k: 'door' as const, a: 3, b: 2, n: 3 }],
      ['ko 2 1', { k: 'ko' as const, a: 2, b: 1, n: 2 }],
      ['steal 4 1', { k: 'steal' as const, a: 4, b: 1, n: 1 }],
    ]);
    expect(highlights(book)).toEqual([{ k: 'door', a: 3, b: 2, n: 3 }, { k: 'ko', a: 2, b: 1, n: 2 }]);
    expect(highlights(new Map())).toEqual([]);
  });

  it('only counts what happens in a round, not practice in the lobby, and the show sums the whole match', () => {
    const r = rig(2, ['tailtag', 'tailtag']);
    const [p0, p1] = r.ms;
    // practice in the lobby: a knockout that must not show up later
    fall(p1);
    Object.assign(p1.state, { lastHitBy: p0.id, hitCredit: 120, protect: 0 });
    run(r, 30);
    expect(r.events.some((e) => e.k === 'ko' && e.a === p0.id)).toBe(true);
    start(r);
    run(r, r.room.round.end - r.room.tick + 2);
    expect(r.room.round.results!.highlights).toEqual([]);
    run(r, ticks(RESULTS_SEC) + 1);
    const h = r.ms.find((m) => m.state.tail)!;
    const o = r.ms.find((m) => m !== h)!;
    for (const m of r.ms) m.state.protect = 0;
    run(r, ticks(INTRO_SEC + COUNTDOWN_SEC) + 1);
    for (const m of r.ms) m.state.protect = 0;
    stand(h, 500, 1);
    stand(o, 540, -1);
    run(r, 2, (m, t) => (m === h && t === 0 ? BTN.grab : 0));
    untilResults(r);
    run(r, ticks(RESULTS_SEC) + 1);
    expect(r.room.round.phase).toBe('show');
    expect(r.room.round.results!.highlights).toEqual([{ k: 'pass', a: h.id, b: o.id, n: 1 }]);
  });
});
