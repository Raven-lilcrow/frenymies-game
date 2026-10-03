// Inputs from one player, waiting to be applied. Each input moves that player's bean by exactly one tick.
//
// Inputs arrive unevenly (Wi-Fi, timers), so a few are kept in hand (JITTER_TICKS) and applied one per
// tick at a steady pace; otherwise a late input makes the bean pause for a tick and everyone else sees
// it stutter. After a lag spike, inputs arrive in a burst; credits let the server catch up quickly (up
// to MAX_PER_TICK a tick) without letting anyone move faster than 60 ticks a second on average. If
// nothing arrives for a while (frozen tab, dropped Wi-Fi), the bean keeps falling with no buttons
// pressed instead of hanging in the air.

export const JITTER_TICKS = 3; // 50 ms kept in hand
export const CREDIT_CAP = 30; // half a second of catch-up
export const MAX_PER_TICK = 4;
export const STARVE_TICKS = 30; // 500 ms with no input before the bean moves on its own (shorter waits cause corrections on bad Wi-Fi)
export const MAX_QUEUE = 60; // one second; anything older is dropped
export const FREE_STEP = -1; // take() returns buttons = FREE_STEP for a tick the server runs without an input

export interface QueuedInput {
  buttons: number;
  viewTick: number; // server tick the player was looking at (for favor the pusher)
}

export class InputQueue {
  private q: Array<[number, number, number]> = [];
  lastSeq = -1; // newest seq received
  ack = -1; // newest seq applied
  credits = 0;
  starved = 0;
  private primed = false; // false while (re)filling the jitter buffer
  private readonly jitter: number;

  constructor(jitterTicks = JITTER_TICKS) {
    this.jitter = Math.max(1, jitterTicks);
  }
  // counters for /health, to spot connection trouble
  freeSteps = 0;
  dropped = 0;

  push(inputs: Array<[number, number, number]>): void {
    for (const [seq, buttons, viewTick] of inputs) {
      if (seq <= this.lastSeq) continue; // duplicate or out of order
      this.q.push([seq, buttons, viewTick]);
      this.lastSeq = seq;
    }
    if (this.q.length > MAX_QUEUE) this.dropped += this.q.splice(0, this.q.length - MAX_QUEUE).length;
  }

  get length(): number {
    return this.q.length;
  }

  /** Inputs to simulate this tick, oldest first. Usually one; empty while waiting. */
  take(): QueuedInput[] {
    this.credits = Math.min(this.credits + 1, CREDIT_CAP);
    const out: QueuedInput[] = [];
    if (!this.primed && this.q.length >= this.jitter) this.primed = true;
    if (this.primed) {
      // one input a tick; extra ones only while more than the jitter buffer is waiting
      while (this.q.length && this.credits >= 1 && out.length < MAX_PER_TICK && (out.length === 0 || this.q.length > this.jitter)) {
        const [seq, buttons, viewTick] = this.q.shift()!;
        this.ack = seq;
        out.push({ buttons, viewTick });
        this.credits -= 1;
      }
      if (!out.length) this.primed = false; // ran dry: refill before going on
    }
    if (out.length) {
      this.starved = 0;
    } else if (this.lastSeq >= 0 && ++this.starved > STARVE_TICKS) {
      // (a player still loading in, who has never sent an input, just waits at the spawn point)
      this.freeSteps++;
      out.push({ buttons: FREE_STEP, viewTick: -1 }); // does not use credits, so the burst after a stall can still catch up
    }
    return out;
  }
}
