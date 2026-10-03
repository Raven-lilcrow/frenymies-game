// Client prediction for your own bean.
// Every tick we apply your input locally right away (no waiting for the server) and remember it.
// When a snapshot arrives, we take the server's version of your bean, drop the inputs it has
// already applied, and replay the rest on top. If that lands somewhere slightly different from
// what you saw, the difference is faded out over a few frames instead of snapping.
//
// Obstacles move, so each input has to be simulated at the same tick the server will apply it at.
// The server tells us which tick it applied our newest input at (`at`); from that we know the gap
// between our input numbers and its ticks, and use it for every input after.
import { Course, clonePlayer, cloneWorld, newPlayer, step, type PlayerState, type WorldState } from '../../packages/shared/src/index.ts';

// Bigger corrections (respawns, long freezes) snap straight there. Being shoved or thrown can move you a
// couple of hundred pixels from where you predicted, and that slides quickly instead of teleporting.
const SNAP_DISTANCE = 400;

export class Predictor {
  state: PlayerState;
  prevX: number;
  prevY: number;
  seq = -1;
  offset: number; // server tick = input seq + offset
  corrections = 0;
  lastErrorPx = 0;
  /** Visual offset still being faded out. */
  errX = 0;
  errY = 0;
  serverState: PlayerState | null = null;
  course: Course; // our own copy: the server's obstacles, plus the platforms our own bean has stepped on
  readonly slot: number;
  private pending: Array<{ seq: number; buttons: number }> = [];

  constructor(slot: number, course: Course, serverTick: number) {
    this.slot = slot;
    this.course = course;
    this.offset = serverTick + 4;
    this.state = newPlayer(course.level, slot);
    this.prevX = this.state.x;
    this.prevY = this.state.y;
  }

  get pendingCount(): number {
    return this.pending.length;
  }

  /** The tick of the newest predicted step. Obstacles are drawn here, so they match your bean. */
  get simTick(): number {
    return this.seq + this.offset;
  }

  /** A new course (new match): start over on it. The next snapshot puts the bean where the server has it. */
  /**
   * A new round (or back to the lobby): new course, and a fresh bean at its start, like the server does.
   * The old state must not carry over: its platform numbers belong to the old course, and stepping them on
   * a course with fewer platforms crashed (Ledge Run's platform 25 does not exist in Hot Plate).
   */
  setCourse(course: Course): void {
    this.course = course;
    this.state = newPlayer(course.level, this.slot);
    this.prevX = this.state.x;
    this.prevY = this.state.y;
    this.errX = 0; // a correction still fading out belongs to the old course
    this.errY = 0;
  }

  /** Apply one tick of input locally. Returns the seq to send, and what you tried (INTENT bits). */
  tick(buttons: number): { seq: number; intent: number } {
    this.seq++;
    this.prevX = this.state.x;
    this.prevY = this.state.y;
    this.pending.push({ seq: this.seq, buttons });
    if (this.pending.length > 240) this.pending.shift(); // 4 s with no answer: the server will snap us anyway
    const intent = step(this.state, buttons, this.slot, this.course, this.seq + this.offset);
    return { seq: this.seq, intent };
  }

  reconcile(server: PlayerState, ack: number, at: number, world: WorldState): void {
    this.serverState = server;
    if (ack >= 0) this.offset = at - ack;
    this.course.world = cloneWorld(world);
    while (this.pending.length && this.pending[0].seq <= ack) this.pending.shift();
    const oldX = this.state.x, oldY = this.state.y, wasDead = this.state.dead;
    const s = clonePlayer(server);
    for (const p of this.pending) step(s, p.buttons, this.slot, this.course, p.seq + this.offset);
    this.state = s;
    const dx = oldX - s.x, dy = oldY - s.y;
    const d = Math.hypot(dx, dy);
    this.lastErrorPx = d;
    if (d < 0.01) return;
    if (!s.heldBy) this.corrections++; // while carried, the bean is drawn on the carrier anyway
    if (d > SNAP_DISTANCE || wasDead !== s.dead) {
      this.errX = 0; this.errY = 0;
      this.prevX = s.x; this.prevY = s.y;
    } else {
      this.errX += dx; this.errY += dy;
      this.prevX -= dx; this.prevY -= dy; // keep the in-between frame on the corrected path
    }
  }

  /** Where to draw the bean: between the last two ticks, plus any correction still fading. */
  renderPos(alpha: number, dtSec: number): { x: number; y: number } {
    const fade = Math.exp(-14 * dtSec);
    this.errX *= fade;
    this.errY *= fade;
    return {
      x: this.prevX + (this.state.x - this.prevX) * alpha + this.errX,
      y: this.prevY + (this.state.y - this.prevY) * alpha + this.errY,
    };
  }
}
