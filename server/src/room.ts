// One game room: up to 4 players playing a match of 3 rounds, helping and hurting each other.
// The room never touches sockets directly; each player has a `send` function, so tests can drive it.
//
// Each bean moves itself with step() (shared with the browser). Everything between two beans happens
// here: shoves, grabs, throws, pull-ups, holding the door, tails, carrying, knockout credit and points.
//
// Match flow: lobby (practice on a Ledge Run, ready up) -> for each of 3 rounds: intro (round card, then
// 3-2-1, nobody moves) -> play -> results -> after the last one, the show (winner, Saint, Traitor) ->
// back to the lobby, where readying up again is the rematch. Rounds 1 and 2 are drawn from the pool, the
// final is always Trust Bridge. Points add up over the whole match.
//
// How a round ends depends on its mode:
//   race      first 3 to finish score 3, 2, 1; ends when they are in (or the timer). Falling = respawn.
//   final     first across wins the crown (+5) and ends it.
//   survival  falling = out for the round. Ends when one is left; the last ones standing score 3, 2, 1.
//   hunt      ends on the timer; whoever holds a tail scores +3.
import {
  BOOST_GAP, BTN, COUNTDOWN_SEC, Course, DIFFICULTIES, FINAL, FINAL_POINTS, FINISH_POINTS, GRAB_IMMUNE, GRAB_RANGE,
  HELP_PAIR_COOLDOWN, HELP_POINTS, HIT_CREDIT, INTENT, INTRO_SEC, KO_POINTS, MAX_PLAYERS, MAX_REWIND_TICKS,
  PLAYER_COLORS, POOL, PUSH_RANGE, PUSH_VX, PUSH_VY, QUALIFY, RESULTS_SEC, ROUNDS_PER_MATCH, SHOVE_STUN, SHOW_SEC,
  SNAPSHOT_EVERY, TAIL_IMMUNE, TAIL_POINTS, THROW_HELP_WINDOW, THROW_STUN, THROW_VX, THROW_VY, TICK_RATE,
  KEYFRAME_EVERY, buildRound, climbUp, dropLedge, newPlayer, packDelta, packFull, packOther, step, ticks, updateWorld,
  type Difficulty, type GameEvent, type Highlight, type Level, type PlayerInfo, type PlayerState, type ResultRow, type RoundInfo,
  type RoundType, type ServerMsg, type WireSnap,
} from '../../packages/shared/src/index.ts';
import { FREE_STEP, InputQueue } from './inputQueue.ts';

export interface Member {
  id: number;
  slot: number;
  name: string;
  color: number;
  state: PlayerState;
  queue: InputQueue;
  ackTick: number; // the tick the newest input was applied at
  points: number; // match totals
  helps: number;
  kos: number;
  tailTicks: number; // this round, how long they held a tail
  send: (msg: ServerMsg) => void;
  sentOwn: number[] | null; // their own bean as last sent (snapshots only send what changed since); null = send it all
  sinceKey: number; // snapshots since the last keyframe
}

/** Where a bean was at a past tick, for judging shoves and grabs by what the pusher saw. */
interface Past {
  x: number;
  y: number;
}

export interface RoomOptions {
  jitterTicks?: number; // input buffer (tests use 1 so inputs apply on the tick they are sent)
  level?: Level; // always play this course, every round and in the lobby (tests)
  rounds?: RoundType[]; // always play these rounds (tests); otherwise 2 from the pool, then the final
  random?: () => number; // seeds, difficulty and round draws
}

const HISTORY_TICKS = MAX_REWIND_TICKS + 5;
let nextId = 1;

export class Room {
  readonly code: string;
  tick = 0;
  readonly members = new Map<number, Member>();
  course: Course;
  round: RoundInfo;
  private history = new Map<number, Map<number, Past>>();
  private events: GameEvent[] = [];
  private sentW = ''; // the course's moving parts and the scores as last sent: only sent again when they change
  private sentScores = '';
  private lastHelp = new Map<string, number>(); // "helper>helped" -> tick
  // who did what to whom, for the results highlights: "kind a b" -> count, this round and this match
  private moments = { round: new Map<string, Highlight>(), match: new Map<string, Highlight>() };
  private holders: PlayerState[][] = []; // per gate: beans standing on one of its buttons (last tick)
  private tailImmune = new Map<number, number>(); // id -> tick until which their tail can't be stolen
  private readonly opts: RoomOptions;
  private readonly rand: () => number;

  constructor(code: string, opts: RoomOptions = {}) {
    this.code = code;
    this.opts = opts;
    this.rand = opts.random ?? Math.random;
    this.round = {
      phase: 'lobby', match: [], index: 0, type: 'ledge', seed: this.newSeed(), diff: 'normal',
      go: 0, end: 0, next: 0, ready: [], finished: [], out: [], results: null,
    };
    this.course = new Course(this.build());
  }

  get size(): number {
    return this.members.size;
  }

  get level(): Level {
    return this.course.level;
  }

  get mode() {
    return this.level.mode;
  }

  /** The course for the current round (or the lobby), from the round info. */
  private build(): Level {
    const r = this.round;
    return this.opts.level ?? buildRound(r.type, r.seed, r.diff, r.index); // the lobby is always index 0
  }

  join(name: string, send: (msg: ServerMsg) => void): Member | null {
    if (this.members.size >= MAX_PLAYERS) return null;
    const used = new Set([...this.members.values()].map((m) => m.slot));
    let slot = 0;
    while (used.has(slot)) slot++;
    const m: Member = {
      id: nextId++, slot, name, color: PLAYER_COLORS[slot], state: newPlayer(this.level, slot),
      queue: new InputQueue(this.opts.jitterTicks), ackTick: this.tick, points: 0, helps: 0, kos: 0, tailTicks: 0, send, sentOwn: null, sinceKey: 0,
    };
    // joining in the middle of a survival round: watch until the next one
    if (this.mode === 'survival' && this.round.phase === 'play') Object.assign(m.state, { dead: true, out: true });
    this.members.set(m.id, m);
    send({ t: 'welcome', id: m.id, slot, room: this.code, tick: this.tick });
    send({ t: 'round', ...this.round });
    this.broadcastRoster();
    return m;
  }

  leave(id: number): void {
    const m = this.members.get(id);
    if (!m) return;
    this.release(m.state);
    for (const o of this.members.values()) {
      if (o.state.lastHitBy === id) o.state.lastHitBy = 0;
      if (o.state.thrownBy === id) o.state.thrownBy = 0;
    }
    if (m.state.tail) this.dropTail(m);
    this.members.delete(id);
    this.broadcastRoster();
    if (this.round.ready.includes(id)) this.setReady(id, false);
    else if (this.round.phase === 'lobby') this.maybeStart();
  }

  input(id: number, inputs: Array<[number, number, number]>): void {
    this.members.get(id)?.queue.push(inputs);
  }

  /** Lobby only: ready up (or not). The match starts once everyone in the room is ready. */
  setReady(id: number, on: boolean): void {
    if (this.round.phase !== 'lobby') return;
    const ready = this.round.ready.filter((r) => r !== id && this.members.has(r));
    if (on && this.members.has(id)) ready.push(id);
    this.round.ready = ready;
    this.broadcastRound();
    this.maybeStart();
  }

  private maybeStart(): void {
    if (this.members.size > 0 && [...this.members.keys()].every((id) => this.round.ready.includes(id))) this.startMatch();
  }

  /** Roll the match: difficulty, 2 rounds from the pool and the final. Points start from 0. */
  startMatch(): void {
    const diff: Difficulty = this.opts.level ? this.opts.level.difficulty : DIFFICULTIES[Math.floor(this.rand() * DIFFICULTIES.length)];
    const pool = [...POOL];
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(this.rand() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    const match = this.opts.rounds ?? [...pool.slice(0, ROUNDS_PER_MATCH - 1), FINAL];
    this.round = { ...this.round, match, diff, seed: this.newSeed(), ready: [], results: null };
    for (const m of this.members.values()) { m.points = 0; m.helps = 0; m.kos = 0; }
    this.lastHelp.clear();
    this.moments.match.clear();
    this.startRound(0);
  }

  /** Build round `index` of the match, put everyone at the start and begin its intro. */
  private startRound(index: number): void {
    const r = this.round;
    const go = this.tick + ticks(INTRO_SEC + COUNTDOWN_SEC);
    this.round = {
      ...r, phase: 'intro', index, type: r.match[index], seed: (r.seed + index * 7919) >>> 0,
      go, end: 0, next: 0, finished: [], out: [], results: null,
    };
    this.course = new Course(this.build());
    this.round.end = go + this.level.timerTicks;
    this.course.world.lock = go;
    for (const m of this.members.values()) { m.state = newPlayer(this.level, m.slot); m.tailTicks = 0; }
    this.tailImmune.clear();
    this.moments.round.clear();
    if (this.mode === 'hunt') this.handOutTails();
    this.history.clear();
    this.broadcastRound();
  }

  update(): void {
    const t = this.tick;
    this.advancePhase(t);
    const gates = this.level.gates;
    for (const m of this.members.values()) {
      const s = m.state;
      const startX = s.x;
      for (const inp of m.queue.take()) {
        // A free step lets go of moving but keeps jump and dive held, so the next real input
        // is not mistaken for a fresh press.
        const buttons = inp.buttons === FREE_STEP ? s.prev & (BTN.jump | BTN.dive) : inp.buttons;
        if (inp.buttons !== FREE_STEP) m.ackTick = t;
        const carrying = s.holding;
        const intent = step(s, buttons, m.slot, this.course, t);
        if (intent & INTENT.push) this.shove(m, inp.viewTick);
        if (intent & INTENT.grab) this.grab(m, inp.viewTick);
        if (intent & INTENT.throw) this.throwHeld(m, carrying);
        if (intent & INTENT.climbed) this.emit('climb', m.id, 0, s.x, s.y);
        if (intent & INTENT.hit) { this.release(s); this.emit('bonk', m.id, 0, s.x, s.y); }
        if (intent & INTENT.finished) this.finish(m);
        if (intent & INTENT.died) this.died(m, carrying);
      }
      gates.forEach((g, i) => { if (startX < g.x && s.x >= g.x && !s.dead) this.passedGate(m, i); });
      if (s.tail && this.round.phase === 'play') m.tailTicks++;
    }
    this.carry();
    this.checkThrows();
    this.holders = updateWorld(this.course, [...this.members.values()].map((m) => m.state), t);
    this.catchUp();
    this.tick++;
    this.record();
    if (this.tick % SNAPSHOT_EVERY === 0) this.sendSnapshots();
  }

  // ---------- round flow ----------

  private advancePhase(t: number): void {
    const r = this.round;
    if (r.phase === 'intro' && t >= r.go) {
      r.phase = 'play';
      this.course.world.racing = this.mode === 'race' || this.mode === 'final';
      this.broadcastRound();
    } else if (r.phase === 'play') {
      if (t >= r.end || this.roundOver()) this.endRound(t);
    } else if (r.phase === 'results' && t >= r.next) {
      if (r.index + 1 < r.match.length) this.startRound(r.index + 1);
      else this.show(t);
    } else if (r.phase === 'show' && t >= r.next) {
      this.backToLobby();
    }
  }

  private roundOver(): boolean {
    const r = this.round;
    const n = this.members.size;
    if (n === 0) return false;
    switch (this.mode) {
      case 'race': return r.finished.filter((id) => this.members.has(id)).length >= Math.min(QUALIFY, n);
      case 'final': return r.finished.length > 0;
      case 'survival': {
        const left = [...this.members.values()].filter((m) => !m.state.out).length;
        return n >= 2 ? left <= 1 : left === 0;
      }
      case 'hunt': return false;
    }
  }

  private finish(m: Member): void {
    this.release(m.state);
    const r = this.round;
    r.finished.push(m.id);
    const place = r.finished.length;
    const pts = this.mode === 'final' ? (place === 1 ? FINAL_POINTS : 0) : FINISH_POINTS[place - 1] ?? 0;
    m.points += pts;
    this.emit('finish', m.id, 0, m.state.x, m.state.y, pts, place);
    this.broadcastRound();
  }

  /** Places and points for this round. Races already scored at the finish line. */
  private placesNow(): Map<number, { place: number; pts: number }> {
    const r = this.round;
    const out = new Map<number, { place: number; pts: number }>();
    const ms = [...this.members.values()];
    if (this.mode === 'race' || this.mode === 'final') {
      r.finished.forEach((id, k) => out.set(id, { place: k + 1, pts: this.mode === 'final' ? (k ? 0 : FINAL_POINTS) : FINISH_POINTS[k] ?? 0 }));
    } else if (this.mode === 'survival') {
      // everyone still standing shares 1st; then the last ones out
      const standing = ms.filter((m) => !m.state.out);
      for (const m of standing) out.set(m.id, { place: 1, pts: FINISH_POINTS[0] });
      let place = standing.length + 1;
      for (const id of [...r.out].reverse()) {
        if (!this.members.has(id)) continue;
        out.set(id, { place, pts: FINISH_POINTS[place - 1] ?? 0 });
        place++;
      }
    } else {
      // hunt: tail holders share 1st, the rest by how long they held one
      const order = ms.filter((m) => !m.state.tail).sort((a, b) => b.tailTicks - a.tailTicks);
      const holders = ms.filter((m) => m.state.tail);
      for (const m of holders) out.set(m.id, { place: 1, pts: TAIL_POINTS });
      order.forEach((m, k) => out.set(m.id, { place: holders.length + k + 1, pts: 0 }));
    }
    return out;
  }

  private endRound(t: number): void {
    const r = this.round;
    const places = this.placesNow();
    // races scored as they finished; survival and hunt score now
    if (this.mode === 'survival' || this.mode === 'hunt') {
      for (const [id, p] of places) this.members.get(id)!.points += p.pts;
    }
    r.phase = 'results';
    r.next = t + ticks(RESULTS_SEC);
    this.course.world.racing = false;
    this.course.world.lock = r.next; // everyone still out there stops where they are
    r.results = this.table(places, this.moments.round);
    for (const m of this.members.values()) m.state.boost = false;
    this.broadcastRound();
  }

  /** The end of the match: the winner, the Saint and the Traitor. */
  private show(t: number): void {
    const r = this.round;
    r.phase = 'show';
    r.next = t + ticks(SHOW_SEC);
    r.results = this.table(new Map(), this.moments.match);
    this.broadcastRound();
  }

  private table(places: Map<number, { place: number; pts: number }>, moments: Map<string, Highlight>) {
    const rows: ResultRow[] = [...this.members.values()].map((m) => {
      const p = places.get(m.id);
      return { id: m.id, place: p?.place ?? 0, roundPts: p?.pts ?? 0, points: m.points, helps: m.helps, kos: m.kos };
    });
    rows.sort((a, b) => b.points - a.points || (a.place || 99) - (b.place || 99));
    const top = (key: 'helps' | 'kos' | 'points') => {
      const best = Math.max(0, ...rows.map((row) => row[key]));
      return best > 0 ? rows.filter((row) => row[key] === best).map((row) => row.id) : [];
    };
    return { rows, saints: top('helps'), traitors: top('kos'), winners: top('points'), highlights: highlights(moments) };
  }

  private backToLobby(): void {
    this.round = {
      ...this.round, phase: 'lobby', type: 'ledge', index: 0, seed: this.newSeed(), diff: 'normal',
      ready: [], finished: [], out: [], go: 0, end: 0, next: 0,
    };
    this.course = new Course(this.build());
    for (const m of this.members.values()) m.state = newPlayer(this.level, m.slot);
    this.history.clear();
    this.broadcastRound();
  }

  /** Catch-up boost (anti-griefing): in races, last place runs a little faster when far behind the leader. */
  private catchUp(): void {
    const ms = [...this.members.values()];
    for (const m of ms) m.state.boost = false;
    if (this.round.phase !== 'play' || ms.length < 2 || (this.mode !== 'race' && this.mode !== 'final')) return;
    const progress = (m: Member) => {
      if (m.state.finished) return this.level.finishX;
      if (m.state.dead) return this.level.checkpoints[m.state.cp].sx;
      return m.state.x;
    };
    const lead = Math.max(...ms.map(progress));
    let last: Member | null = null;
    for (const m of ms) if (!m.state.finished && (!last || progress(m) < progress(last))) last = m;
    if (last && lead - progress(last) > BOOST_GAP) last.state.boost = true;
  }

  private newSeed(): number {
    return Math.floor(this.rand() * 2 ** 31);
  }

  // ---------- tails (hunt) ----------

  /** Hand out tails at the start: 2 for 4 players, otherwise 1. */
  private handOutTails(): void {
    const ms = [...this.members.values()];
    const n = ms.length >= 4 ? this.level.tails : 1;
    for (let i = ms.length - 1; i > 0; i--) {
      const j = Math.floor(this.rand() * (i + 1));
      [ms[i], ms[j]] = [ms[j], ms[i]];
    }
    for (const m of ms.slice(0, n)) m.state.tail = true;
  }

  /** Someone with a tail left the room: give it to a bean without one, so the round keeps its tails. */
  private dropTail(m: Member): void {
    m.state.tail = false;
    const next = [...this.members.values()].find((o) => o !== m && !o.state.tail);
    if (next) next.state.tail = true;
  }

  private moveTail(from: Member, to: Member): void {
    from.state.tail = false;
    to.state.tail = true;
    this.tailImmune.set(to.id, this.tick + ticks(TAIL_IMMUNE));
  }

  // ---------- help and hurt ----------

  /** Someone went through a gate while another bean held its button: that is a help ("hold the door"). */
  private passedGate(m: Member, gate: number): void {
    if (this.course.gateAuto(gate, this.tick)) return; // it was open by itself
    const holder = [...this.members.values()].find((o) => o !== m && this.holders[gate]?.includes(o.state));
    if (!holder) return;
    const pts = this.help(holder, m);
    this.emit('door', holder.id, m.id, m.state.x, m.state.y, pts);
  }

  /** The bean right in front of `m`, judged by where the others were at `viewTick` on m's screen. */
  private inFront(m: Member, range: number, viewTick: number): Member | null {
    const me = m.state;
    const vt = Math.max(this.tick - MAX_REWIND_TICKS, Math.min(this.tick, viewTick));
    const past = vt < this.tick ? this.history.get(vt) : undefined; // seeing the present: no rewind
    let best: Member | null = null;
    let bestDx = Infinity;
    for (const o of this.members.values()) {
      if (o === m || o.state.dead || o.state.heldBy || o.state.finished) continue;
      const pos = past?.get(o.id) ?? o.state;
      const dx = (pos.x - me.x) * me.facing;
      const dy = pos.y - me.y;
      if (dx < -8 || dx > range || Math.abs(dy) > 60) continue;
      if (dx < bestDx) { bestDx = dx; best = o; }
    }
    return best;
  }

  private shove(m: Member, viewTick: number): void {
    const t = this.inFront(m, PUSH_RANGE, viewTick);
    if (!t || t.state.protect > 0) return;
    const me = m.state, s = t.state;
    if (s.hanging) {
      dropLedge(s, me.facing * 120, 150);
      this.credit(s, m.id);
      this.emit('shoveOff', m.id, t.id, s.x, s.y);
      return;
    }
    this.release(s); // shoving a carrier makes them drop what they hold
    s.diving = false;
    s.vx = me.facing * PUSH_VX;
    s.vy = -PUSH_VY;
    s.grounded = false;
    s.plat = -1;
    s.stun = SHOVE_STUN;
    s.airJumps = 0; // getting hit knocks the double jump out of you, so shoves still matter
    this.credit(s, m.id);
    this.emit('shove', m.id, t.id, s.x, s.y);
  }

  private grab(m: Member, viewTick: number): void {
    const t = this.inFront(m, GRAB_RANGE, viewTick);
    if (!t) return;
    const s = t.state;
    if (s.hanging) {
      // pull them up: the main help move
      climbUp(s, this.course.layout(this.tick, 2)[s.hangPlat]);
      s.lastHitBy = 0;
      s.hitCredit = 0;
      const pts = this.help(m, t);
      this.emit('save', m.id, t.id, s.x, s.y, pts);
      return;
    }
    if (this.mode === 'hunt' && this.round.phase === 'play' && s.protect <= 0 && s.tail !== m.state.tail) {
      if (s.tail) {
        // steal it
        if ((this.tailImmune.get(t.id) ?? 0) > this.tick) return;
        this.moveTail(t, m);
        this.emit('steal', m.id, t.id, s.x, s.y);
      } else {
        // pass yours on: a help (they might win with it)
        this.moveTail(m, t);
        const pts = this.help(m, t);
        this.emit('pass', m.id, t.id, s.x, s.y, pts);
      }
      return;
    }
    if (s.protect > 0 || s.grabImmune > 0 || s.holding || s.heldBy || m.state.heldBy) return;
    m.state.holding = t.id;
    m.state.holdT = 0;
    s.heldBy = m.id;
    s.diving = false;
    s.vx = 0; s.vy = 0;
    this.credit(s, m.id); // carrying someone into the pit still counts as your knockout
    this.emit('grab', m.id, t.id, s.x, s.y);
  }

  private throwHeld(m: Member, heldId: number): void {
    const t = this.members.get(heldId);
    if (!t || t.state.heldBy !== m.id) return;
    const me = m.state, s = t.state;
    s.heldBy = 0;
    s.vx = me.facing * THROW_VX + me.vx * 0.3;
    s.vy = -THROW_VY;
    s.grounded = false;
    s.plat = -1;
    s.stun = THROW_STUN;
    s.airJumps = 0;
    s.grabImmune = GRAB_IMMUNE;
    this.credit(s, m.id);
    // if this lands them somewhere better, it was a help (see checkThrows)
    s.thrownBy = m.id;
    s.thrownT = THROW_HELP_WINDOW;
    s.thrownX = s.x;
    s.thrownPlat = me.plat;
    this.emit('throw', m.id, t.id, s.x, s.y);
  }

  /** Drop whoever this bean carries, and free it if it is being carried. */
  private release(s: PlayerState): void {
    if (s.holding) {
      const t = this.members.get(s.holding);
      if (t && t.state.heldBy) {
        t.state.heldBy = 0;
        t.state.vx = 0; t.state.vy = 0;
        t.state.grabImmune = GRAB_IMMUNE;
      }
      s.holding = 0;
    }
    if (s.heldBy) {
      const h = this.members.get(s.heldBy);
      if (h) h.state.holding = 0;
      s.heldBy = 0;
      s.grabImmune = GRAB_IMMUNE;
    }
  }

  private credit(s: PlayerState, by: number): void {
    s.lastHitBy = by;
    s.hitCredit = HIT_CREDIT;
  }

  private died(m: Member, carrying: number): void {
    const s = m.state;
    s.holding = carrying; // step() already let go; restore it so release() frees the carried bean
    this.release(s);
    s.thrownT = 0;
    const killer = s.lastHitBy ? this.members.get(s.lastHitBy) : undefined;
    s.lastHitBy = 0;
    s.hitCredit = 0;
    if (killer && killer !== m) {
      killer.points += KO_POINTS;
      killer.kos += 1;
      this.emit('ko', killer.id, m.id, s.x, s.y, KO_POINTS);
      // knocked off with a tail: the one who did it takes it
      if (s.tail && !killer.state.tail && this.mode === 'hunt') this.moveTail(m, killer);
    } else {
      this.emit('fall', m.id, 0, s.x, s.y);
    }
    if (this.mode === 'survival' && this.round.phase === 'play') {
      s.out = true;
      this.round.out.push(m.id);
      this.emit('out', m.id, 0, s.x, s.y);
      this.broadcastRound();
    }
  }

  /** Award a help, unless the same helper already helped the same person very recently. */
  private help(helper: Member, helped: Member): number {
    const key = `${helper.id}>${helped.id}`;
    const last = this.lastHelp.get(key);
    if (last !== undefined && this.tick - last < HELP_PAIR_COOLDOWN * TICK_RATE) return 0;
    this.lastHelp.set(key, this.tick);
    helper.points += HELP_POINTS;
    helper.helps += 1;
    return HELP_POINTS;
  }

  /** Carried beans ride in front of their carrier. */
  private carry(): void {
    for (const m of this.members.values()) {
      const s = m.state;
      if (!s.holding) continue;
      const t = this.members.get(s.holding);
      if (!t || t.state.heldBy !== m.id) { s.holding = 0; continue; }
      t.state.x = s.x + s.facing * 34;
      t.state.y = s.y - 12;
      t.state.facing = -s.facing;
      t.state.grounded = false;
      t.state.plat = -1;
    }
  }

  /**
   * A throw that lands you on a different platform counts as a help: in races only further toward the
   * finish; in the arenas anywhere at least a little away, as long as it is not about to drop.
   */
  private checkThrows(): void {
    const race = this.mode === 'race' || this.mode === 'final';
    for (const t of this.members.values()) {
      const s = t.state;
      if (!s.thrownBy || s.thrownT <= 0) { s.thrownBy = 0; continue; }
      if (!s.grounded || s.plat === s.thrownPlat) continue;
      const dx = s.x - s.thrownX;
      if (race ? dx < 60 : Math.abs(dx) < 60) continue;
      if (!race && this.course.layout(this.tick, 2)[s.plat].shake > 0) continue; // a shaking tile is no favor
      const thrower = this.members.get(s.thrownBy);
      s.thrownBy = 0;
      s.thrownT = 0;
      if (!thrower) continue;
      s.lastHitBy = 0; // landed safely: a fall later is not the thrower's knockout
      s.hitCredit = 0;
      const pts = this.help(thrower, t);
      this.emit('help', thrower.id, t.id, s.x, s.y, pts);
    }
  }

  private emit(k: GameEvent['k'], a: number, b: number, x: number, y: number, pts?: number, place?: number): void {
    const e: GameEvent = { k, tick: this.tick, a, b, x: Math.round(x), y: Math.round(y) };
    if (pts !== undefined) e.pts = pts;
    if (place !== undefined) e.place = place;
    this.events.push(e);
    // remember the moments that scored (a help that counted, a knockout) and tail steals, for the highlights
    if (this.round.phase === 'play' && b && (k === 'ko' || k === 'steal' || (HELP_KINDS.has(k) && pts))) {
      for (const book of [this.moments.round, this.moments.match]) {
        const key = `${k} ${a} ${b}`;
        const h = book.get(key) ?? { k: k as Highlight['k'], a, b, n: 0 };
        h.n++;
        book.set(key, h);
      }
    }
  }

  // ---------- history and messages ----------

  private record(): void {
    const now = new Map<number, Past>();
    for (const m of this.members.values()) now.set(m.id, { x: m.state.x, y: m.state.y });
    this.history.set(this.tick, now);
    this.history.delete(this.tick - HISTORY_TICKS);
  }

  /** Snapshots, slimmed for the wire (see snapcodec.ts): what changed, with a full copy now and then. */
  private sendSnapshots(): void {
    const ms = [...this.members.values()];
    const others = new Map(ms.map((m) => [m.id, packOther(m.id, m.state)]));
    const ev = this.events.length ? this.events : undefined;
    this.events = [];
    const w = this.course.world;
    const wKey = JSON.stringify(w);
    const sc = ms.flatMap((m) => [m.id, m.points, m.helps, m.kos]);
    const scKey = sc.join();
    const wChanged = wKey !== this.sentW;
    const scChanged = scKey !== this.sentScores;
    this.sentW = wKey;
    this.sentScores = scKey;
    for (const m of ms) {
      const own = packFull(m.state);
      const key = !m.sentOwn || ++m.sinceKey >= KEYFRAME_EVERY;
      if (key) m.sinceKey = 0;
      const msg: WireSnap = {
        t: 'snap', tick: this.tick, ack: m.queue.ack, at: m.ackTick,
        o: ms.filter((x) => x !== m).map((x) => others.get(x.id)!),
      };
      if (key) msg.me = own;
      else msg.md = packDelta(m.sentOwn!, own);
      m.sentOwn = own;
      if (ev) msg.ev = ev;
      if (key || wChanged) msg.w = w;
      if (key || scChanged) msg.sc = sc;
      m.send(msg);
    }
  }

  private broadcastRound(): void {
    for (const m of this.members.values()) m.send({ t: 'round', ...this.round });
  }

  private broadcastRoster(): void {
    const players: PlayerInfo[] = [...this.members.values()].map(({ id, slot, name, color }) => ({ id, slot, name, color }));
    for (const m of this.members.values()) m.send({ t: 'roster', players });
  }
}

const HELP_KINDS = new Set<GameEvent['k']>(['save', 'door', 'pass', 'help']);

/** The biggest help and the biggest hurt between two players (most times; ties go to whichever came first). */
export function highlights(moments: Map<string, Highlight>): Highlight[] {
  const best = (hurt: boolean) => {
    let top: Highlight | null = null;
    for (const h of moments.values()) if ((h.k === 'ko' || h.k === 'steal') === hurt && (!top || h.n > top.n)) top = h;
    return top;
  };
  return [best(false), best(true)].filter((h): h is Highlight => h !== null).map((h) => ({ ...h }));
}
