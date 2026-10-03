// Smooth movement for the other players.
// Their beans are drawn a little in the past (about 100 ms, more on a shaky connection), between two
// snapshots we already have, so they glide instead of jumping every time a packet arrives.
// If a packet is late, their bean keeps moving for a short while with the buttons they were last
// holding (same movement rules as everywhere else), instead of freezing.
import { SNAPSHOT_EVERY, TICK_RATE, step, type Course, type SnapPlayer } from '../../packages/shared/src/index.ts';

const MS_PER_TICK = 1000 / TICK_RATE;
const MIN_DELAY_TICKS = 6; // 100 ms
const MAX_DELAY_TICKS = 24; // 400 ms
const MAX_EXTRAPOLATE_TICKS = 8; // 133 ms, then hold still until data arrives

interface Snap {
  tick: number;
  players: Map<number, SnapPlayer>;
}

export class Interpolator {
  private snaps: Snap[] = [];
  private offset: number | null = null; // server tick minus local clock (in ticks), from the fastest packets
  private late: number[] = []; // recent lateness (ticks) compared with the fastest packet
  delayTicks = MIN_DELAY_TICKS;
  /** For guessing ahead: a course of its own, so guesses never mark platforms in the real one. */
  course: Course | null = null;

  push(tick: number, players: SnapPlayer[], nowMs: number): void {
    const o = tick - nowMs / MS_PER_TICK;
    if (this.offset === null || o > this.offset) this.offset = o;
    else this.offset -= 0.002; // drift down very slowly in case the clocks disagree
    // Wait long enough to cover how late 85% of packets arrive; the rare very late one just pauses a bean briefly.
    this.late.push(this.offset - o);
    if (this.late.length > 90) this.late.shift(); // last 3 seconds
    const p85 = [...this.late].sort((a, b) => a - b)[Math.floor(this.late.length * 0.85)];
    const want = Math.min(MAX_DELAY_TICKS, Math.max(MIN_DELAY_TICKS, SNAPSHOT_EVERY * 2 + p85));
    this.delayTicks += (want - this.delayTicks) * 0.05;
    if (this.snaps.length && tick <= this.snaps[this.snaps.length - 1].tick) return;
    this.snaps.push({ tick, players: new Map(players.map((p) => [p.id, p])) });
    if (this.snaps.length > 120) this.snaps.shift();
  }

  /** Best guess of the server's tick right now (for timers). */
  serverTick(nowMs: number): number {
    return (this.offset ?? 0) + nowMs / MS_PER_TICK;
  }

  renderTick(nowMs: number): number {
    return (this.offset ?? 0) + nowMs / MS_PER_TICK - this.delayTicks;
  }

  /** The other player's position at the render time, or null if we have no data yet. */
  sample(id: number, nowMs: number): (SnapPlayer & { renderTick: number }) | null {
    const rt = this.renderTick(nowMs);
    let a: Snap | null = null;
    let b: Snap | null = null;
    for (const s of this.snaps) {
      if (!s.players.has(id)) continue;
      if (s.tick <= rt) a = s;
      else { b = s; break; }
    }
    const pa = a?.players.get(id);
    const pb = b?.players.get(id);
    if (pa && pb) {
      const t = (rt - a!.tick) / (b!.tick - a!.tick);
      // across a respawn there is nothing in between to draw: jump straight to the new spot
      if (pa.dead !== pb.dead || Math.hypot(pb.x - pa.x, pb.y - pa.y) > 200) return { ...(t < 0.5 ? pa : pb), renderTick: rt };
      return { ...pb, x: pa.x + (pb.x - pa.x) * t, y: pa.y + (pb.y - pa.y) * t, renderTick: rt };
    }
    if (pb) return { ...pb, renderTick: rt }; // only future data: just joined
    if (!pa) return null;
    return { ...this.extrapolate(pa, a!.tick, rt - a!.tick), renderTick: rt };
  }

  private extrapolate(from: SnapPlayer, fromTick: number, ticks: number): SnapPlayer {
    const c = this.course;
    if (!c || from.dead || ticks <= 0) return from;
    const t = Math.min(ticks, MAX_EXTRAPOLATE_TICKS);
    const s: SnapPlayer = { ...from };
    const whole = Math.floor(t);
    for (let i = 0; i < whole; i++) step(s, s.prev, 0, c, fromTick + i);
    if (s.dead || whole === t) return s;
    const n: SnapPlayer = { ...s };
    step(n, n.prev, 0, c, fromTick + whole);
    if (n.dead) return s;
    const f = t - whole;
    return { ...s, x: s.x + (n.x - s.x) * f, y: s.y + (n.y - s.y) * f };
  }

  forget(oldestTick: number): void {
    while (this.snaps.length > 2 && this.snaps[1].tick < oldestTick) this.snaps.shift();
  }
}
