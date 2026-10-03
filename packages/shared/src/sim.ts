// One bean for one tick. The server runs this to decide what really happened;
// the browser runs the exact same code to predict your own bean, so pressing a key feels instant.
// It must stay deterministic: same state + same input + same tick = same result, on every machine.
//
// The tick matters because obstacles move: step() asks the Course where everything is at that tick.
//
// Anything involving a second bean (who gets shoved, grabbed, thrown or pulled up) is decided by the
// server. step() only reports that you tried (the INTENT bits); the room does the rest.
import {
  AIR_BLEND, APEX_HANG, BAR_REACH, BAR_STUN, BAR_VX, BAR_VY, BOOST_SPEED, CLIMB_PRESSES, CLIMB_PROTECT, COYOTE,
  DIVE_TIME, DIVE_VX, DOUBLE_JUMP, DT, FALL_MULT, GRAB_CD, GRAVITY, GROUND_BLEND, HALF_H, HALF_W, HAMMER_STUN,
  HAMMER_VX, HAMMER_VY, HANG_TIME, HAZARD_CD, HOLD_MAX, HOLD_SPEED, JUMP_BUFFER, JUMP_CUT, JUMP_V, KO_Y, MAX_FALL,
  PAD_V, PROTECT_TIME, PUSH_CD, RESPAWN_DELAY, RUN_SPEED, SLIDE_KEEP, THROW_CD, TICK_RATE,
} from './constants.ts';
import type { Level, Rect } from './level.ts';
import { FAKE_RESET, FALL_RESET, trigAge, type Box, type Course } from './world.ts';

// Buttons held during a tick, packed into one number. Presses are worked out from `prev`.
export const BTN = { left: 1, right: 2, jump: 4, dive: 8, grab: 16, push: 32 } as const;
export const BTN_MASK = 63;

// What step() reports back to the room.
export const INTENT = { push: 1, grab: 2, throw: 4, died: 8, climbed: 16, finished: 32, hit: 64 } as const;

export const SPAWN_SPACING = 55;

export interface PlayerState {
  x: number; // body center
  y: number;
  vx: number;
  vy: number;
  facing: number; // 1 or -1
  grounded: boolean;
  plat: number; // index of the solid you stand on, -1 in the air
  coyote: number;
  jumpBuf: number;
  airJumps: number;
  canCut: boolean;
  diving: boolean;
  diveT: number;
  prev: number; // buttons held last tick
  dead: boolean;
  respawnT: number;
  cp: number; // last checkpoint reached
  // help and hurt
  stun: number;
  pushCd: number;
  grabCd: number;
  protect: number; // can't be shoved or grabbed while > 0
  grabImmune: number;
  ledgeCd: number;
  hanging: boolean;
  hangPlat: number;
  hangSide: number; // 1 = hanging off the right edge, -1 = the left edge
  hangT: number;
  climb: number;
  holding: number; // id of the bean you carry, 0 = none
  heldBy: number; // id of the bean carrying you, 0 = none
  holdT: number;
  lastHitBy: number; // who gets the knockout if you fall now (0 = nobody)
  hitCredit: number; // seconds left on that credit
  thrownBy: number;
  thrownT: number;
  thrownX: number;
  thrownPlat: number;
  // rounds
  hitCd: number; // obstacle hit cooldown
  boost: boolean; // catch-up boost (last place, far behind); set by the server
  finished: boolean; // crossed the finish line this round
  out: boolean; // knocked out of a survival round (stays dead until the next round)
  tail: boolean; // Tail Tag: holding a tail (set by the server)
}

export function spawnPoint(level: Level, cp: number, slot: number) {
  const c = level.checkpoints[cp] ?? level.checkpoints[0];
  return { x: c.sx + slot * SPAWN_SPACING, y: c.sy };
}

export function newPlayer(level: Level, slot: number): PlayerState {
  const s = spawnPoint(level, 0, slot);
  return {
    x: s.x, y: s.y, vx: 0, vy: 0, facing: 1, grounded: false, plat: -1,
    coyote: 0, jumpBuf: 0, airJumps: 1, canCut: false, diving: false, diveT: 0,
    prev: 0, dead: false, respawnT: 0, cp: 0,
    stun: 0, pushCd: 0, grabCd: 0, protect: PROTECT_TIME, grabImmune: 0, ledgeCd: 0,
    hanging: false, hangPlat: -1, hangSide: 0, hangT: 0, climb: 0,
    holding: 0, heldBy: 0, holdT: 0, lastHitBy: 0, hitCredit: 0,
    thrownBy: 0, thrownT: 0, thrownX: 0, thrownPlat: -1,
    hitCd: 0, boost: false, finished: false, out: false, tail: false,
  };
}

export function clonePlayer(p: PlayerState): PlayerState {
  return { ...p };
}

const overlaps = (x: number, y: number, r: Rect) =>
  x + HALF_W > r.x && x - HALF_W < r.x + r.w && y + HALF_H > r.top && y - HALF_H < r.top + r.h;

const down = (t: number) => (t > DT ? t - DT : 0);
const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);

// ---------- ledges ----------

function hangPos(p: PlayerState, r: Rect) {
  return {
    x: p.hangSide > 0 ? r.x + r.w + HALF_W + 1 : r.x - HALF_W - 1,
    y: r.top - 10 + HALF_H,
  };
}

function tryHang(p: PlayerState, level: Level, solids: Box[]): void {
  for (let i = 0; i < solids.length; i++) {
    const r = solids[i];
    if (!r.on || !level.solids[i].ledge) continue;
    for (const side of [-1, 1]) {
      const edge = side > 0 ? r.x + r.w : r.x;
      const inner = side > 0 ? p.x - HALF_W : p.x + HALF_W;
      const d = (inner - edge) * side; // how far outside the edge the bean is
      if (d < -4 || d > 16) continue;
      const top = p.y - HALF_H;
      if (top < r.top - 8 || top > r.top + 20) continue;
      const hx = side > 0 ? r.x + r.w + HALF_W + 1 : r.x - HALF_W - 1;
      if (hx < HALF_W || hx > level.width - HALF_W) continue; // no ledge at the edge of the world
      if (solids.some((o) => o.on && overlaps(hx, r.top - 10 + HALF_H, o))) continue; // edge is against a wall
      p.hanging = true;
      p.hangPlat = i;
      p.hangSide = side;
      p.hangT = HANG_TIME;
      p.climb = 0;
      p.diving = false;
      p.stun = 0;
      p.facing = -side;
      p.vx = 0; p.vy = 0;
      const pos = hangPos(p, r);
      p.x = pos.x; p.y = pos.y;
      return;
    }
  }
}

/** Climb onto the platform you are hanging from (alone, or pulled up by a friend). `r` is that platform. */
export function climbUp(p: PlayerState, r: Rect): void {
  p.hanging = false;
  p.x = p.hangSide > 0 ? r.x + r.w - 22 : r.x + 22;
  p.y = r.top - HALF_H - 2;
  p.vx = 0; p.vy = 0;
  p.ledgeCd = 0.5;
  p.protect = Math.max(p.protect, CLIMB_PROTECT);
}

/** Let go of the ledge (timer ran out, or someone shoved you off). */
export function dropLedge(p: PlayerState, vx: number, vy: number): void {
  p.hanging = false;
  p.vx = vx; p.vy = vy;
  p.ledgeCd = 0.8;
}

// ---------- obstacles ----------

function knock(p: PlayerState, dir: number, vx: number, vy: number, stun: number): void {
  p.vx = dir * vx;
  p.vy = -vy;
  p.stun = stun;
  p.diving = false;
  p.canCut = false;
  p.airJumps = 0;
  p.grounded = false;
  p.plat = -1;
  p.hitCd = HAZARD_CD;
}

/** Hammers and rotating bars. Returns true if one hit the bean. */
function hazards(p: PlayerState, c: Course, t: number): boolean {
  const lv = c.level;
  for (let i = 0; i < lv.hammers.length; i++) {
    const h = c.hammer(i, t);
    const r = lv.hammers[i].r;
    const cx = clamp(h.x, p.x - HALF_W, p.x + HALF_W);
    const cy = clamp(h.y, p.y - HALF_H, p.y + HALF_H);
    if ((h.x - cx) ** 2 + (h.y - cy) ** 2 > r * r) continue;
    const dir = Math.abs(h.swing) > 0.15 ? Math.sign(h.swing) : p.x >= h.x ? 1 : -1;
    knock(p, dir, HAMMER_VX, HAMMER_VY, HAMMER_STUN);
    return true;
  }
  for (let i = 0; i < lv.bars.length; i++) {
    const b = lv.bars[i];
    const a = c.barAngle(i, t);
    const ux = Math.cos(a), uy = Math.sin(a);
    const s = clamp((p.x - b.cx) * ux + (p.y - b.cy) * uy, -b.len, b.len);
    const qx = b.cx + ux * s, qy = b.cy + uy * s; // the point of the bar closest to the bean
    if ((p.x - qx) ** 2 + (p.y - qy) ** 2 > BAR_REACH * BAR_REACH) continue;
    const vx = -b.speed * (qy - b.cy); // sideways speed of that point
    const dir = Math.abs(vx) > 20 ? Math.sign(vx) : p.x >= qx ? 1 : -1;
    knock(p, dir, BAR_VX, BAR_VY, BAR_STUN);
    return true;
  }
  return false;
}

/** A solid moved into the bean (a closing gate, a moving platform): push the bean out the shortest way. */
function pushOut(p: PlayerState, c: Course, solids: Box[]): void {
  for (let i = 0; i < solids.length; i++) {
    const r = solids[i];
    if (!r.on || !overlaps(p.x, p.y, r)) continue;
    const left = r.x - HALF_W - p.x;
    const right = r.x + r.w + HALF_W - p.x;
    const up = r.top - HALF_H - p.y;
    const below = r.top + r.h + HALF_H - p.y;
    const side = Math.abs(left) < Math.abs(right) ? left : right;
    if (c.level.solids[i].kind === 'gate') { p.x += side; continue; } // doors push you sideways, never down
    const vert = !p.grounded && Math.abs(below) < Math.abs(up) ? below : up;
    if (Math.abs(side) < Math.abs(vert)) p.x += side;
    else p.y += vert;
  }
}

// ---------- one tick ----------

/**
 * Advance one bean by one tick of the course `c`, at world tick `t`. Mutates `p` (and marks platforms it
 * steps on in c.world). Returns INTENT bits for the room to act on.
 */
export function step(p: PlayerState, buttons: number, slot: number, c: Course, t: number): number {
  const lv = c.level;
  const w = c.world;
  // before the start (and after the finish) your buttons do nothing
  const held = t < w.lock || p.finished ? 0 : buttons & BTN_MASK;
  const pressed = held & ~p.prev;
  p.prev = held;
  p.pushCd = down(p.pushCd); p.grabCd = down(p.grabCd); p.protect = down(p.protect);
  p.grabImmune = down(p.grabImmune); p.ledgeCd = down(p.ledgeCd); p.stun = down(p.stun);
  p.hitCredit = down(p.hitCredit); p.thrownT = down(p.thrownT); p.hitCd = down(p.hitCd);
  if (p.hitCredit === 0) p.lastHitBy = 0;
  if (p.finished) p.protect = Math.max(p.protect, 0.5); // done racing: nobody can touch you

  if (p.dead) {
    if (p.out) return 0; // knocked out of a survival round: watching until it ends
    p.respawnT -= DT;
    if (p.respawnT <= 0) {
      const s = spawnPoint(lv, p.cp, slot);
      p.x = s.x; p.y = s.y; p.vx = 0; p.vy = 0;
      p.dead = false; p.grounded = false; p.plat = -1; p.airJumps = 1;
      p.diving = false; p.canCut = false; p.coyote = 0; p.jumpBuf = 0;
      p.protect = PROTECT_TIME;
    }
    return 0;
  }
  if (p.heldBy) return 0; // the room carries you around

  const now = c.layout(t, 0);
  const next = c.layout(t + 1, 1);

  if (p.hanging) {
    const r = next[p.hangPlat];
    if (!r.on || r.top !== now[p.hangPlat].top) {
      dropLedge(p, 0, 0); // the ledge itself is falling away
      return 0;
    }
    const pos = hangPos(p, r);
    p.x = pos.x; p.y = pos.y; p.vx = 0; p.vy = 0;
    p.grounded = false; p.plat = -1;
    p.hangT -= DT;
    if (pressed & BTN.jump && ++p.climb >= CLIMB_PRESSES) {
      climbUp(p, next[p.hangPlat]);
      return INTENT.climbed;
    }
    if (p.hangT <= 0) dropLedge(p, p.hangSide * 60, 80);
    return 0;
  }

  let intent = 0;

  // ride whatever you stand on (moving platform, seesaw, falling platform), and get carried by belts.
  // Stick to its top, so a platform going down never leaves you floating for a tick.
  if (p.grounded && p.plat >= 0) {
    const a = now[p.plat], b = next[p.plat];
    if (b.on) { p.x += b.x - a.x; p.y = b.top - HALF_H; }
    const belt = lv.solids[p.plat].belt;
    if (belt) p.x += belt * DT;
  }
  pushOut(p, c, next);

  const onGround = p.grounded;
  p.coyote = onGround ? COYOTE : p.coyote - DT;
  if (onGround && p.stun <= 0) p.airJumps = 1; // landing recharges the double jump (not while reeling from a hit)

  const jumpHeld = (held & BTN.jump) !== 0;
  let gMul = 1;
  if (p.vy > 0) gMul = FALL_MULT;
  else if (!onGround && Math.abs(p.vy) < 90 && jumpHeld) gMul = APEX_HANG;

  const dir = (held & BTN.right ? 1 : 0) - (held & BTN.left ? 1 : 0);
  const canControl = p.stun <= 0 && !p.diving;
  p.jumpBuf = pressed & BTN.jump ? JUMP_BUFFER : p.jumpBuf - DT;

  if (canControl) {
    if (dir) p.facing = dir;
    const speed = RUN_SPEED * (p.holding ? HOLD_SPEED : 1) * (p.boost ? BOOST_SPEED : 1);
    p.vx += (dir * speed - p.vx) * (onGround ? GROUND_BLEND : AIR_BLEND);
    if (p.jumpBuf > 0 && p.coyote > 0) {
      p.vy = -JUMP_V;
      p.coyote = 0;
      p.jumpBuf = 0;
      p.canCut = true;
    } else if (pressed & BTN.jump && !onGround && p.airJumps > 0 && DOUBLE_JUMP > 0) {
      p.airJumps -= 1;
      p.vy = -JUMP_V * DOUBLE_JUMP;
      p.jumpBuf = 0;
      p.canCut = true;
    }
    if (pressed & BTN.dive && !p.holding) {
      p.diving = true;
      p.diveT = DIVE_TIME;
      p.canCut = false;
      p.vx = p.facing * DIVE_VX;
      p.vy = onGround ? -420 : Math.min(p.vy, -250);
    }
    if (pressed & BTN.push && p.pushCd <= 0) {
      p.pushCd = PUSH_CD;
      intent |= INTENT.push;
    }
    if (pressed & BTN.grab && p.grabCd <= 0 && !p.holding) {
      p.grabCd = GRAB_CD;
      intent |= INTENT.grab;
    }
  } else {
    if (onGround) p.vx *= SLIDE_KEEP;
    if (p.diving) {
      p.diveT -= DT;
      if (p.diveT <= 0 && onGround) p.diving = false;
    }
  }

  // carrying someone: let go of grab (or hold too long) and you throw them
  if (p.holding) {
    p.holdT += DT;
    if (!(held & BTN.grab) || p.holdT > HOLD_MAX) {
      p.holding = 0;
      p.grabCd = THROW_CD;
      intent |= INTENT.throw;
    }
  }

  // fans blow you sideways while they are on
  for (let i = 0; i < lv.fans.length; i++) {
    const f = lv.fans[i];
    if (overlaps(p.x, p.y, f) && c.fanOn(i, t)) p.vx += f.push * DT;
  }

  // variable jump height: let go early while rising and the jump is cut short
  if (p.canCut && !jumpHeld && p.vy < 0) {
    p.vy *= JUMP_CUT;
    p.canCut = false;
  }
  if (p.vy >= 0) p.canCut = false;

  p.vy = Math.min(p.vy + GRAVITY * gMul * DT, MAX_FALL);

  // move on x, push out of walls
  p.x += p.vx * DT;
  for (const r of next) {
    if (!r.on || !overlaps(p.x, p.y, r)) continue;
    if (p.vx > 0) p.x = r.x - HALF_W;
    else if (p.vx < 0) p.x = r.x + r.w + HALF_W;
    p.vx = 0;
  }
  if (p.x < HALF_W) { p.x = HALF_W; p.vx = 0; }
  if (p.x > lv.width - HALF_W) { p.x = lv.width - HALF_W; p.vx = 0; }

  // move on y, land or bump your head
  p.y += p.vy * DT;
  p.grounded = false;
  p.plat = -1;
  for (let i = 0; i < next.length; i++) {
    const r = next[i];
    if (!r.on || !overlaps(p.x, p.y, r)) continue;
    if (p.vy > 0) {
      p.y = r.top - HALF_H;
      p.grounded = true;
      p.plat = i;
    } else if (p.vy < 0) {
      p.y = r.top + r.h + HALF_H;
    }
    p.vy = 0;
  }

  // bounce pads: mostly straight up
  for (const pad of lv.pads) {
    if (p.grounded && p.y + HALF_H === pad.top && p.x > pad.x0 && p.x < pad.x1) {
      p.vy = -PAD_V;
      p.vx = Math.max(-150, Math.min(150, p.vx));
      p.grounded = false;
      p.plat = -1;
    }
  }

  if (p.grounded) {
    // stepping on a falling platform or a fake tile sets it off
    const kind = lv.solids[p.plat].kind;
    if (kind === 'falling' && trigAge(w, p.plat, t, FALL_RESET) < 0) w.trig[p.plat] = t;
    if (kind === 'fake' && trigAge(w, p.plat, t, FAKE_RESET) < 0) w.trig[p.plat] = t;
    // checkpoints count once you stand past them
    for (let i = lv.checkpoints.length - 1; i > p.cp; i--) {
      if (p.x > lv.checkpoints[i].x + 20) { p.cp = i; break; }
    }
  }

  if (p.hitCd <= 0 && !p.finished && hazards(p, c, t)) intent |= INTENT.hit;

  // falling past a platform edge: grab the ledge
  if (!p.grounded && p.vy > 0 && p.ledgeCd <= 0 && !p.holding) tryHang(p, lv, next);

  if (w.racing && !p.finished && lv.finishX > 0 && p.x >= lv.finishX) {
    p.finished = true;
    intent |= INTENT.finished;
  }

  if (p.y > KO_Y) {
    p.dead = true;
    p.respawnT = RESPAWN_DELAY;
    p.vx = 0; p.vy = 0;
    p.holding = 0;
    p.hanging = false;
    p.diving = false;
    p.stun = 0;
    intent |= INTENT.died;
  }
  return intent;
}

/** Seconds to ticks, for code that counts in ticks. */
export const ticks = (sec: number) => Math.round(sec * TICK_RATE);
