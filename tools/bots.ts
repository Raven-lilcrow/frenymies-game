// Test bots: fake players that join a room, ready up as soon as a real player is ready, and play the
// match, so one person can test a full room. Until then they practice the course in the lobby. They
// connect like a real browser, send inputs 60 times a second and predict their own bean the same way
// the browser does. Races (Ledge Run, Two-Key Door, Trust Bridge) are the autopilot (autopilot.ts);
// Hot Plate and Tail Tag have their own simple rules below.
// Each has a personality on top: Ava mostly helps (pulls people up, holds doors), Bo mostly hurts
// (shoves, grabs and throws), Cy and Dee do a bit of both.
// Run: node tools/bots.ts [count=3] [room=TEST] [server=ws://127.0.0.1:3100]
import {
  BTN, Course, DT, GRAB_RANGE, HALF_H, PUSH_RANGE, SnapDecoder, buildRound, onButton,
  type Difficulty, type PlayerState, type RoundInfo, type ServerMsg, type SnapPlayer,
} from '../packages/shared/src/index.ts';
import { Predictor } from '../client/src/predict.ts';
import { Autopilot } from './autopilot.ts';

const count = Math.max(1, Math.min(4, Number(process.argv[2] ?? 3)));
const room = (process.argv[3] ?? 'TEST').toUpperCase();
const url = process.argv[4] ?? 'ws://127.0.0.1:3100';
// hesitate and blunder: how human they race (see Sloppiness in autopilot.ts)
const BOTS = [
  { name: 'Ava', help: 0.9, push: 0.1, grab: 0.1, hesitate: 0.3, blunder: 0.02 },
  { name: 'Bo', help: 0.15, push: 0.85, grab: 0.35, hesitate: 0.2, blunder: 0.03 },
  { name: 'Cy', help: 0.5, push: 0.5, grab: 0.3, hesitate: 0.35, blunder: 0.04 },
  { name: 'Dee', help: 0.5, push: 0.4, grab: 0.25, hesitate: 0.25, blunder: 0.03 },
];

const SLOPPY: Record<Difficulty, number> = { easy: 1.6, normal: 1, hard: 0.6 };

function startBot(cfg: (typeof BOTS)[number]) {
  const name = `${cfg.name} (bot)`;
  const ws = new WebSocket(url);
  let id = 0;
  let pred: Predictor | null = null;
  let decoder: SnapDecoder | null = null;
  let pilot: Autopilot | null = null;
  let round: RoundInfo | null = null;
  let others: SnapPlayer[] = [];
  let humans: number[] = []; // ids of the players who are not bots
  let viewTick = 0;
  let grabHold = 0; // ticks left to keep holding grab (then let go = throw)
  let holdDoor = 0; // ticks left standing on a door plate for someone behind
  let doorBtn: unknown = null; // which plate
  let lastB = 0;
  let started = 0;
  const decided = new Map<number, boolean>(); // per hanging bean: will I help them?
  let chase: { id: number; until: number } | null = null; // go after someone to shove or grab them
  let outbox: Array<[number, number, number]> = [];

  ws.onopen = () => ws.send(JSON.stringify({ t: 'hello', name, room }));
  ws.onmessage = (e) => {
    const msg = JSON.parse(String(e.data)) as ServerMsg;
    if (msg.t === 'welcome') {
      id = msg.id;
      decoder = new SnapDecoder(id);
      pred = new Predictor(msg.slot, new Course(buildRound('ledge', 0, 'normal')), msg.tick);
      started = performance.now();
      console.log(`${name} joined room ${room}`);
    } else if (msg.t === 'round' && pred) {
      const key = (r: RoundInfo) => `${r.type} ${r.seed} ${r.diff} ${r.index}`;
      if (!round || key(round) !== key(msg)) {
        const level = buildRound(msg.type, msg.seed, msg.diff, msg.index);
        pred.setCourse(new Course(level));
        pref = [];
        // bot skill follows the difficulty (3.4): sloppier on Easy, sharper on Hard
        const k = SLOPPY[msg.diff];
        pilot = new Autopilot(level, pred.slot, { hesitate: cfg.hesitate * k, blunder: cfg.blunder * k });
      }
      round = msg;
      readyUp();
    } else if (msg.t === 'roster') {
      humans = msg.players.filter((p) => !p.name.endsWith('(bot)')).map((p) => p.id);
      readyUp();
    } else if (msg.t === 'snap' && pred) {
      const snap = decoder!.decode(msg);
      if (!snap) return;
      const mine = snap.players.find((p) => p.id === id);
      if (mine) pred.reconcile(mine, snap.ack, snap.at, snap.w);
      others = snap.players.filter((p) => p.id !== id);
      viewTick = msg.tick;
    } else if (msg.t === 'error') {
      console.log(`${name}: ${msg.message}`);
    }
  };
  ws.onclose = () => {
    console.log(`${name} disconnected`);
    clearInterval(timer);
  };

  /** In the lobby, follow the real players: ready up once one of them is. */
  function readyUp() {
    if (round?.phase !== 'lobby' || round.ready.includes(id)) return;
    if (humans.some((h) => round!.ready.includes(h))) setTimeout(() => ws.send(JSON.stringify({ t: 'ready', on: true })), 400);
  }

  /** Press a button only if it was not already held last tick (so it counts as a fresh press). */
  const press = (b: number, bit: number) => (lastB & bit ? b : b | bit);

  /** Helping and hurting. Returns buttons, or null to just race. */
  const social = (seq: number): number | null => {
    const me = pred!.state;
    // someone hanging nearby: decide once whether to help, then go pull them up
    const hanger = others.find((o) => o.hanging && Math.abs(o.x - me.x) < 160 && Math.abs(o.y - me.y) < 90);
    if (hanger && !decided.has(hanger.id)) decided.set(hanger.id, Math.random() < cfg.help);
    for (const k of decided.keys()) if (!others.some((o) => o.id === k && o.hanging)) decided.delete(k);
    if (hanger && decided.get(hanger.id) && !me.holding && me.grounded) {
      const toward = Math.sign(hanger.x - me.x) || 1;
      const dx = (hanger.x - me.x) * toward;
      if (dx > GRAB_RANGE - 10) return toward > 0 ? BTN.right : BTN.left;
      return press(toward > 0 ? BTN.right : BTN.left, BTN.grab);
    }

    // grabbed someone: keep holding grab for a while (from the press on), then let go to throw
    if (grabHold > 0) {
      grabHold--;
      return BTN.right | BTN.grab;
    }

    // doors: a helpful bot holds the plate for someone behind it
    if (round?.phase === 'play') {
      for (const btn of pred!.course.level.gates.flatMap((g) => g.buttons)) {
        if (holdDoor > 0 && doorBtn === btn) { holdDoor--; return onButton(me, btn) ? 0 : me.x < (btn.x0 + btn.x1) / 2 ? BTN.right : BTN.left; }
        const behind = others.some((o) => !o.finished && !o.dead && o.x < btn.x0 && o.x > btn.x0 - 600);
        if (onButton(me, btn) && behind && Math.random() < cfg.help * 0.05) { holdDoor = 180; doorBtn = btn; return 0; }
      }
    }

    // now and then, go after a bean nearby (more often for the meaner bots)
    if (chase && (seq > chase.until || !others.some((o) => o.id === chase!.id && !o.dead && !o.heldBy && !o.finished))) chase = null;
    if (!chase && Math.random() < (cfg.push + cfg.grab) * 0.01) {
      const near = others.filter((o) => !o.dead && !o.heldBy && !o.finished && o.protect <= 0 && Math.abs(o.x - me.x) < 300 && Math.abs(o.y - me.y) < 50);
      if (near.length) chase = { id: near[Math.floor(Math.random() * near.length)].id, until: seq + 120 };
    }
    const target = chase ? others.find((o) => o.id === chase!.id) : undefined;
    if (!target || !me.grounded) return null;
    const runDir = Math.sign(target.x - me.x) || 1;
    const b0 = runDir > 0 ? BTN.right : BTN.left;
    const dx = (target.x - me.x) * runDir;
    if (dx < PUSH_RANGE - 15 && Math.abs(target.y - me.y) < 60 && me.facing === runDir) {
      chase = null;
      if (Math.random() < cfg.push / (cfg.push + cfg.grab) && me.pushCd <= 0) return press(b0, BTN.push);
      if (me.grabCd <= 0) { grabHold = 20 + Math.floor(Math.random() * 50); return press(b0, BTN.grab); }
      return null;
    }
    return b0;
  };

  /** What is under the feet, a step ahead: ground, a hole worth jumping, or the end of the world. */
  const ahead = (me: PlayerState, dir: number): 'ground' | 'hole' | 'end' => {
    const c = pred!.course;
    const boxes = c.layout(pred!.simTick + 1, 2);
    const feet = me.y + HALF_H;
    const under = (x: number, below: number) => boxes.some((b) => b.on && x >= b.x && x <= b.x + b.w && b.top >= feet - 150 && b.top <= feet + below);
    if (under(me.x + dir * 45, 60)) return 'ground';
    for (let d = 90; d <= 330; d += 30) if (under(me.x + dir * d, 160)) return 'hole';
    return 'end';
  };

  /** Mash jump to climb back up. */
  const climb = (seq: number) => (seq % 2 ? BTN.jump : 0);

  /** Hot Plate: stand on the tile of your layer that drops last (each bot leans to its own favourites). */
  let pref: number[] = [];
  const plate = (seq: number): number => {
    const me = pred!.state;
    if (me.hanging) return climb(seq);
    if (!me.grounded) return 0;
    const c = pred!.course;
    const boxes = c.layout(pred!.simTick + 1, 2);
    const feet = me.y + HALF_H;
    let best = -1;
    let score = -Infinity;
    c.level.solids.forEach((s, i) => {
      const b = boxes[i];
      if (!b.on || b.shake > 0 || Math.abs(b.top - feet) > 30) return;
      const v = (s.dropAt ?? 0) - Math.abs(b.x + b.w / 2 - me.x) * 0.5 + (pref[i] ??= Math.random() * 120);
      if (v > score) { score = v; best = i; }
    });
    if (best < 0) return 0;
    const mid = boxes[best].x + boxes[best].w / 2;
    if (Math.abs(mid - me.x) < 18) return 0;
    return mid > me.x ? BTN.right : BTN.left;
  };

  /** Tail Tag: with a tail, keep away from whoever is hunting it; without one, go and grab one. */
  const tag = (seq: number): number => {
    const me = pred!.state;
    if (me.hanging) return climb(seq);
    const live = others.filter((o) => !o.dead && !o.heldBy);
    const nearest = (list: SnapPlayer[]) => list.sort((a, b) => Math.hypot(a.x - me.x, a.y - me.y) - Math.hypot(b.x - me.x, b.y - me.y))[0];
    let dir: number;
    let target: SnapPlayer | undefined;
    if (me.tail) {
      const hunter = nearest(live.filter((o) => !o.tail));
      if (!hunter || Math.hypot(hunter.x - me.x, hunter.y - me.y) > 420) return 0;
      dir = hunter.x > me.x ? -1 : 1;
    } else {
      target = nearest(live.filter((o) => o.tail));
      if (!target) return 0;
      dir = Math.sign(target.x - me.x) || 1;
      if (Math.abs(target.x - me.x) < GRAB_RANGE - 10 && Math.abs(target.y - me.y) < 60 && me.grabCd <= 0) {
        return me.facing === dir ? press(0, BTN.grab) : dir > 0 ? BTN.right : BTN.left;
      }
    }
    const road = me.grounded ? ahead(me, dir) : 'ground';
    if (road === 'end') return 0; // cornered: nowhere to go but the pit
    let b = dir > 0 ? BTN.right : BTN.left;
    const above = target && target.y < me.y - 80 && Math.abs(target.x - me.x) < 220;
    if (me.grounded && (road === 'hole' || above || Math.random() < 0.004)) b |= BTN.jump;
    else if (!me.grounded && me.vy < 0) b |= BTN.jump; // hold it for the full height
    return b;
  };

  const think = (seq: number): number => {
    const me = pred!.state;
    if (!round || !pilot || me.dead || me.heldBy || me.finished) return 0;
    if (me.holding && grabHold <= 0) return BTN.right; // let go: throw
    const mode = pred!.course.level.mode;
    if (mode === 'hunt') return round.phase === 'play' ? tag(seq) : 0;
    if (mode === 'survival') return social(seq) ?? plate(seq);
    return social(seq) ?? pilot.next(me, pred!.course.world, pred!.simTick + 1);
  };

  const timer = setInterval(() => {
    if (!started || !pred || ws.readyState !== WebSocket.OPEN) return;
    let due = Math.floor((performance.now() - started) / (DT * 1000));
    // after a stall, skip the lost time like the browser does, instead of a burst the server would kick us for
    if (due - pred.seq > 15) { started += (due - pred.seq - 15) * DT * 1000; due = pred.seq + 15; }
    while (pred.seq + 1 < due) {
      const b = think(pred.seq + 1);
      lastB = b;
      const { seq } = pred.tick(b);
      outbox.push([seq, b, viewTick]);
      if (outbox.length >= 2) { ws.send(JSON.stringify({ t: 'input', i: outbox })); outbox = []; }
    }
  }, 5);
}

for (let i = 0; i < count; i++) setTimeout(() => startBot(BOTS[i]), i * 300);
