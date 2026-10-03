// Frenymies online client: online movement (milestone 2), the help-or-hurt twist (milestone 3), Ledge Run
// with its obstacles (milestone 4), and full 3-round matches with all 5 rounds (milestone 5).
// Your bean is predicted locally (instant controls); everyone else is drawn from server snapshots,
// slightly in the past so they move smoothly. Keys: A/D or arrows move, W/Space/Up jump (press
// again in the air to double jump; mash it to climb a ledge), Shift dive, F shove, E grab (hold,
// let go to throw; grab someone hanging to pull them up), R ready. L cycles the lag simulator,
// G shows where the server has your bean, C copies the invite link.
import Phaser from 'phaser';
import {
  BTN, Course, DIFFICULTY, DT, FINAL_POINTS, FINISH_POINTS, HALF_H, HALF_W, HANG_TIME, INTENT, MAX_INPUTS_PER_MESSAGE, ROOM_CODE,
  ROUND_TEXT, SECTION_NAMES, SnapDecoder, TAIL_IMMUNE, TICK_RATE, WORLD_H, buildRound, cloneWorld, onButton, type Box, type GameEvent,
  type Highlight, type PlayerInfo,
  type PlayerState, type RoundInfo, type ServerMsg, type SnapPlayer,
} from '../../packages/shared/src/index.ts';
import { Interpolator } from './interp.ts';
import { LAG_PRESETS, Net } from './net.ts';
import { Predictor } from './predict.ts';
import { Sound, type Sfx } from './audio.ts';

/** All the sound in the game (see audio.ts). */
const sound = new Sound();
// browsers only allow sound after a click or a key press
window.addEventListener('keydown', () => sound.unlock());
window.addEventListener('pointerdown', () => sound.unlock());

const FONT = 'Segoe UI, Inter, system-ui, sans-serif';
const COL = {
  bg: 0x1f2229, plat: 0x3a3f4b, platTop: 0x5a6172, moving: 0x6b7385, falling: 0x8a7350, belt: 0x2c3039,
  gate: 0xc98a4b, button: 0x8a6440, buttonOn: 0xe0a860, hazard: 0xd4574a, arm: 0x8b93a3, wind: 0xe9e9e9,
  pad: 0x7c6cf0, flag: 0xe9e9e9, panel: 0x15171c, plank: 0x9a8466, tail: 0xf2c14e,
  text: '#e9e9e9', dim: '#8b93a3', bad: '#ff7a6b', good: '#7fd48a', gold: '#f2c14e',
};
const hex = (n: number) => '#' + n.toString(16).padStart(6, '0');
const ordinal = (n: number) => `${n}${n % 10 === 1 && n % 100 !== 11 ? 'st' : n % 10 === 2 && n % 100 !== 12 ? 'nd' : n % 10 === 3 && n % 100 !== 13 ? 'rd' : 'th'}`;

const params = new URLSearchParams(location.search);
// By default the game connects through the same address the page came from (/ws is passed on to the
// game server), so it works on your own laptop and through a shared tunnel link alike.
const SERVER_URL =
  params.get('server') ?? import.meta.env.VITE_SERVER_URL ?? `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;

type Welcome = Extract<ServerMsg, { t: 'welcome' }>;

/** The course a round message describes (built exactly like the server builds it). */
const courseFor = (r: RoundInfo) => buildRound(r.type, r.seed, r.diff, r.index);
const courseKey = (r: RoundInfo) => `${r.type} ${r.seed} ${r.diff} ${r.index}`;
/** Which sound goes with which event (shown for everyone, louder if it is about you). */
/** Round music gets faster and busier with the difficulty and the round number. */
const DIFF_INTENSITY = { easy: 0, normal: 1, hard: 2 } as const;

const EVENT_SOUND: Partial<Record<GameEvent['k'], Sfx>> = {
  shove: 'shove', shoveOff: 'shove', grab: 'grab', throw: 'throw', save: 'help', help: 'help', door: 'help', pass: 'help',
  ko: 'ko', fall: 'fall', climb: 'climb', bonk: 'bonk', out: 'out', steal: 'steal', finish: 'finish',
};

/** A results highlight in words: "Ava pulled Bo up 3 times", "You knocked out Cy twice". */
function moment(m: Highlight, nameOf: (id: number) => string, me: number, arena: boolean): { text: string; good: boolean } {
  const a = m.a === me ? 'You' : nameOf(m.a);
  const b = m.b === me ? 'you' : nameOf(m.b);
  const times = m.n === 1 ? 'once' : m.n === 2 ? 'twice' : `${m.n} times`;
  const what = {
    save: `pulled ${b} up`, door: `held the door for ${b}`, pass: `passed ${b} a tail`, help: `threw ${b} ${arena ? 'to safety' : 'across a gap'}`,
    ko: `knocked out ${b}`, steal: `stole ${m.b === me ? 'your' : `${b}'s`} tail`,
  }[m.k];
  return { text: `${a} ${what} ${times}`, good: m.k !== 'ko' && m.k !== 'steal' };
}

const clock = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;

// ---------- session: one connection to one room ----------

class Session {
  roster = new Map<number, PlayerInfo>();
  predictor: Predictor;
  interp = new Interpolator();
  lagIndex = 0;
  disconnected = '';
  scores = new Map<number, { points: number; helps: number; kos: number }>();
  events: GameEvent[] = []; // waiting to be shown (see PlayScene.showEvents)
  round: RoundInfo;
  courseVersion = 0; // goes up when a new course is built, so the scene redraws it
  readonly net: Net;
  readonly myId: number;
  readonly room: string;
  private readonly decoder: SnapDecoder;
  private outbox: Array<[number, number, number]> = [];

  constructor(net: Net, w: Welcome, round: RoundInfo) {
    this.net = net;
    this.myId = w.id;
    this.decoder = new SnapDecoder(w.id);
    this.room = w.room;
    this.round = round;
    const level = courseFor(round);
    this.predictor = new Predictor(w.slot, new Course(level), w.tick);
    this.interp.course = new Course(level);
    net.onMessage = (m) => this.handle(m);
    net.onClose = (reason) => { this.disconnected = reason; };
  }

  get course(): Course {
    return this.predictor.course;
  }

  get ready(): boolean {
    return this.round.ready.includes(this.myId);
  }

  handle(msg: ServerMsg): void {
    if (msg.t === 'roster') {
      this.roster = new Map(msg.players.map((p) => [p.id, p]));
    } else if (msg.t === 'round') {
      const { t: _t, ...round } = msg;
      if (courseKey(round) !== courseKey(this.round)) {
        const level = courseFor(round);
        this.predictor.setCourse(new Course(level));
        this.interp.course = new Course(level);
        this.courseVersion++;
      }
      this.round = round;
    } else if (msg.t === 'snap') {
      const snap = this.decoder.decode(msg);
      if (!snap) return; // just joined: waiting for the first full snapshot (at most a second)
      if (this.interp.course) this.interp.course.world = cloneWorld(snap.w);
      this.interp.push(snap.tick, snap.players, performance.now());
      const mine = snap.players.find((p) => p.id === this.myId);
      if (mine) this.predictor.reconcile(mine, snap.ack, snap.at, snap.w);
      for (const p of snap.players) this.scores.set(p.id, { points: p.points, helps: p.helps, kos: p.kos });
      this.events.push(...snap.events);
    } else if (msg.t === 'error') {
      this.disconnected = msg.message;
    }
  }

  /** One tick of your input: predict it now, send it soon (batched two ticks per message). */
  tick(buttons: number): number {
    const { seq, intent } = this.predictor.tick(buttons);
    // the tick the other beans are drawn at right now, so the server judges your shove by what you saw
    const viewTick = Math.max(0, Math.round(this.interp.renderTick(performance.now())));
    this.outbox.push([seq, buttons, viewTick]);
    if (this.outbox.length >= 2) this.flush();
    return intent;
  }

  flush(): void {
    while (this.outbox.length) this.net.send({ t: 'input', i: this.outbox.splice(0, MAX_INPUTS_PER_MESSAGE) });
  }

  toggleReady(): void {
    if (this.round.phase === 'lobby') this.net.send({ t: 'ready', on: !this.ready });
  }

  cycleLag(): void {
    this.lagIndex = (this.lagIndex + 1) % LAG_PRESETS.length;
    this.net.lag = { ...LAG_PRESETS[this.lagIndex] };
  }

  /** Seconds until a server tick (for the countdown and the timer). */
  secondsUntil(tick: number): number {
    return (tick - this.interp.serverTick(performance.now())) / TICK_RATE;
  }
}

// ---------- the game scene ----------

interface BeanView {
  view: Phaser.GameObjects.Image;
  label: Phaser.GameObjects.Text;
  bar: Phaser.GameObjects.Rectangle; // ledge timer: how long until they let go
  tail: Phaser.GameObjects.Rectangle; // Tail Tag
  tailSafe: number; // until when (performance.now) the tail can't be stolen: it blinks
  x: number; // where it was drawn this frame
  y: number;
  // other players only: last drawn spot, and a jump in their path still being faded out
  drawnX: number | null;
  drawnY: number;
  errX: number;
  errY: number;
  sx: number; // squash and stretch, springs back to 1
  sy: number;
  grounded: boolean;
  vy: number;
  rot: number;
}

/** Drawn pieces of a solid that moves or changes. */
interface SolidView {
  i: number;
  body: Phaser.GameObjects.Rectangle;
  top: Phaser.GameObjects.Rectangle;
}

class PlayScene extends Phaser.Scene {
  session!: Session;
  beans = new Map<number, BeanView>();
  acc = 0;
  forcedButtons: number | null = null; // test hook
  showGhost = false;
  ghost!: Phaser.GameObjects.Rectangle;
  keys!: Record<string, Phaser.Input.Keyboard.Key>;
  cam = { x: 600, y: 600, z: 0.9 };
  trauma = 0; // screen shake, only for hits you are part of
  shakeT = 0;
  feed: Array<{ text: string; color: string; t: number }> = [];
  // the course
  builtVersion = -1;
  courseObjs: Phaser.GameObjects.GameObject[] = [];
  moving: SolidView[] = [];
  buttons: Phaser.GameObjects.Rectangle[] = [];
  dyn!: Phaser.GameObjects.Graphics; // hammers, bars, wind and belts, redrawn every frame

  constructor() {
    super('play');
  }

  init(data: { session: Session }) {
    this.session = data.session;
  }

  create() {
    this.makeTextures();
    const cam = this.cameras.main;
    cam.setBackgroundColor(COL.bg);
    this.ghost = this.add.rectangle(0, 0, 30, 40).setStrokeStyle(2, 0xffffff, 0.7).setVisible(false).setDepth(30);
    this.keys = this.input.keyboard!.addKeys('W,A,D,SPACE,SHIFT,UP,LEFT,RIGHT,E,F,R,L,G,C,M,N') as Record<string, Phaser.Input.Keyboard.Key>;
    this.keys.M.on('down', () => this.events.emit('toast', sound.toggleMusic() ? 'Music on' : 'Music off'));
    this.keys.N.on('down', () => this.events.emit('toast', sound.toggleSfx() ? 'Sound effects on' : 'Sound effects off'));
    this.keys.R.on('down', () => this.session.toggleReady());
    this.keys.L.on('down', () => this.session.cycleLag());
    this.keys.G.on('down', () => { this.showGhost = !this.showGhost; });
    this.keys.C.on('down', () => {
      void navigator.clipboard?.writeText(location.href).then(() => this.events.emit('toast', 'Invite link copied'));
    });
    this.buildCourse();
    this.scene.launch('ui', { session: this.session, play: this });
    this.scene.bringToTop('ui'); // draw the HUD over the level
  }

  makeTextures() {
    if (this.textures.exists('bean')) return;
    const g = this.make.graphics({ x: 0, y: 0 }, false);
    g.fillStyle(0xffffff, 1);
    g.fillRoundedRect(0, 0, 36, 44, 16);
    g.fillStyle(0x1b1d22, 1);
    g.fillCircle(21, 15, 3.5);
    g.fillCircle(29, 15, 3.5);
    g.generateTexture('bean', 36, 44);
    g.destroy();
  }

  /** Draw the course: everything that never moves once, and keep handles on the parts that do. */
  buildCourse() {
    for (const o of this.courseObjs) o.destroy();
    this.courseObjs = [];
    this.moving = [];
    this.buttons = [];
    const lv = this.session.course.level;
    this.builtVersion = this.session.courseVersion;
    this.cameras.main.setBounds(0, 0, lv.width, WORLD_H);
    const keep = <T extends Phaser.GameObjects.GameObject>(o: T) => { this.courseObjs.push(o); return o; };

    lv.solids.forEach((s, i) => {
      const color = s.kind === 'mover' || s.kind === 'balanceL' || s.kind === 'balanceR' ? COL.moving
        : s.kind === 'falling' ? COL.falling : s.kind === 'gate' ? COL.gate : s.kind === 'plank' ? COL.plank : COL.plat;
      // bridge tiles get a small seam; fake tiles look exactly like the real ones, that is the trick
      const w = s.tile ? s.w - 4 : s.w;
      const body = keep(this.add.rectangle(s.x + s.w / 2, s.top + s.h / 2, w, s.h, color));
      // a belt's top is dark, with light stripes sliding along it (see drawCourse)
      const topColor = s.kind === 'gate' ? COL.gate : s.kind === 'belt' ? COL.belt : s.kind === 'plank' ? COL.plank : COL.platTop;
      const top = keep(this.add.rectangle(s.x + s.w / 2, s.top + 3, w, 6, topColor));
      if (s.kind !== 'static' && s.kind !== 'belt') this.moving.push({ i, body, top });
    });
    // seesaw pivot
    if (lv.balance) {
      const l = lv.solids[lv.balance.left];
      keep(this.add.triangle(l.x + l.w, lv.balance.top + 46, 0, 22, 14, 0, 28, 22, COL.platTop));
    }
    for (const b of lv.gates.flatMap((g) => g.buttons)) {
      this.buttons.push(keep(this.add.rectangle((b.x0 + b.x1) / 2, b.top, b.x1 - b.x0, 8, COL.button).setOrigin(0.5, 1)));
    }
    for (const pad of lv.pads) {
      keep(this.add.rectangle((pad.x0 + pad.x1) / 2, pad.top, pad.x1 - pad.x0, 10, COL.pad).setOrigin(0.5, 1));
      keep(this.add.text((pad.x0 + pad.x1) / 2, pad.top - 16, 'BOUNCE', { fontFamily: FONT, fontSize: '12px', color: hex(COL.pad) }).setOrigin(0.5, 1));
    }
    for (const f of lv.fans) {
      // the fan stands on the far side of the gap, blowing back toward the start
      const fx = f.push < 0 ? f.x + f.w + 30 : f.x - 30;
      const ground = f.top + f.h - 20;
      keep(this.add.rectangle(fx, ground, 6, 150, COL.platTop).setOrigin(0.5, 1));
      keep(this.add.rectangle(fx, ground - 150, 26, 90, COL.platTop).setOrigin(0.5, 0.5));
      for (const dy of [-24, 0, 24]) keep(this.add.rectangle(fx, ground - 150 + dy, 26, 4, COL.plat));
    }
    for (const cp of lv.checkpoints.slice(1)) {
      const top = lv.solids.find((s) => s.x === cp.x)?.top ?? cp.sy + 60;
      keep(this.add.rectangle(cp.x + 30, top - 35, 3, 70, COL.flag));
      keep(this.add.rectangle(cp.x + 44, top - 62, 26, 16, COL.flag));
    }
    if (lv.finishX > 0) {
      keep(this.add.rectangle(lv.finishX, lv.finishTop - 90, 8, 180, COL.flag));
      keep(this.add.text(lv.finishX + 16, lv.finishTop - 170, lv.mode === 'final' ? 'CROWN' : 'FINISH', { fontFamily: FONT, fontSize: '28px', fontStyle: 'bold', color: COL.text }));
    }
    this.dyn = keep(this.add.graphics().setDepth(5));
  }

  readButtons(): number {
    if (this.forcedButtons !== null) return this.forcedButtons;
    const k = this.keys;
    let b = 0;
    if (k.A.isDown || k.LEFT.isDown) b |= BTN.left;
    if (k.D.isDown || k.RIGHT.isDown) b |= BTN.right;
    if (k.W.isDown || k.SPACE.isDown || k.UP.isDown) b |= BTN.jump;
    if (k.SHIFT.isDown) b |= BTN.dive;
    if (k.E.isDown) b |= BTN.grab;
    if (k.F.isDown) b |= BTN.push;
    return b;
  }

  /** Run n ticks right now. Used by the update loop, and by tests while the tab is hidden. */
  runTicks(n: number): void {
    for (let i = 0; i < n; i++) {
      const before = this.session.predictor.state;
      const was = { vy: before.vy, grounded: before.grounded, airJumps: before.airJumps, diving: before.diving, dead: before.dead };
      const intent = this.session.tick(this.readButtons());
      this.moveSound(was, this.session.predictor.state);
      // your own moves show instantly; whether they hit is up to the server
      if (intent & INTENT.push) this.swipe(this.session.myId);
    }
  }

  /** Your own jumps, dives and landings (only yours: everyone's would be too much noise). */
  moveSound(was: { vy: number; grounded: boolean; airJumps: number; diving: boolean; dead: boolean }, now: PlayerState) {
    if (now.dead || was.dead) return;
    if (now.vy < -1000 && was.vy > -1000) sound.play('pad');
    else if (now.vy < -400 && was.vy - now.vy > 300) sound.play(now.airJumps < was.airJumps && !was.grounded ? 'jump2' : 'jump');
    else if (now.diving && !was.diving) sound.play('dive');
    else if (now.grounded && !was.grounded && was.vy > 450) sound.play('land', 0.8);
  }

  update(_time: number, deltaMs: number) {
    const dt = Math.min(deltaMs / 1000, 0.1);
    if (this.session.disconnected) return;
    if (this.builtVersion !== this.session.courseVersion) this.buildCourse();
    this.acc = Math.min(this.acc + deltaMs / 1000, 0.25);
    let n = 0;
    while (this.acc >= DT && n < 8) { this.acc -= DT; n++; }
    this.runTicks(n);
    this.draw(this.acc / DT, dt);
  }

  draw(alpha: number, dt: number) {
    const s = this.session;
    const now = performance.now();
    // obstacles are drawn at your bean's time, so what hits you is what you see hitting you
    const simT = s.predictor.simTick + alpha;
    const solids = s.course.layout(simT, 2);
    const shown: Array<{ id: number; x: number; y: number; vx: number }> = [];
    const states: PlayerState[] = [];
    // others first, then you, so a carried you can ride on the carrier's drawn spot
    const order = [...s.roster.values()].sort((a, b) => Number(a.id === s.myId) - Number(b.id === s.myId));
    for (const info of order) {
      let st: PlayerState & { x: number; y: number };
      if (info.id === s.myId) {
        st = { ...s.predictor.state, ...s.predictor.renderPos(alpha, dt) };
        const carrier = st.heldBy ? this.beans.get(st.heldBy) : undefined;
        if (carrier) {
          const f = carrier.view.flipX ? -1 : 1;
          st = { ...st, x: carrier.x + f * 34, y: carrier.y - 12, facing: -f };
        }
      } else {
        const smp = s.interp.sample(info.id, now);
        if (!smp) continue;
        st = this.rideAlong(smp, smp.renderTick, solids);
      }
      const b = this.beans.get(info.id) ?? this.makeBean(info);
      if (info.id !== s.myId) st = this.smoothRemote(b, st, dt);
      this.drawBean(b, st, dt);
      states.push(st);
      if (!st.dead) shown.push({ id: info.id, x: st.x, y: st.y, vx: st.vx });
    }
    this.drawCourse(simT, solids, states);
    this.showEvents(now);
    for (const [id, b] of this.beans) {
      if (!s.roster.has(id)) { b.view.destroy(); b.label.destroy(); b.bar.destroy(); b.tail.destroy(); this.beans.delete(id); }
    }
    s.interp.forget(s.interp.renderTick(now) - 30);

    const ss = s.predictor.serverState;
    this.ghost.setVisible(this.showGhost && !!ss && !ss.dead);
    if (ss) this.ghost.setPosition(ss.x, ss.y);

    this.updateCamera(shown, dt);
  }

  /**
   * Other beans are drawn a little in the past, but the platforms at your time. A bean standing on
   * something that moves is shifted along with it, so it stays on the platform instead of floating.
   */
  rideAlong<T extends PlayerState>(st: T, renderTick: number, solids: Box[]): T {
    if (!st.grounded || st.plat < 0 || this.session.course.level.solids[st.plat]?.kind === 'static') return st;
    const then = this.session.course.layout(renderTick, 3)[st.plat];
    const nowBox = solids[st.plat];
    if (!then || !nowBox?.on) return st;
    return { ...st, x: st.x + nowBox.x - then.x, y: st.y + nowBox.top - then.top };
  }

  drawCourse(t: number, solids: Box[], beans: PlayerState[]) {
    const c = this.session.course;
    const lv = c.level;
    const wobble = Math.sin(performance.now() / 22) * 2.5;
    for (const m of this.moving) {
      const b = solids[m.i];
      const s = lv.solids[m.i];
      const x = b.x + s.w / 2 + wobble * b.shake;
      m.body.setVisible(b.on).setPosition(x, b.top + s.h / 2);
      m.top.setVisible(b.on).setPosition(x, b.top + 3);
      // Hot Plate tiles warn you: their top turns red as they shake
      if (s.kind === 'timed') m.top.setFillStyle(b.shake > 0 ? COL.hazard : COL.platTop);
      // Trust Bridge planks warn you: red when one more bean would break them
      if (s.kind === 'plank') {
        const load = beans.filter((p) => !p.dead && p.grounded && p.x > b.x - HALF_W && p.x < b.x + s.w + HALF_W && Math.abs(p.y + HALF_H - b.top) < 8).length;
        m.top.setFillStyle(b.shake > 0 || (lv.plankLimit > 1 && load >= lv.plankLimit - 1) ? COL.hazard : COL.plank);
      }
    }
    lv.gates.flatMap((g) => g.buttons).forEach((btn, i) => this.buttons[i].setFillStyle(beans.some((p) => onButton(p, btn)) ? COL.buttonOn : COL.button));

    const d = this.dyn;
    d.clear();
    // belts: stripes sliding the way the belt carries you
    for (const s of lv.solids) {
      if (!s.belt) continue;
      d.fillStyle(COL.platTop, 1);
      const off = (((t / TICK_RATE) * s.belt) % 40 + 40) % 40;
      for (let x = s.x + off - 40; x < s.x + s.w; x += 40) {
        const x0 = Math.max(s.x, x), x1 = Math.min(s.x + s.w, x + 20);
        if (x1 > x0) d.fillRect(x0, s.top, x1 - x0, 6);
      }
    }
    // fans: streaks of wind while on
    lv.fans.forEach((f, i) => {
      if (!c.fanOn(i, t)) return;
      d.fillStyle(COL.wind, 0.18);
      const speed = f.push < 0 ? -1 : 1;
      for (let k = 0; k < 9; k++) {
        const y = f.top + 20 + ((k * 53) % (f.h - 40));
        const run = ((((t / TICK_RATE) * 700 * speed + k * 97) % f.w) + f.w) % f.w;
        d.fillRect(f.x + run, y, 46, 3);
      }
    });
    // hammers
    lv.hammers.forEach((h, i) => {
      const p = c.hammer(i, t);
      d.lineStyle(6, COL.arm, 1);
      d.lineBetween(h.px, h.py, p.x, p.y);
      d.fillStyle(COL.arm, 1);
      d.fillCircle(h.px, h.py, 7);
      d.fillStyle(COL.hazard, 1);
      d.fillCircle(p.x, p.y, h.r);
    });
    // rotating bars
    lv.bars.forEach((b, i) => {
      const a = c.barAngle(i, t);
      const ux = Math.cos(a) * b.len, uy = Math.sin(a) * b.len;
      d.lineStyle(12, COL.hazard, 1);
      d.lineBetween(b.cx - ux, b.cy - uy, b.cx + ux, b.cy + uy);
      d.fillStyle(COL.arm, 1);
      d.fillCircle(b.cx, b.cy, 8);
    });
  }

  makeBean(info: PlayerInfo): BeanView {
    const view = this.add.image(0, 0, 'bean').setOrigin(0.5, 1).setTint(info.color).setDepth(10);
    const label = this.add.text(0, 0, info.name, { fontFamily: FONT, fontSize: '14px', color: hex(info.color) }).setOrigin(0.5, 1).setDepth(20);
    const bar = this.add.rectangle(0, 0, 36, 4, 0xe9e9e9).setOrigin(0, 0.5).setDepth(20).setVisible(false);
    const tail = this.add.rectangle(0, 0, 26, 9, COL.tail).setDepth(9).setVisible(false);
    const b: BeanView = { view, label, bar, tail, tailSafe: 0, x: 0, y: 0, sx: 1, sy: 1, grounded: true, vy: 0, rot: 0, drawnX: null, drawnY: 0, errX: 0, errY: 0 };
    this.beans.set(info.id, b);
    return b;
  }

  /** When late data moves another bean's path (after keeping it moving on a guess), ease into it. */
  smoothRemote<T extends PlayerState>(b: BeanView, st: T, dt: number): T {
    if (st.dead || b.drawnX === null) {
      b.errX = 0; b.errY = 0;
      b.drawnX = st.dead ? null : st.x;
      b.drawnY = st.y;
      return st;
    }
    const expected = Math.hypot(st.vx, st.vy) * dt + 6; // how far it could move this frame
    const fade = Math.exp(-12 * dt);
    b.errX *= fade;
    b.errY *= fade;
    let x = st.x + b.errX, y = st.y + b.errY;
    const jump = Math.hypot(x - b.drawnX, y - b.drawnY);
    if (jump > expected && jump < 200) {
      b.errX += b.drawnX - x;
      b.errY += b.drawnY - y;
      // allow normal movement this frame, just not the jump
      const k = expected / jump;
      b.errX -= (b.drawnX - x) * k;
      b.errY -= (b.drawnY - y) * k;
      x = st.x + b.errX;
      y = st.y + b.errY;
    }
    b.drawnX = x;
    b.drawnY = y;
    return { ...st, x, y };
  }

  drawBean(b: BeanView, st: PlayerState, dt: number) {
    b.view.setVisible(!st.dead);
    b.label.setVisible(!st.dead);
    b.bar.setVisible(!st.dead && st.hanging);
    b.tail.setVisible(!st.dead && st.tail);
    // just stolen or passed: it blinks while it can't be taken straight back
    b.tail.setAlpha(performance.now() < b.tailSafe && Math.floor(performance.now() / 120) % 2 ? 0.25 : 1);
    if (st.tail) b.tail.setPosition(st.x - st.facing * 20, st.y + 6).setRotation(-st.facing * 0.35);
    if (st.dead) return;
    b.x = st.x;
    b.y = st.y;
    // blinking = protected (just respawned or climbed up): can't be shoved or grabbed. Finished beans are see-through.
    const blink = st.protect > 0 && !st.finished && Math.floor(performance.now() / 90) % 2;
    b.view.setAlpha(st.finished ? 0.5 : blink ? 0.35 : 1);
    if (st.hanging) b.bar.setPosition(st.x - 18, st.y - 40).setSize((36 * Math.max(0, st.hangT)) / HANG_TIME, 4);
    // squash on landing, stretch on take-off, then spring back
    if (st.grounded && !b.grounded && b.vy > 250) { b.sx = 1.25; b.sy = 0.78; }
    if (st.vy < -400 && b.vy > -200) { b.sx = 0.8; b.sy = 1.22; }
    b.grounded = st.grounded;
    b.vy = st.vy;
    const k = 1 - Math.exp(-12 * dt);
    b.sx += (1 - b.sx) * k;
    b.sy += (1 - b.sy) * k;
    b.rot += ((st.diving ? st.facing * 1.25 : 0) - b.rot) * (1 - Math.exp(-14 * dt));
    b.view.setPosition(st.x, st.y + 22).setScale(b.sx, b.sy).setFlipX(st.facing < 0).setRotation(b.rot);
    b.label.setPosition(st.x, st.y - (st.hanging ? 46 : 28));
  }

  // ---------- help and hurt feedback ----------

  /** Show server events once the beans involved are drawn at that moment. */
  showEvents(now: number) {
    const s = this.session;
    const rt = s.interp.renderTick(now);
    const keep: GameEvent[] = [];
    for (const e of s.events) {
      // things that happen to you show right away (your bean is drawn in the present)
      const solo = e.k === 'fall' || e.k === 'climb' || e.k === 'bonk' || e.k === 'finish' || e.k === 'out';
      const mine = e.b === s.myId || (solo && e.a === s.myId);
      if (mine || e.tick <= rt) this.showEvent(e);
      else keep.push(e);
    }
    s.events = keep;
  }

  /** The sound for something that happened: full volume if it involves you, softer otherwise, panned to where it was. */
  eventSound(e: GameEvent, involved: boolean) {
    const sfx = EVENT_SOUND[e.k];
    if (!sfx) return;
    const cam = this.cameras.main;
    const pan = (e.x - cam.midPoint.x) / (cam.width / 2 / cam.zoom);
    sound.play(sfx, involved ? 1 : 0.45, pan * 0.7);
  }

  showEvent(e: GameEvent) {
    const s = this.session;
    const name = (id: number) => (id === s.myId ? 'You' : s.roster.get(id)?.name ?? 'Someone');
    const whom = (id: number) => (id === s.myId ? 'you' : name(id)); // "knocked out you", not "You"
    const arena = s.course.level.mode === 'survival' || s.course.level.mode === 'hunt'; // no gaps there: throws are "to safety"
    const involved = e.a === s.myId || e.b === s.myId;
    const target = this.beans.get(e.b);
    const tx = target ? target.x : e.x;
    const ty = target ? target.y : e.y;
    const plus = e.pts ? `  +${e.pts}` : '';
    this.eventSound(e, involved);
    switch (e.k) {
      case 'shove':
        this.floatText(tx, ty - 40, 'SHOVE', COL.bad);
        this.squash(e.b, 0.7, 1.3);
        if (involved) this.shake(0.4);
        break;
      case 'shoveOff':
        this.floatText(tx, ty - 40, 'SHOVED OFF', COL.bad);
        this.log(`${name(e.a)} shoved ${whom(e.b)} off a ledge`, COL.bad);
        if (involved) this.shake(0.4);
        break;
      case 'grab':
        this.squash(e.b, 1.2, 0.8);
        break;
      case 'throw':
        this.floatText(tx, ty - 40, 'THROWN', COL.text);
        this.squash(e.b, 0.75, 1.3);
        if (involved) this.shake(0.15);
        break;
      case 'save':
        this.ring(tx, ty, 0x7fd48a);
        this.floatText(tx, ty - 44, `SAVED${plus}`, COL.good);
        this.squash(e.b, 0.8, 1.25);
        this.log(`${name(e.a)} pulled ${whom(e.b)} up${plus}`, COL.good);
        break;
      case 'help':
        this.ring(tx, ty, 0x7fd48a);
        this.floatText(tx, ty - 44, `HELP${plus}`, COL.good);
        this.log(`${name(e.a)} threw ${whom(e.b)} ${arena ? 'to safety' : 'across a gap'}${plus}`, COL.good);
        break;
      case 'door': {
        const holder = this.beans.get(e.a);
        if (holder) this.ring(holder.x, holder.y, 0x7fd48a);
        this.floatText(holder ? holder.x : e.x, (holder ? holder.y : e.y) - 44, `HELD THE DOOR${plus}`, COL.good);
        this.log(`${name(e.a)} held the door for ${whom(e.b)}${plus}`, COL.good);
        break;
      }
      case 'ko':
        this.floatText(e.x, Math.min(e.y, WORLD_H - 80), `KO!${plus}`, COL.bad, 30);
        this.log(`${name(e.a)} knocked out ${whom(e.b)}${plus}`, COL.bad);
        if (involved) this.shake(0.65);
        break;
      case 'fall':
        this.log(`${name(e.a)} fell`, COL.dim);
        break;
      case 'climb':
        this.squash(e.a, 1.25, 0.8);
        break;
      case 'bonk': {
        const who = this.beans.get(e.a);
        this.floatText(who ? who.x : e.x, (who ? who.y : e.y) - 40, 'BONK', COL.text);
        this.squash(e.a, 0.7, 1.3);
        if (e.a === s.myId) this.shake(0.35);
        break;
      }
      case 'out': {
        this.log(`${name(e.a)} ${e.a === s.myId ? 'are' : 'is'} out`, COL.bad);
        break;
      }
      case 'steal': {
        const who = this.beans.get(e.a);
        if (who) who.tailSafe = performance.now() + TAIL_IMMUNE * 1000;
        this.floatText(who ? who.x : e.x, (who ? who.y : e.y) - 44, 'STOLEN', COL.bad);
        this.log(`${name(e.a)} stole ${e.b === s.myId ? 'your' : `${whom(e.b)}'s`} tail`, COL.bad);
        if (involved) this.shake(0.3);
        break;
      }
      case 'pass': {
        const got = this.beans.get(e.b);
        if (got) got.tailSafe = performance.now() + TAIL_IMMUNE * 1000;
        this.ring(tx, ty, 0x7fd48a);
        this.floatText(tx, ty - 44, `TAIL PASSED${plus}`, COL.good);
        this.log(`${name(e.a)} gave ${whom(e.b)} a tail${plus}`, COL.good);
        break;
      }
      case 'finish': {
        const who = this.beans.get(e.a);
        const place = e.place ?? 0;
        if (who) this.ring(who.x, who.y, 0xf2c14e);
        this.floatText(who ? who.x : e.x, (who ? who.y : e.y) - 44, `${ordinal(place)}${plus}`, COL.gold, 26);
        this.log(`${name(e.a)} finished ${ordinal(place)}${plus}`, COL.gold);
        break;
      }
    }
  }

  swipe(id: number) {
    const b = this.beans.get(id);
    if (!b) return;
    const facing = b.view.flipX ? -1 : 1;
    const arc = this.add.rectangle(b.x + facing * 34, b.y - 4, 28, 6, 0xe9e9e9).setDepth(15).setAlpha(0.8);
    this.tweens.add({ targets: arc, x: arc.x + facing * 26, alpha: 0, scaleX: 0.4, duration: 180, onComplete: () => arc.destroy() });
    b.sx = 1.2;
    b.sy = 0.85;
  }

  squash(id: number, sx: number, sy: number) {
    const b = this.beans.get(id);
    if (b) { b.sx = sx; b.sy = sy; }
  }

  ring(x: number, y: number, color: number) {
    const c = this.add.circle(x, y, 14).setStrokeStyle(3, color).setDepth(15);
    this.tweens.add({ targets: c, scale: 4, alpha: 0, duration: 420, onComplete: () => c.destroy() });
  }

  floatText(x: number, y: number, text: string, color: string, size = 18) {
    const t = this.add.text(x, y, text, { fontFamily: FONT, fontSize: `${size}px`, fontStyle: 'bold', color }).setOrigin(0.5).setDepth(40);
    this.tweens.add({ targets: t, y: y - 40, alpha: 0, duration: 1100, ease: 'Cubic.easeOut', onComplete: () => t.destroy() });
  }

  log(text: string, color: string) {
    this.feed.push({ text, color, t: performance.now() });
    if (this.feed.length > 5) this.feed.shift();
  }

  shake(amount: number) {
    this.trauma = Math.min(1, this.trauma + amount);
  }

  updateCamera(points: Array<{ id: number; x: number; y: number; vx: number }>, dt: number) {
    const cam = this.cameras.main;
    const me = points.find((p) => p.id === this.session.myId);
    if (!points.length) return;
    const fit = (pts: typeof points) => {
      const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
      const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
      const zoom = Math.min(cam.width / (maxX - minX + 520), cam.height / (maxY - minY + 440));
      return { zoom, cx: (minX + maxX) / 2, cy: (minY + maxY) / 2 };
    };
    // Shared zoom that fits everyone. If they are too spread out, keep the players near you.
    let f = fit(points);
    if (f.zoom < 0.55 && me) f = fit(points.filter((p) => Math.abs(p.x - me.x) < 1100 && Math.abs(p.y - me.y) < 700));
    const z = Phaser.Math.Clamp(f.zoom, 0.55, 1);
    let cx = f.cx, cy = f.cy - 60;
    if (me) {
      // lean a little toward your own bean and the way you are running
      cx += (me.x - cx) * 0.25 + Phaser.Math.Clamp(me.vx * 0.3, -110, 110);
      cy += (me.y - 60 - cy) * 0.25;
    }
    const k = 1 - Math.exp(-4 * dt);
    this.cam.z += (z - this.cam.z) * k;
    this.cam.x += (cx - this.cam.x) * k;
    this.cam.y += (cy - this.cam.y) * k;
    // shake rides on top of the smooth follow: trauma squared, smooth sine noise
    this.trauma = Math.max(0, this.trauma - dt * 1.8);
    this.shakeT += dt;
    const sh = this.trauma * this.trauma;
    cam.setZoom(this.cam.z);
    cam.centerOn(
      this.cam.x + (18 * sh * Math.sin(this.shakeT * 47)) / this.cam.z,
      this.cam.y + (12 * sh * Math.sin(this.shakeT * 61 + 1.3)) / this.cam.z,
    );
  }
}

// ---------- HUD (its own scene, so camera zoom never scales it) ----------

class UIScene extends Phaser.Scene {
  session!: Session;
  play!: PlayScene;
  top!: Phaser.GameObjects.Text;
  debug!: Phaser.GameObjects.Text;
  rows: Phaser.GameObjects.Text[] = []; // one per player: name and points, in their color
  feedTexts: Phaser.GameObjects.Text[] = [];
  banner!: Phaser.GameObjects.Text; // lobby: ready up. race: timer
  sub!: Phaser.GameObjects.Text; // under the banner: place, boost
  big!: Phaser.GameObjects.Text; // round card and countdown
  card!: Phaser.GameObjects.Text;
  cardBg!: Phaser.GameObjects.Rectangle;
  panel!: Phaser.GameObjects.Container; // results
  panelKey = '';
  center!: Phaser.GameObjects.Text;
  toast!: Phaser.GameObjects.Text;
  toastT = 0;

  constructor() {
    super('ui');
  }

  init(data: { session: Session; play: PlayScene }) {
    this.session = data.session;
    this.play = data.play;
  }

  create() {
    const f = { fontFamily: FONT, fontSize: '15px', color: COL.text };
    this.top = this.add.text(16, 12, '', f);
    this.debug = this.add.text(16, 36, '', { ...f, fontSize: '13px', color: COL.dim });
    for (let i = 0; i < 4; i++) this.rows.push(this.add.text(1264, 12 + i * 22, '', f).setOrigin(1, 0));
    for (let i = 0; i < 5; i++) this.feedTexts.push(this.add.text(16, 560 + i * 22, '', { ...f, fontSize: '14px' }));
    this.makeGuide(f);
    this.banner = this.add.text(640, 70, '', { ...f, fontSize: '22px', fontStyle: 'bold', align: 'center' }).setOrigin(0.5, 0);
    this.sub = this.add.text(640, 102, '', { ...f, fontSize: '16px', align: 'center', wordWrap: { width: 460 } }).setOrigin(0.5, 0);
    this.cardBg = this.add.rectangle(640, 335, 800, 400, COL.panel, 0.94).setVisible(false);
    this.big = this.add.text(640, 250, '', { ...f, fontSize: '96px', fontStyle: 'bold', align: 'center' }).setOrigin(0.5);
    this.card = this.add.text(640, 340, '', { ...f, fontSize: '18px', align: 'center', lineSpacing: 6 }).setOrigin(0.5, 0);
    this.panel = this.add.container(640, 330).setVisible(false);
    this.center = this.add.text(640, 340, '', { ...f, fontSize: '22px', align: 'center' }).setOrigin(0.5);
    this.toast = this.add.text(640, 150, '', { ...f, fontSize: '16px' }).setOrigin(0.5);
    this.play.events.on('toast', (msg: string) => { this.toast.setText(msg); this.toastT = 2; });
  }

  update(_t: number, deltaMs: number) {
    const s = this.session;
    const lag = LAG_PRESETS[s.lagIndex].label;
    this.top.setText(`Room ${s.room}   ${s.roster.size} of 4 players   ping ${Math.round(s.net.rttMs)} ms   lag test: ${lag}`);
    const p = s.predictor;
    this.debug.setText(
      `corrections ${p.corrections} (last ${p.lastErrorPx.toFixed(1)} px)   inputs waiting for the server ${p.pendingCount}   others shown ${Math.round(s.interp.delayTicks * 16.7)} ms in the past`,
    );
    const players = [...s.roster.values()].sort((a, b) => a.slot - b.slot);
    this.rows.forEach((row, i) => {
      const r = players[i];
      if (!r) return row.setText('');
      const sc = s.scores.get(r.id) ?? { points: 0, helps: 0, kos: 0 };
      const who = r.id === s.myId ? `${r.name} (you)` : r.name;
      row.setText(`${this.tag(r.id)}${who}   ${sc.points} pts   ${sc.helps} helps   ${sc.kos} KOs`).setColor(hex(r.color));
    });
    const now = performance.now();
    const feed = this.play.feed.filter((l) => now - l.t < 7000);
    this.feedTexts.forEach((t, i) => {
      const line = feed[feed.length - this.feedTexts.length + i];
      t.setText(line ? line.text : '').setColor(line ? line.color : COL.text);
    });
    this.updateRound();
    this.center.setText(s.disconnected ? `${s.disconnected}\nRefresh the page to join again.` : '');
    this.toastT -= deltaMs / 1000;
    this.toast.setVisible(this.toastT > 0);
  }

  updateRound() {
    const s = this.session;
    const r = s.round;
    const lv = s.course.level;
    const me = s.predictor.state;
    const roundOf = `Round ${r.index + 1} of ${r.match.length}`;
    let banner = '', sub = '', big = '', card = '';
    if (r.phase === 'lobby') {
      const n = r.ready.filter((id) => s.roster.has(id)).length;
      banner = s.ready ? 'You are ready' : r.match.length ? 'Press R for a rematch' : 'Press R when you are ready';
      sub = `${n} of ${s.roster.size} ready. The match starts when everyone is. Until then, practice here.   C copies the invite link`;
    } else if (r.phase === 'intro') {
      const left = s.secondsUntil(r.go);
      const text = ROUND_TEXT[r.type];
      if (left > 3) {
        big = text.name;
        const today = lv.sections.length && r.type === 'ledge' ? `\n${lv.sections.map((x) => SECTION_NAMES[x]).join(', ')}` : '';
        card = `${r.index === r.match.length - 1 ? 'Final round' : roundOf}   ${DIFFICULTY[r.diff].label}${today}\n\n${text.goal}\n`
          + `Help (+1): ${text.help}.\nHurt (+1 a knockout): ${text.hurt}.`;
      } else {
        big = String(Math.max(1, Math.ceil(left)));
      }
    } else if (r.phase === 'play') {
      banner = clock(Math.max(0, s.secondsUntil(r.end)));
      if (s.secondsUntil(r.go) > -0.8) big = 'GO!';
      sub = this.playLine();
    } else if (r.phase === 'results') {
      const last = r.index === r.match.length - 1;
      banner = `${roundOf}: ${ROUND_TEXT[r.type].name}`;
      const wait = Math.max(0, Math.ceil(s.secondsUntil(r.next)));
      sub = last ? `The winner in ${wait}` : `Next: ${ROUND_TEXT[r.match[r.index + 1]].name} in ${wait}`;
    } else if (r.phase === 'show') {
      const names = (r.results?.winners ?? []).map((id) => (id === s.myId ? 'You' : s.roster.get(id)?.name ?? 'Someone'));
      big = names.length ? `${names.join(' and ')} ${names.length > 1 || names[0] === 'You' ? 'win' : 'wins'}!` : 'Nobody scored';
      sub = `Back to the lobby in ${Math.max(0, Math.ceil(s.secondsUntil(r.next)))}, then R for a rematch`;
    }
    this.banner.setText(banner);
    this.sub.setText(sub);
    this.phaseSounds(r, big);
    const roomy = r.phase === 'lobby' || r.phase === 'play';
    this.guide.setVisible(roomy); // the round card and the tables need the space
    this.big.setText(big).setFontSize(r.phase === 'show' ? 56 : 96).setY(r.phase === 'show' ? 160 : 250);
    this.card.setText(card);
    this.cardBg.setVisible(card !== '');
    this.me = me;
    this.drawResults();
  }

  me: PlayerState | null = null;

  /**
   * The controls, top left, kept small so it never covers the game: only the keys you need while playing
   * (each round's card explains its own tricks). H hides it (remembered in this browser).
   */
  makeGuide(f: Phaser.Types.GameObjects.Text.TextStyle) {
    const rows: Array<[string, string]> = [
      ['A D', 'Run'],
      ['W Space', 'Jump (again in the air)'],
      ['Shift', 'Dive'],
      ['F', 'Shove'],
      ['E', 'Grab, pull up, let go: throw'],
      ['R', 'Ready'],
      ['M N', 'Music, sounds'],
      ['H', 'Hide or show this'],
    ];
    // a curtain: the panel slides in from the left edge; its tab stays on screen to pull it back out
    const pad = 10, y = 60, lh = 16, col = 64;
    const w = col + 176, h = rows.length * lh + 10;
    this.guide = this.add.container(0, 0);
    this.guide.add(this.add.rectangle(0, y - 5, w, h, COL.panel, 0.78).setOrigin(0, 0));
    rows.forEach(([key, what], i) => {
      this.guide.add(this.add.text(pad, y + i * lh, key, { ...f, fontSize: '12px', fontStyle: 'bold' }));
      this.guide.add(this.add.text(pad + col, y + i * lh, what, { ...f, fontSize: '12px', color: COL.dim }));
    });
    const tab = this.add.rectangle(w, y - 5, 92, 24, COL.panel, 0.92).setOrigin(0, 0).setInteractive({ useHandCursor: true });
    const tabText = this.add.text(w + 46, y + 7, '', { ...f, fontSize: '12px', fontStyle: 'bold' }).setOrigin(0.5);
    this.guide.add([tab, tabText]);
    const place = (animate: boolean) => {
      tabText.setText(this.guideOn ? 'Hide  ◂' : 'Controls  ▸');
      const x = this.guideOn ? 0 : -w;
      this.tweens.killTweensOf(this.guide);
      if (animate) this.tweens.add({ targets: this.guide, x, duration: 220, ease: 'Cubic.easeOut' });
      else this.guide.x = x;
    };
    const toggle = () => {
      this.guideOn = !this.guideOn;
      localStorage.setItem('frenymies.guide', this.guideOn ? 'on' : 'off');
      place(true);
    };
    // open the first time someone plays, then remember what they chose
    this.guideOn = localStorage.getItem('frenymies.guide') !== 'off';
    place(false);
    tab.on('pointerdown', toggle);
    this.input.keyboard!.addKey('H').on('down', toggle);
  }

  guide!: Phaser.GameObjects.Container;
  guideOn = true;

  private lastBig = '';
  private lastPhase = '';

  /** Countdown beeps, and the music and jingles for each part of the match (a new random song each round). */
  phaseSounds(r: RoundInfo, big: string) {
    if (big !== this.lastBig) {
      if (big === '3' || big === '2' || big === '1') sound.play('count');
      else if (big === 'GO!') sound.play('go');
      this.lastBig = big;
    }
    const key = `${r.phase} ${r.index} ${r.seed}`;
    if (key === this.lastPhase) return;
    this.lastPhase = key;
    const s = this.session;
    switch (r.phase) {
      case 'lobby': sound.music('lobby'); break;
      case 'intro': sound.stopMusic(); sound.play('intro'); break;
      case 'play': sound.music(s.course.level.mode === 'final' ? 'final' : 'round', DIFF_INTENSITY[r.diff] + r.index); break;
      case 'results': sound.stopMusic(); sound.play('results'); break;
      case 'show': sound.stopMusic(); sound.play(r.results?.winners.includes(s.myId) ? 'win' : 'lose'); break;
    }
  }

  /** A short tag in front of a name on the scoreboard: who is ready, who is out, who has a tail. */
  tag(id: number): string {
    const r = this.session.round;
    const mode = this.session.course.level.mode;
    if (r.phase === 'lobby') return r.ready.includes(id) ? '[ready] ' : '';
    if (r.phase !== 'play' && r.phase !== 'intro') return '';
    if (mode === 'survival' && r.out.includes(id)) return '[out] ';
    if (mode === 'hunt' && this.play.beans.get(id)?.tail.visible) return '[tail] ';
    return '';
  }

  /** The line under the timer while a round is on: how you are doing, in that round's terms. */
  playLine(): string {
    const s = this.session;
    const r = s.round;
    const me = s.predictor.state;
    const mode = s.course.level.mode;
    if (mode === 'survival') {
      const left = [...s.roster.keys()].filter((id) => !r.out.includes(id)).length;
      return r.out.includes(s.myId) ? `You are out. ${left} still standing` : `${left} still standing. Stay off the red tiles`;
    }
    if (mode === 'hunt') {
      const tails = [...this.play.beans.keys()].filter((id) => (id === s.myId ? me.tail : s.interp.sample(id, performance.now())?.tail)).length;
      return me.tail ? 'You have a tail! Keep it until the end' : `Grab a tail from someone (${tails} out there)`;
    }
    const place = r.finished.indexOf(s.myId) + 1;
    if (mode === 'final') {
      if (place === 1) return `You win the crown!  +${FINAL_POINTS}`;
      return `First across wins the crown   ${ordinal(this.racePosition())} place${me.boost ? '   catch-up boost' : ''}`;
    }
    if (place) return `You finished ${ordinal(place)}!${FINISH_POINTS[place - 1] ? `  +${FINISH_POINTS[place - 1]}` : ''}`;
    return `${ordinal(this.racePosition())} place${me.boost ? '   catch-up boost' : ''}`;
  }

  /** Your place in the race right now: finishers first, then by how far along the course. */
  racePosition(): number {
    const s = this.session;
    const r = s.round;
    if (r.finished.includes(s.myId)) return r.finished.indexOf(s.myId) + 1;
    const myX = s.predictor.state.x;
    let ahead = r.finished.filter((id) => s.roster.has(id)).length;
    for (const b of this.play.beans.keys()) {
      if (b === s.myId || r.finished.includes(b)) continue;
      const v = this.play.beans.get(b)!;
      if (v.x > myX) ahead++;
    }
    return ahead + 1;
  }

  /** The table after each round, and at the end of the match (with the awards). */
  drawResults() {
    const s = this.session;
    const r = s.round;
    const res = r.phase === 'results' || r.phase === 'show' ? r.results : null;
    const key = res ? r.phase + JSON.stringify(res) + [...s.roster.keys()].join() : '';
    if (key === this.panelKey) return;
    this.panelKey = key;
    this.panel.removeAll(true);
    this.panel.setVisible(!!res);
    if (!res) return;
    const show = r.phase === 'show';
    const mode = s.course.level.mode;
    const name = (id: number) => (s.roster.get(id)?.name ?? 'Someone') + (id === s.myId ? ' (you)' : '');
    const color = (id: number) => hex(s.roster.get(id)?.color ?? 0xe9e9e9);
    const f = { fontFamily: FONT, fontSize: '17px', color: COL.text };
    const cols = [-300, -250, -40, 70, 160, 250];
    const heads = ['', 'Player', show ? '' : 'This round', 'Helps', 'KOs', 'Points'];
    const none = mode === 'survival' ? 'out first' : mode === 'hunt' ? 'no tail' : 'did not finish';
    // the show sums every round, and the arenas have no gaps: there a throw is just "to safety"
    const arena = show || mode === 'survival' || mode === 'hunt';
    const moments = (res.highlights ?? []).map((m) => moment(m, (id) => s.roster.get(id)?.name ?? 'Someone', s.myId, arena));
    const h = 120 + res.rows.length * 34 + moments.length * 24;
    this.panel.setY(show ? 370 : 330);
    this.panel.add(this.add.rectangle(0, 0, 680, h, COL.panel, 0.94));
    const y0 = -h / 2 + 24;
    heads.forEach((t, i) => this.panel.add(this.add.text(cols[i], y0, t, { ...f, color: COL.dim }).setOrigin(i > 1 ? 0.5 : 0, 0)));
    res.rows.forEach((row, k) => {
      const y = y0 + 34 + k * 34;
      const thisRound = show ? '' : row.place ? `${ordinal(row.place)}${row.roundPts ? ` +${row.roundPts}` : ''}` : none;
      const cells = [String(k + 1), name(row.id), thisRound, String(row.helps), String(row.kos), String(row.points)];
      cells.forEach((t, i) => this.panel.add(this.add.text(cols[i], y, t, { ...f, color: i === 1 ? color(row.id) : COL.text, fontStyle: i === 5 ? 'bold' : '' }).setOrigin(i > 1 ? 0.5 : 0, 0)));
    });
    const award = (label: string, ids: number[], what: string) => (ids.length ? `${label}: ${ids.map(name).join(' and ')} (${what})` : `${label}: nobody`);
    const yAwards = y0 + 34 + res.rows.length * 34 + 14;
    this.panel.add(this.add.text(0, yAwards, `${award('Saint', res.saints, 'most helps')}     ${award('Traitor', res.traitors, 'most knockouts')}`,
      { ...f, fontSize: '15px', color: COL.dim }).setOrigin(0.5, 0));
    moments.forEach((line, i) => this.panel.add(this.add.text(0, yAwards + 26 + i * 24, line.text,
      { ...f, fontSize: '15px', color: line.good ? COL.good : COL.bad }).setOrigin(0.5, 0)));
  }
}

// ---------- join screen ----------

/** Wait for the welcome and the first round message (which course to build). */
function waitForWelcome(net: Net): Promise<{ w: Welcome; round: RoundInfo }> {
  return new Promise((resolve, reject) => {
    let w: Welcome | null = null;
    net.onMessage = (m) => {
      if (m.t === 'welcome') w = m;
      else if (m.t === 'round' && w) {
        const { t: _t, ...round } = m;
        resolve({ w, round });
      } else if (m.t === 'error') reject(new Error(m.message));
    };
    net.onClose = (reason) => reject(new Error(reason));
  });
}

async function join(name: string, room: string): Promise<Session> {
  const net = new Net(SERVER_URL);
  await net.opened();
  const welcome = waitForWelcome(net);
  net.send({ t: 'hello', name, room });
  const { w, round } = await welcome;
  return new Session(net, w, round);
}

function startGame(session: Session) {
  document.getElementById('join')!.remove();
  const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent: 'game',
    width: 1280,
    height: 720,
    backgroundColor: hex(COL.bg),
    scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
    scene: [],
  });
  game.scene.add('ui', UIScene);
  game.scene.add('play', PlayScene, true, { session });
  const w = window as unknown as Record<string, unknown>;
  w.__fren = {
    game,
    session,
    sound,
    play: () => game.scene.getScene('play') as PlayScene,
  };
}

const form = document.querySelector<HTMLFormElement>('#join form')!;
const errBox = form.querySelector<HTMLDivElement>('.err')!;
(form.elements.namedItem('name') as HTMLInputElement).value = localStorage.getItem('frenymies.name') ?? '';
(form.elements.namedItem('room') as HTMLInputElement).value = (params.get('room') ?? 'TEST').toUpperCase();

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  sound.unlock();
  const name = (form.elements.namedItem('name') as HTMLInputElement).value.trim();
  const room = (form.elements.namedItem('room') as HTMLInputElement).value.trim().toUpperCase();
  if (!ROOM_CODE.test(room)) { errBox.textContent = 'Room codes are 4 letters or numbers'; return; }
  errBox.textContent = 'Connecting...';
  try {
    const session = await join(name, room);
    localStorage.setItem('frenymies.name', name);
    const url = new URL(location.href);
    url.searchParams.set('room', room);
    history.replaceState(null, '', url);
    startGame(session);
  } catch (err) {
    errBox.textContent = err instanceof Error ? err.message : 'Could not join';
  }
});
