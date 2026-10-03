// Slim snapshots (milestone 6): what a browser decodes is the server's state (exact for your own bean,
// rounded for the others), and the bandwidth stays small.
import { describe, expect, it } from 'vitest';
import {
  BTN, COUNTDOWN_SEC, FULL_KEYS, INTRO_SEC, KEYFRAME_EVERY, SnapDecoder, newPlayer, buildTestLevel, rng, ticks,
  type RoundType, type ServerMsg, type Snapshot,
} from '../../packages/shared/src/index.ts';
import { Room, type Member } from './room.ts';

/** 4 players running and jumping through a round; player 0's decoded snapshots and the bytes they took. */
function play(type: RoundType, seconds: number) {
  const room = new Room('SNAP', { jitterTicks: 1, rounds: [type], random: rng(3) });
  const got: Array<{ snap: Snapshot; truth: Map<number, Member['state']> }> = [];
  let bytes = 0;
  let count = 0;
  let decoder: SnapDecoder | null = null;
  const ms: Member[] = [];
  const listen = (msg: ServerMsg) => {
    if (msg.t !== 'snap') return;
    const json = JSON.stringify(msg);
    bytes += json.length;
    count++;
    const snap = decoder!.decode(JSON.parse(json));
    // what the server had when it sent this one
    if (snap) got.push({ snap, truth: new Map(ms.map((m) => [m.id, structuredClone(m.state)])) });
  };
  for (let i = 0; i < 4; i++) {
    const m = room.join(`P${i}`, i === 0 ? listen : () => {})!;
    if (i === 0) decoder = new SnapDecoder(m.id);
    ms.push(m);
  }
  for (const m of ms) room.setReady(m.id, true);
  const seq = new Map<number, number>();
  let t = 0;
  const run = (n: number) => {
    for (let k = 0; k < n; k++, t++) {
      for (const m of ms) {
        const s = seq.get(m.id) ?? 0;
        seq.set(m.id, s + 1);
        const b = (t + m.id * 7) % 50 < 30 ? BTN.right : BTN.right | BTN.jump;
        m.queue.push([[s, b, 1e9]]);
      }
      room.update();
    }
  };
  run(ticks(INTRO_SEC + COUNTDOWN_SEC) + 1);
  // measure only the round itself
  got.length = 0;
  bytes = 0;
  count = 0;
  run(ticks(seconds));
  return { got, kbPerSec: bytes / seconds / 1024, count, me: ms[0].id };
}

describe('slim snapshots', () => {
  it('cover every field of a bean', () => {
    expect([...FULL_KEYS].sort()).toEqual(Object.keys(newPlayer(buildTestLevel(), 0)).sort());
  });

  for (const type of ['ledge', 'hotplate', 'tailtag', 'bridge'] as const) {
    it(`${type}: your own bean is exact, the others within rounding`, () => {
      const { got, me } = play(type, 10);
      expect(got.length).toBeGreaterThan(250);
      for (const { snap, truth } of got) {
        for (const p of snap.players) {
          const real = truth.get(p.id)!;
          if (p.id === me) {
            const { id: _id, points: _p, helps: _h, kos: _k, ...own } = p;
            expect(own).toEqual(real);
          } else {
            expect(Math.abs(p.x - real.x)).toBeLessThanOrEqual(0.05);
            expect(Math.abs(p.y - real.y)).toBeLessThanOrEqual(0.05);
            expect([p.dead, p.grounded, p.hanging, p.tail, p.finished, p.plat, p.heldBy]).toEqual([real.dead, real.grounded, real.hanging, real.tail, real.finished, real.plat, real.heldBy]);
          }
        }
      }
    });
  }

  it('stay small: under 9 KB/s per player with 4 players moving (it was 78 before milestone 6)', () => {
    for (const type of ['ledge', 'hotplate', 'tailtag', 'bridge'] as const) {
      const { kbPerSec } = play(type, 10);
      console.log(`${type}: ${kbPerSec.toFixed(1)} KB/s per player`);
      expect(kbPerSec).toBeLessThan(9);
    }
  });

  it('a browser that missed the start catches up on the next full copy', () => {
    const room = new Room('SNAP', { jitterTicks: 1, rounds: ['ledge'] });
    const msgs: ServerMsg[] = [];
    const m = room.join('P0', (msg) => msgs.push(msg))!;
    room.join('P1', () => {});
    for (let i = 0; i < KEYFRAME_EVERY * 2 * 2 + 4; i++) room.update();
    const snaps = msgs.filter((x) => x.t === 'snap');
    // drop the first few, like a page that was still loading
    const late = new SnapDecoder(m.id);
    const decoded = snaps.slice(3).map((s) => late.decode(s));
    const first = decoded.findIndex((d) => d !== null);
    expect(first).toBeGreaterThan(0); // nothing usable until a full copy
    expect(first).toBeLessThanOrEqual(KEYFRAME_EVERY);
    expect(decoded.slice(first).every((d) => d !== null)).toBe(true);
  });
});
