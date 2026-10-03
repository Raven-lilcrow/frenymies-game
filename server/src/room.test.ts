// The help-or-hurt rules, driven tick by tick through a real Room (no sockets).
import { describe, expect, it } from 'vitest';
import {
  BOOST_GAP, BTN, COUNTDOWN_SEC, FINISH_POINTS, GRAB_IMMUNE, HALF_H, INTRO_SEC, RESULTS_SEC, SECTIONS, SHOW_SEC, buildLedgeRun,
  buildTestLevel, ticks, type GameEvent, type Level, type RoundInfo, type ServerMsg,
} from '../../packages/shared/src/index.ts';
import { Room, type Member } from './room.ts';

interface Rig {
  room: Room;
  ms: Member[];
  events: GameEvent[];
  rounds: RoundInfo[]; // every round message the first player got
  seq: Map<number, number>;
}

/** A room on the all-static test level (or another course), with n players. Matches are one round long. */
function rig(n: number, level: Level = buildTestLevel()): Rig {
  const room = new Room('TEST', { jitterTicks: 1, level, rounds: ['ledge'] });
  const events: GameEvent[] = [];
  const rounds: RoundInfo[] = [];
  const ms: Member[] = [];
  for (let i = 0; i < n; i++) {
    const m = room.join(`P${i}`, (msg: ServerMsg) => {
      if (msg.t === 'snap' && i === 0) events.push(...(msg.ev ?? []));
      if (msg.t === 'round' && i === 0) rounds.push(msg);
    })!;
    m.state.protect = 0;
    ms.push(m);
  }
  return { room, ms, events, rounds, seq: new Map() };
}

/** Put a bean standing on the start platform (top 800) or anywhere else. */
function place(m: Member, x: number, y = 800 - HALF_H, facing = 1) {
  Object.assign(m.state, { x, y, vx: 0, vy: 0, facing, grounded: true, plat: 0, prev: 0 });
}

/** Hang a bean off the right edge of the second platform (x 820 to 1000, top 760). */
function hang(m: Member) {
  Object.assign(m.state, { x: 1016, y: 770, vx: 0, vy: 0, hanging: true, hangPlat: 1, hangSide: 1, hangT: 2.5, climb: 0, facing: -1, grounded: false, plat: -1 });
}

/** Run ticks; `buttons` says what each member holds (default nothing). */
function run(r: Rig, ticks: number, buttons: (m: Member, t: number) => number = () => 0, viewTick?: number) {
  for (let t = 0; t < ticks; t++) {
    for (const m of r.ms) {
      const seq = r.seq.get(m.id) ?? 0;
      r.seq.set(m.id, seq + 1);
      m.queue.push([[seq, buttons(m, t), viewTick ?? 1e9]]); // default: the pusher sees the present
    }
    r.room.update();
  }
}

/** A few idle ticks first, so every bean has sent an input and there is some history. */
function warm(r: Rig) {
  run(r, 3);
}

const onlyFor = (who: Member, b: number, tick = 0) => (m: Member, t: number) => (m === who && t === tick ? b : 0);

describe('shove', () => {
  it('knocks the bean in front away and remembers who did it', () => {
    const r = rig(2);
    const [a, b] = r.ms;
    warm(r);
    place(a, 300); place(b, 350);
    run(r, 4, onlyFor(a, BTN.push));
    expect(b.state.vx).toBeGreaterThan(300);
    expect(b.state.stun).toBeGreaterThan(0);
    expect(b.state.airJumps).toBe(0);
    expect(b.state.lastHitBy).toBe(a.id);
    run(r, 2);
    expect(r.events.some((e) => e.k === 'shove' && e.a === a.id && e.b === b.id)).toBe(true);
  });

  it('does nothing to a bean with spawn protection', () => {
    const r = rig(2);
    const [a, b] = r.ms;
    warm(r);
    place(a, 300); place(b, 350);
    b.state.protect = 1;
    run(r, 4, onlyFor(a, BTN.push));
    expect(Math.abs(b.state.vx)).toBeLessThan(1);
    expect(b.state.lastHitBy).toBe(0);
  });

  it('shoving someone off a ledge is a knockout for the shover', () => {
    const r = rig(2);
    const [a, b] = r.ms;
    warm(r);
    Object.assign(a.state, { x: 980, y: 760 - HALF_H, facing: 1, grounded: true, plat: 1 });
    hang(b);
    run(r, 120, onlyFor(a, BTN.push));
    expect(a.kos).toBe(1);
    expect(a.points).toBe(1);
    expect(r.events.some((e) => e.k === 'shoveOff')).toBe(true);
    expect(r.events.some((e) => e.k === 'ko' && e.a === a.id && e.b === b.id)).toBe(true);
  });
});

describe('favor the pusher', () => {
  it('a shove counts if the target was in range on the pusher\'s screen', () => {
    const r = rig(2);
    const [a, b] = r.ms;
    warm(r);
    place(a, 300); place(b, 340);
    run(r, 5);
    const seen = r.room.tick; // the pusher's screen shows b here
    place(b, 600); // by the time the shove arrives, b has moved away
    run(r, 6);
    run(r, 2, onlyFor(a, BTN.push), seen);
    expect(b.state.lastHitBy).toBe(a.id);
  });

  it('but only up to half a second back', () => {
    const r = rig(2);
    const [a, b] = r.ms;
    warm(r);
    place(a, 300); place(b, 340);
    run(r, 5);
    const seen = r.room.tick;
    place(b, 600);
    run(r, 40);
    run(r, 2, onlyFor(a, BTN.push), seen);
    expect(b.state.lastHitBy).toBe(0);
  });
});

describe('grab and throw', () => {
  it('grab carries, letting go throws, and you can\'t be grabbed again right away', () => {
    const r = rig(2);
    const [a, b] = r.ms;
    warm(r);
    place(a, 300); place(b, 340);
    run(r, 10, (m) => (m === a ? BTN.grab : 0)); // hold grab
    expect(a.state.holding).toBe(b.id);
    expect(b.state.heldBy).toBe(a.id);
    expect(b.state.x).toBeCloseTo(a.state.x + 34, 5); // carried in front
    run(r, 1); // let go
    expect(a.state.holding).toBe(0);
    expect(b.state.heldBy).toBe(0);
    expect(b.state.vx).toBeGreaterThan(500);
    expect(b.state.grabImmune).toBeGreaterThan(GRAB_IMMUNE - 0.1);
    // chase and grab again at once: immune
    place(b, 340);
    run(r, 3, onlyFor(a, BTN.grab));
    expect(b.state.heldBy).toBe(0);
  });

  it('holding too long throws automatically', () => {
    const r = rig(2);
    const [a, b] = r.ms;
    warm(r);
    place(a, 300); place(b, 340);
    run(r, 150, (m) => (m === a ? BTN.grab : 0));
    expect(b.state.heldBy).toBe(0);
    expect(r.events.some((e) => e.k === 'throw')).toBe(true);
  });

  it('throwing someone across a gap onto a platform ahead is a help', () => {
    const r = rig(2);
    const [a, b] = r.ms;
    warm(r);
    place(a, 640); place(b, 680);
    run(r, 6, (m) => (m === a ? BTN.grab : 0));
    expect(a.state.holding).toBe(b.id);
    run(r, 180); // let go, then wait for the landing
    const landed = r.events.find((e) => e.k === 'help');
    const ko = r.events.find((e) => e.k === 'ko');
    // either it lands ahead (a help) or it falls in the pit (a knockout); never both
    expect(Boolean(landed) !== Boolean(ko)).toBe(true);
    if (landed) expect(a.helps).toBe(1);
    else expect(a.kos).toBe(1);
  });
});

describe('pull up', () => {
  it('grabbing someone hanging pulls them up and is a help', () => {
    const r = rig(2);
    const [a, b] = r.ms;
    warm(r);
    Object.assign(a.state, { x: 980, y: 760 - HALF_H, facing: 1, grounded: true, plat: 1 });
    hang(b);
    run(r, 3, onlyFor(a, BTN.grab));
    expect(b.state.hanging).toBe(false);
    expect(b.state.y).toBeLessThan(760);
    expect(a.helps).toBe(1);
    expect(a.points).toBe(1);
    expect(r.events.some((e) => e.k === 'save' && e.pts === 1)).toBe(true);
  });

  it('pulling up the same person again right away scores nothing', () => {
    const r = rig(2);
    const [a, b] = r.ms;
    warm(r);
    Object.assign(a.state, { x: 980, y: 760 - HALF_H, facing: 1, grounded: true, plat: 1 });
    hang(b);
    run(r, 3, onlyFor(a, BTN.grab));
    run(r, 40); // grab cooldown passes
    Object.assign(a.state, { x: 980, y: 760 - HALF_H, facing: 1, grounded: true, plat: 1 });
    hang(b);
    run(r, 3, onlyFor(a, BTN.grab));
    expect(b.state.hanging).toBe(false); // still saved
    expect(a.helps).toBe(1); // but no second point
  });
});

describe('knockout credit', () => {
  it('a fall within 4 seconds of a hit goes to the hitter', () => {
    const r = rig(2);
    const [a, b] = r.ms;
    warm(r);
    Object.assign(b.state, { x: 760, y: 900, vx: 0, vy: 0, grounded: false, lastHitBy: a.id, hitCredit: 4 });
    run(r, 60);
    expect(a.kos).toBe(1);
  });

  it('a fall long after the hit is just a fall', () => {
    const r = rig(2);
    const [a, b] = r.ms;
    warm(r);
    Object.assign(b.state, { x: 760, y: 900, vx: 0, vy: 0, grounded: false, lastHitBy: a.id, hitCredit: 0.05 });
    run(r, 60);
    expect(a.kos).toBe(0);
    expect(r.events.some((e) => e.k === 'fall' && e.a === b.id)).toBe(true);
  });

  it('a bean that leaves frees whoever it was carrying', () => {
    const r = rig(2);
    const [a, b] = r.ms;
    warm(r);
    place(a, 300); place(b, 340);
    run(r, 6, (m) => (m === a ? BTN.grab : 0));
    expect(b.state.heldBy).toBe(a.id);
    r.room.leave(a.id);
    r.ms = [b];
    expect(b.state.heldBy).toBe(0);
  });
});

describe('a round', () => {
  /** Everyone readies up and the intro plays out: the race is on. */
  function race(r: Rig) {
    for (const m of r.ms) r.room.setReady(m.id, true);
    expect(r.room.round.phase).toBe('intro');
    run(r, ticks(INTRO_SEC + COUNTDOWN_SEC) + 1);
    expect(r.room.round.phase).toBe('play');
    for (const m of r.ms) m.state.protect = 0;
  }
  /** Stand a bean just before the finish line. */
  const nearFinish = (m: Member) => Object.assign(m.state, { x: 3910, y: 700 - HALF_H, vx: 0, vy: 0, grounded: true, plat: 9 });

  it('starts only when everyone is ready, and nobody moves during the countdown', () => {
    const r = rig(2);
    const [a, b] = r.ms;
    r.room.setReady(a.id, true);
    expect(r.room.round.phase).toBe('lobby');
    expect(r.rounds.at(-1)!.ready).toEqual([a.id]);
    r.room.setReady(b.id, true);
    expect(r.room.round.phase).toBe('intro');
    run(r, 30); // settle on the start platform
    const x = a.state.x;
    run(r, 60, () => BTN.right);
    expect(a.state.x).toBe(x);
    run(r, ticks(INTRO_SEC + COUNTDOWN_SEC));
    run(r, 20, () => BTN.right);
    expect(a.state.x).toBeGreaterThan(x + 50);
  });

  it('the first 3 to finish score 3, 2 and 1, and that ends the round', () => {
    const r = rig(4);
    race(r);
    const [a, b, c, d] = r.ms;
    for (const m of [b, a, d]) {
      nearFinish(m);
      run(r, 20, (x) => (x === m ? BTN.right : 0));
    }
    expect(r.room.round.finished).toEqual([b.id, a.id, d.id]);
    expect([b.points, a.points, d.points, c.points]).toEqual([...FINISH_POINTS, 0]);
    run(r, 1);
    expect(r.room.round.phase).toBe('results');
    const res = r.room.round.results!;
    expect(res.rows[0].id).toBe(b.id);
    expect(res.rows.find((x) => x.id === c.id)!.place).toBe(0);
    expect(r.events.filter((e) => e.k === 'finish').map((e) => e.place)).toEqual([1, 2, 3]);
  });

  it('the timer ends the round, then results, the end of the match, and back to the lobby', () => {
    const r = rig(1);
    race(r);
    run(r, r.room.level.timerTicks + 1);
    expect(r.room.round.phase).toBe('results');
    run(r, ticks(RESULTS_SEC) + 1);
    expect(r.room.round.phase).toBe('show');
    run(r, ticks(SHOW_SEC) + 1);
    expect(r.room.round.phase).toBe('lobby');
    expect(r.ms[0].state.x).toBeLessThan(400); // back at the start
  });

  it('results name the Saint (most helps) and the Traitor (most knockouts)', () => {
    const r = rig(2);
    race(r);
    const [a, b] = r.ms;
    Object.assign(a.state, { x: 980, y: 760 - HALF_H, facing: 1, grounded: true, plat: 1 });
    hang(b);
    run(r, 3, onlyFor(a, BTN.grab)); // a pulls b up
    run(r, r.room.level.timerTicks);
    expect(r.room.round.results!.saints).toEqual([a.id]);
    expect(r.room.round.results!.traitors).toEqual([]);
  });

  it('last place gets the catch-up boost when far behind', () => {
    const r = rig(3);
    race(r);
    const [a, b, c] = r.ms;
    Object.assign(a.state, { x: 200 + BOOST_GAP + 300, y: 800 - HALF_H, grounded: true, plat: 0 });
    Object.assign(b.state, { x: 450, y: 800 - HALF_H, grounded: true, plat: 0 });
    Object.assign(c.state, { x: 200, y: 800 - HALF_H, grounded: true, plat: 0 });
    run(r, 1);
    expect([a.state.boost, b.state.boost, c.state.boost]).toEqual([false, false, true]);
    c.state.x = 600; // caught up
    run(r, 1);
    expect(c.state.boost).toBe(false);
  });

  it('holding the gate button while someone walks through is a help', () => {
    const lv = buildLedgeRun(42, 'normal', SECTIONS);
    const r = rig(2, lv);
    const [a, b] = r.ms;
    const g = lv.gates[0];
    const floor = lv.solids.findIndex((s) => s.x <= g.buttons[0].x0 && s.x + s.w >= g.buttons[1].x1);
    const stand = (m: Member, x: number) => Object.assign(m.state, { x, y: 800 - HALF_H, vx: 0, vy: 0, grounded: true, plat: floor, protect: 0 });
    // wait for a moment when the gate stays shut by itself for a while
    const autoSoon = () => Array.from({ length: 150 }, (_, k) => r.room.course.gateAuto(0, r.room.tick + k)).some(Boolean);
    while (autoSoon()) run(r, 1);
    stand(a, (g.buttons[0].x0 + g.buttons[0].x1) / 2);
    stand(b, g.x - 40);
    run(r, 40); // a holds the button, the door lifts
    run(r, 30, (m) => (m === b ? BTN.right : 0));
    expect(b.state.x).toBeGreaterThan(g.x);
    expect(a.helps).toBe(1);
    expect(r.events.some((e) => e.k === 'door' && e.a === a.id && e.b === b.id)).toBe(true);
  });
});
