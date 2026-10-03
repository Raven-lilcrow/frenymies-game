// Snapshots on the wire, slimmed down (milestone 6). In memory everything stays a full PlayerState; only
// what goes over the network changes:
// - your own bean: every field with exact numbers (prediction replays from it), but only the fields that
//   changed since the last snapshot, plus a full copy now and then (a "keyframe").
// - the other beans: only what is needed to draw them and guess ahead, rounded, as a short list.
// - the moving parts of the course and the scores: only when they change, or on a keyframe.
// WebSocket runs over TCP, so snapshots arrive in order and none go missing once you are in. The only gap
// is while joining, before the game screen listens, which is what the keyframes are for.
import type { GameEvent } from './protocol.ts';
import type { PlayerState } from './sim.ts';
import type { WorldState } from './world.ts';

/** Every PlayerState field, in wire order. A test checks this against newPlayer, so none can be forgotten. */
export const FULL_KEYS = [
  'x', 'y', 'vx', 'vy', 'facing', 'grounded', 'plat', 'coyote', 'jumpBuf', 'airJumps', 'canCut', 'diving', 'diveT',
  'prev', 'dead', 'respawnT', 'cp', 'stun', 'pushCd', 'grabCd', 'protect', 'grabImmune', 'ledgeCd', 'hanging',
  'hangPlat', 'hangSide', 'hangT', 'climb', 'holding', 'heldBy', 'holdT', 'lastHitBy', 'hitCredit', 'thrownBy',
  'thrownT', 'thrownX', 'thrownPlat', 'hitCd', 'boost', 'finished', 'out', 'tail',
] as const satisfies readonly (keyof PlayerState)[];

const BOOL_KEYS = new Set<string>(['grounded', 'canCut', 'diving', 'dead', 'hanging', 'boost', 'finished', 'out', 'tail']);

/** Flags packed into one number for the other beans. */
const FLAGS = ['grounded', 'dead', 'hanging', 'diving', 'finished', 'tail', 'out', 'boost'] as const;

/** How often the server sends full copies, in snapshots (30 a second, so once a second). */
export const KEYFRAME_EVERY = 30;

/** A snapshot as it goes over the wire. */
export interface WireSnap {
  t: 'snap';
  tick: number;
  ack: number; // your newest input the server has applied
  at: number; // the tick it applied it at
  me?: number[]; // keyframe: your own bean, every field in FULL_KEYS order
  md?: number[]; // otherwise: what changed since the last one, as [field index, value, field index, value...]
  o: number[][]; // the other beans: [id, x, y, vx, vy, facing, plat, prev, hangT, protect, holding, heldBy, flags]
  ev?: GameEvent[]; // events since the last snapshot (left out if none)
  w?: WorldState; // the moving parts of the course, when they changed (or on a keyframe)
  sc?: number[]; // scores, when they changed (or on a keyframe): [id, points, helps, kos, id, points...]
}

/** A snapshot after decoding: what the game works with. */
export interface Snapshot {
  tick: number;
  ack: number;
  at: number;
  players: Array<PlayerState & { id: number; points: number; helps: number; kos: number }>;
  events: GameEvent[];
  w: WorldState;
}

const r1 = (v: number) => Math.round(v * 10) / 10;
const r2 = (v: number) => Math.round(v * 100) / 100;
const num = (v: number | boolean) => (typeof v === 'boolean' ? (v ? 1 : 0) : v);

export function packFull(p: PlayerState): number[] {
  return FULL_KEYS.map((k) => num(p[k]));
}

/** The fields of `now` that differ from `before` (both packed with packFull). */
export function packDelta(before: number[], now: number[]): number[] {
  const out: number[] = [];
  for (let i = 0; i < now.length; i++) if (now[i] !== before[i]) out.push(i, now[i]);
  return out;
}

export function packOther(id: number, p: PlayerState): number[] {
  let flags = 0;
  FLAGS.forEach((k, i) => { if (p[k]) flags |= 1 << i; });
  return [id, r1(p.x), r1(p.y), Math.round(p.vx), Math.round(p.vy), p.facing, p.plat, p.prev, r2(p.hangT), r2(p.protect), p.holding, p.heldBy, flags];
}

/** A bean with everything at rest, to fill in what the short version leaves out. */
const REST: PlayerState = Object.fromEntries(FULL_KEYS.map((k) => [k, BOOL_KEYS.has(k) ? false : 0])) as unknown as PlayerState;
Object.assign(REST, { plat: -1, hangPlat: -1, facing: 1, thrownPlat: -1 });

function unpackFull(v: number[]): PlayerState {
  const p = { ...REST } as Record<string, number | boolean>;
  FULL_KEYS.forEach((k, i) => { p[k] = BOOL_KEYS.has(k) ? v[i] === 1 : v[i]; });
  return p as unknown as PlayerState;
}

function unpackOther(v: number[]): PlayerState & { id: number } {
  const [id, x, y, vx, vy, facing, plat, prev, hangT, protect, holding, heldBy, flags] = v;
  const p: PlayerState & { id: number } = { ...REST, id, x, y, vx, vy, facing, plat, prev, hangT, protect, holding, heldBy };
  FLAGS.forEach((k, i) => { p[k] = (flags & (1 << i)) !== 0; });
  return p;
}

/** Turns wire snapshots back into full ones. One per connection: it remembers what came before. */
export class SnapDecoder {
  private own: number[] | null = null;
  private w: WorldState | null = null;
  private scores = new Map<number, { points: number; helps: number; kos: number }>();
  readonly myId: number;
  constructor(myId: number) {
    this.myId = myId;
  }

  /** The full snapshot, or null while still waiting for the first keyframe after joining. */
  decode(m: WireSnap): Snapshot | null {
    if (m.me) this.own = m.me.slice();
    else if (m.md && this.own) for (let i = 0; i < m.md.length; i += 2) this.own[m.md[i]] = m.md[i + 1];
    if (m.w) this.w = m.w;
    if (m.sc) {
      this.scores.clear();
      for (let i = 0; i < m.sc.length; i += 4) this.scores.set(m.sc[i], { points: m.sc[i + 1], helps: m.sc[i + 2], kos: m.sc[i + 3] });
    }
    if (!this.own || !this.w) return null;
    const score = (id: number) => this.scores.get(id) ?? { points: 0, helps: 0, kos: 0 };
    const players: Snapshot['players'] = [{ ...unpackFull(this.own), id: this.myId, ...score(this.myId) }];
    for (const o of m.o) {
      const p = unpackOther(o);
      players.push({ ...p, ...score(p.id) });
    }
    return { tick: m.tick, ack: m.ack, at: m.at, players, events: m.ev ?? [], w: this.w };
  }
}
