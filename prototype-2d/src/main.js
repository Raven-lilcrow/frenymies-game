// Frenymies: 2D side-view prototype (throwaway, local only, no server).
// Purpose: see the look, the shared camera and the help-or-hurt moves.
// Every bean is driven by an input object ({left, right, jump, ...}), the same
// shape the real game will send to the server, so bots and humans share one code path.
import Phaser from 'phaser';

// ---- Tunables (the numbers we would playtest) ----
const WORLD_W = 4300;
const WORLD_H = 1100;
const KO_Y = WORLD_H + 60;
// Jump is defined by feel (height + time to the top); gravity and speed are derived from it.
const JUMP_HEIGHT = 150;
const APEX_TIME = 0.36;
const GRAVITY = (2 * JUMP_HEIGHT) / (APEX_TIME * APEX_TIME); // ~2315, rising gravity
const JUMP_V = (2 * JUMP_HEIGHT) / APEX_TIME; // ~833
const FALL_MULT = 1.6; // falling is heavier than rising, so jumps don't feel floaty
const APEX_HANG = 0.55; // gravity near the top while jump is held, for a bit of air control
const JUMP_CUT = 0.45; // letting go of jump early cuts the rise: tap = hop, hold = full jump
const COYOTE = 0.1; // can still jump this long after running off a ledge
const JUMP_BUFFER = 0.12; // a jump pressed this long before landing still counts
const DOUBLE_JUMP = 0.85; // strength of the mid-air second jump (0 turns it off)
const RUN_SPEED = 360;
const PAD_V = 1180;
const DIVE_VX = 580;
const PUSH_VX = 700;
const PUSH_VY = 430;
const PUSH_CD = 1.2;
const PUSH_RANGE = 72;
const GRAB_RANGE = 70;
const THROW_VX = 720;
const THROW_VY = 700;
const HOLD_MAX = 1.8;
const HANG_TIME = 2.5;
const CLIMB_PRESSES = 6;
const RESPAWN_DELAY = 1.6;
const PROTECT_TIME = 1.5;
const KARMA_SAVE_COST = 3;
const HIT_CREDIT_WINDOW = 4; // seconds a shove/throw still counts toward a knockout
const ROUND_TIME = 100;
const QUALIFY = 3;
const FINISH_X = 3950;

// Feedback strength by importance: hurts shake and freeze the screen, helps never do.
const FEEL = {
  small: { trauma: 0.15, stop: 0 },
  medium: { trauma: 0.38, stop: 0.06 },
  large: { trauma: 0.65, stop: 0.11 },
};

const FONT = 'Segoe UI, Inter, system-ui, sans-serif';
const COL = {
  bg: 0x1f2229,
  plat: 0x3a3f4b,
  platTop: 0x5a6172,
  hazard: 0xe8594a,
  pad: 0x7c6cf0,
  flag: 0xe9e9e9,
  text: '#e9e9e9',
  dim: '#8b93a3',
  good: '#7fd48a',
  bad: '#ff7a6b',
};
const hex = (n) => '#' + n.toString(16).padStart(6, '0');

const PLAYERS = [
  { name: 'You', color: 0xf2b134, human: 1 },
  { name: 'Ava', role: 'saint bot', color: 0x4fb3bf, bot: { help: 0.9, push: 0.1, grab: 0.1, mash: 3.4 } },
  { name: 'Bo', role: 'traitor bot', color: 0xe0607e, bot: { help: 0.15, push: 0.85, grab: 0.35, mash: 2.8 } },
  { name: 'Cy', role: 'chaos bot', color: 0x8bc34a, bot: { help: 0.5, push: 0.5, grab: 0.3, mash: 2.3 } },
];

// ---- Level: Ledge Run. [left x, top y, width, height] ----
const STATIC_PLATS = [
  [0, 800, 700, 300], // start
  [820, 760, 180, 40],
  [1110, 710, 160, 40],
  [1380, 760, 200, 40],
  [1680, 800, 360, 300], // hammer platform
  [2600, 780, 360, 320], // bounce pad platform
  [2960, 560, 260, 540], // tall block, reach it with the pad
  [3380, 700, 220, 40],
  [3760, 700, 540, 400], // finish
];
const MOVER = { minX: 2090, maxX: 2410, top: 780, w: 170, speed: 150 };
const PAD = { x0: 2860, x1: 2940, top: 780 };
const PENDULUM = { px: 1860, py: 500, len: 272, amp: 1.05, speed: 1.9, r: 30 };
const CHECKPOINTS = [
  { x: 0, sx: 150, sy: 740 },
  { x: 1680, sx: 1720, sy: 740 },
  { x: 2600, sx: 2650, sy: 720 },
  { x: 2960, sx: 3020, sy: 500 },
];

const NO_INPUT = { left: false, right: false, jump: false, jumpHeld: false, dive: false, grabPressed: false, grabDown: false, push: false };

class PlayScene extends Phaser.Scene {
  constructor() {
    super('play');
  }

  init() {
    this.state = 'countdown';
    this.countdown = 3;
    this.timeLeft = ROUND_TIME;
    this.finishOrder = [];
    this.feed = [];
    this.beans = [];
    this.clock = 0;
    this.playStartedAt = 0;
    this.targetBean = null;
    this.results = null;
    this.trauma = 0;
    this.shakeT = 0;
    this.hitStop = 0;
    if (this.shakeOn === undefined) this.shakeOn = true; // kept across restarts
  }

  create() {
    this.makeTextures();
    if (this.physics.world.isPaused) this.physics.resume(); // in case R was pressed mid hit-stop
    this.cameras.main.setBackgroundColor(COL.bg);
    this.cameras.main.setBounds(0, 0, WORLD_W, WORLD_H);
    this.physics.world.setBounds(0, -2000, WORLD_W, WORLD_H + 3000);

    // Platforms
    this.platforms = [];
    for (const [x, top, w, h] of STATIC_PLATS) {
      const r = this.add.rectangle(x + w / 2, top + h / 2, w, h, COL.plat);
      this.physics.add.existing(r, true);
      this.platforms.push(r);
      this.add.rectangle(x + w / 2, top + 3, w, 6, COL.platTop);
    }
    this.mover = this.add.rectangle(MOVER.minX + MOVER.w / 2, MOVER.top + 10, MOVER.w, 20, COL.plat);
    this.physics.add.existing(this.mover);
    this.mover.body.setAllowGravity(false).setImmovable(true).setVelocityX(MOVER.speed);
    this.moverTop = this.add.rectangle(0, 0, MOVER.w, 6, COL.platTop);

    // Bounce pad, flags, finish line
    this.padRect = this.add.rectangle((PAD.x0 + PAD.x1) / 2, PAD.top, PAD.x1 - PAD.x0, 10, COL.pad).setOrigin(0.5, 1);
    this.add.text((PAD.x0 + PAD.x1) / 2, PAD.top - 16, 'BOUNCE', { fontFamily: FONT, fontSize: '12px', color: hex(COL.pad) }).setOrigin(0.5, 1);
    CHECKPOINTS.slice(1).forEach((cp) => {
      const top = STATIC_PLATS.find((p) => p[0] === cp.x)[1];
      this.add.rectangle(cp.x + 30, top - 35, 3, 70, COL.flag);
      this.add.rectangle(cp.x + 44, top - 62, 26, 16, COL.flag);
    });
    this.add.rectangle(FINISH_X, 700 - 90, 8, 180, COL.flag);
    this.add.text(FINISH_X + 16, 700 - 170, 'FINISH', { fontFamily: FONT, fontSize: '28px', fontStyle: 'bold', color: COL.text });

    // Pendulum hammer
    this.pend = { ...PENDULUM, t: 0, angle: 0, omega: 0, hx: 0, hy: 0 };
    this.add.rectangle(PENDULUM.px, PENDULUM.py - 6, 90, 12, COL.platTop);
    this.pendArm = this.add.graphics();
    this.pendHead = this.add.circle(0, 0, PENDULUM.r, COL.hazard);

    // Beans
    PLAYERS.forEach((p, i) => this.beans.push(this.makeBean(p, i)));
    const sprites = this.beans.map((b) => b.s);
    this.physics.add.collider(sprites, this.platforms);
    this.physics.add.collider(sprites, this.mover);
    this.physics.add.collider(sprites, sprites, null, (a, c) => {
      const A = a.bean, B = c.bean;
      return !(A.heldBy || B.heldBy || A.hanging || B.hanging || A.dead || B.dead);
    });

    this.keys = this.input.keyboard.addKeys('W,A,D,SPACE,SHIFT,E,F,I,J,L,U,O,K,R,H,TWO');
    this.camX = 600;
    this.camY = 600;
    this.camZ = 0.9;

    if (!this.scene.isActive('ui')) this.scene.launch('ui');
    window.__play = this;
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

  makeBean(p, i) {
    const cp = CHECKPOINTS[0];
    const s = this.physics.add.sprite(cp.sx + i * 55, cp.sy, 'bean');
    s.setVisible(false).setCollideWorldBounds(true); // physics only; `view` is what you see
    s.body.setSize(30, 40);
    // Separate visual, anchored at the feet, so squash & stretch never changes the hitbox.
    const view = this.add.image(s.x, s.y + 22, 'bean').setOrigin(0.5, 1).setTint(p.color).setDepth(10);
    const label = this.add.text(0, 0, p.name, { fontFamily: FONT, fontSize: '14px', color: hex(p.color) }).setOrigin(0.5, 1).setDepth(20);
    const mark = this.add.text(0, 0, '', { fontFamily: FONT, fontSize: '13px', fontStyle: 'bold', color: COL.bad }).setOrigin(0.5, 1).setDepth(20);
    const b = {
      id: i, name: p.name, role: p.role || '', color: p.color, human: p.human || 0,
      botCfg: p.bot || null, bot: p.bot ? this.freshBotState() : null,
      s, view, label, mark,
      facing: 1, coyote: 0, stun: 0, diving: false, diveT: 0,
      jumpBuf: 0, canCut: false, grounded: true, airVy: 0, stepT: 0, airJumps: 1, spinT: 0,
      pushCd: 0, grabCd: 0, hitCd: 0, holding: null, heldBy: null, holdT: 0,
      hanging: false, ledge: null, hangT: 0, climb: 0, ledgeCd: 0,
      dead: false, respawnT: 0, respawnAt: null, protect: 0,
      cp: 0, lastSafe: { x: cp.sx, y: cp.sy }, lastHit: null,
      karma: 0, bounty: 0, saves: 0, kos: 0, falls: 0,
      finished: false, place: 0,
    };
    s.bean = b;
    return b;
  }

  freshBotState() {
    return { bestX: 0, progressT: 0, backT: 0, waitT: 0, socialCd: 1, mashT: 0, holdPlan: 0.5 };
  }

  // ---------- main loop ----------
  update(time, delta) {
    const dt = Math.min(delta / 1000, 0.05);
    const JD = Phaser.Input.Keyboard.JustDown;
    if (JD(this.keys.R)) {
      this.scene.restart();
      return;
    }
    if (JD(this.keys.TWO)) this.toggleP2();
    if (JD(this.keys.H)) {
      this.shakeOn = !this.shakeOn;
      this.log(`Screen shake ${this.shakeOn ? 'on' : 'off'}`, COL.text);
    }

    // Shake decays in real time; hit-stop freezes the simulation but keeps drawing.
    this.trauma = Math.max(0, this.trauma - 1.6 * dt);
    this.shakeT += dt;
    if (this.hitStop > 0) {
      this.hitStop -= dt;
      if (!this.physics.world.isPaused) this.physics.pause();
      this.updateVisuals();
      this.updateCamera(dt);
      return; // key presses stay queued and land right after the freeze
    }
    if (this.physics.world.isPaused) this.physics.resume();
    this.clock += dt;

    if (this.state === 'countdown') {
      this.countdown -= dt;
      if (this.countdown <= 0) {
        this.state = 'play';
        this.playStartedAt = this.clock;
      }
    } else if (this.state === 'play') {
      this.timeLeft -= dt;
      if (this.timeLeft <= 0) this.endRound();
    }

    this.updateMover();
    this.updatePendulum(dt);

    for (const b of this.beans) {
      let inp = b.human ? this.humanInput(b) : NO_INPUT; // always read keys so presses don't buffer
      if (this.state !== 'play' || b.finished) inp = NO_INPUT;
      else if (!b.human) inp = this.botInput(b, dt);
      this.stepBean(b, inp, dt);
    }
    this.checkWorld();
    this.updateTarget();
    this.updateVisuals();
    this.updateCamera(dt);
  }

  humanInput(b) {
    const k = this.keys;
    const JD = Phaser.Input.Keyboard.JustDown;
    if (b.human === 1) {
      const w = JD(k.W), sp = JD(k.SPACE);
      return { left: k.A.isDown, right: k.D.isDown, jump: w || sp, jumpHeld: k.W.isDown || k.SPACE.isDown, dive: JD(k.SHIFT), grabPressed: JD(k.E), grabDown: k.E.isDown, push: JD(k.F) };
    }
    return { left: k.J.isDown, right: k.L.isDown, jump: JD(k.I), jumpHeld: k.I.isDown, dive: JD(k.K), grabPressed: JD(k.U), grabDown: k.U.isDown, push: JD(k.O) };
  }

  toggleP2() {
    const b = this.beans[2];
    if (b.human) {
      b.human = 0;
      b.name = PLAYERS[2].name;
      b.role = PLAYERS[2].role;
      b.bot = this.freshBotState();
    } else {
      b.human = 2;
      b.name = 'P2';
      b.role = 'J/L I K O U';
    }
    b.label.setText(b.name);
    this.log(b.human ? 'Player 2 joined (J/L move, I jump, K dive, O shove, U grab)' : 'Player 2 left, bot took over', COL.text);
  }

  // ---------- one bean, one step ----------
  stepBean(b, inp, dt) {
    b.pushCd -= dt; b.grabCd -= dt; b.protect -= dt; b.ledgeCd -= dt; b.stun -= dt; b.hitCd -= dt;
    if (b.spinT > 0) {
      b.spinT -= dt;
      if (b.spinT <= 0) b.view.rotation = 0; // spin finished: settle upright without unwinding
    }
    const body = b.s.body;

    if (b.dead) {
      b.respawnT -= dt;
      if (b.respawnT <= 0) this.respawn(b);
      return;
    }
    if (b.heldBy) {
      const h = b.heldBy;
      body.reset(h.s.x + h.facing * 34, h.s.y - 12);
      return;
    }
    if (b.hanging) {
      this.stepHanging(b, inp, dt);
      return;
    }

    const onGround = body.blocked.down || body.touching.down;
    b.coyote = onGround ? COYOTE : b.coyote - dt;
    if (body.blocked.down) b.lastSafe = { x: b.s.x, y: b.s.y - 4 };

    // landing event (for squash + dust), measured by how fast we were falling
    if (!onGround) b.airVy = Math.max(b.airVy, body.velocity.y);
    if (onGround && !b.grounded && b.airVy > 250) this.onLand(b, b.airVy);
    if (onGround) {
      b.airVy = 0;
      if (b.stun <= 0) b.airJumps = 1; // landing recharges the double jump (not while reeling from a hit)
    }
    b.grounded = onGround;

    // asymmetric gravity: heavier fall, a small hang at the top while jump is held
    const vy = body.velocity.y;
    let gMul = 1;
    if (vy > 0) gMul = FALL_MULT;
    else if (!onGround && Math.abs(vy) < 90 && inp.jumpHeld) gMul = APEX_HANG;
    body.setGravityY(GRAVITY * (gMul - 1));

    if (b.finished) {
      body.velocity.x *= Math.exp(-6 * dt);
      if (onGround && Math.random() < dt * 1.2) {
        body.velocity.y = -500; // celebration hop
        this.squash(b, 0.8, 1.2);
      }
      return;
    }

    const dir = (inp.right ? 1 : 0) - (inp.left ? 1 : 0);
    const canControl = b.stun <= 0 && !b.diving;
    b.jumpBuf = inp.jump ? JUMP_BUFFER : b.jumpBuf - dt;
    if (canControl) {
      if (dir) b.facing = dir;
      const target = dir * RUN_SPEED * (b.holding ? 0.55 : 1);
      const rate = onGround ? 16 : 6;
      body.velocity.x += (target - body.velocity.x) * (1 - Math.exp(-rate * dt));
      if (b.jumpBuf > 0 && b.coyote > 0) {
        body.velocity.y = -JUMP_V;
        b.coyote = 0;
        b.jumpBuf = 0;
        b.canCut = true;
        this.onJump(b);
      } else if (inp.jump && !onGround && b.airJumps > 0 && DOUBLE_JUMP > 0) {
        // double jump: a fresh press in the air
        b.airJumps -= 1;
        body.velocity.y = -JUMP_V * DOUBLE_JUMP;
        b.jumpBuf = 0;
        b.canCut = true;
        this.onDoubleJump(b);
      }
      if (inp.dive && !b.holding) {
        b.diving = true;
        b.diveT = 0.55;
        b.canCut = false;
        body.velocity.x = b.facing * DIVE_VX;
        body.velocity.y = onGround ? -420 : Math.min(body.velocity.y, -250);
        this.squash(b, 1.3, 0.75);
        this.dust(b, 4);
      }
      // running dust
      if (onGround && Math.abs(body.velocity.x) > 250) {
        b.stepT -= dt;
        if (b.stepT <= 0) {
          b.stepT = 0.2;
          this.dust(b, 1, true);
        }
      }
      if (inp.push && b.pushCd <= 0) this.doPush(b);
      if (inp.grabPressed && b.grabCd <= 0 && !b.holding) this.doGrab(b);
    } else {
      if (onGround) body.velocity.x *= Math.exp(-5 * dt);
      if (b.diving) {
        b.diveT -= dt;
        if (b.diveT <= 0 && onGround) b.diving = false;
      }
    }

    // variable jump height: let go early while rising and the jump gets cut short
    if (b.canCut && !inp.jumpHeld && body.velocity.y < 0) {
      body.velocity.y *= JUMP_CUT;
      b.canCut = false;
    }
    if (body.velocity.y >= 0) b.canCut = false;

    if (b.holding) {
      if (!canControl) this.dropHeld(b);
      else {
        b.holdT += dt;
        if (!inp.grabDown || b.holdT > HOLD_MAX) this.throwHeld(b);
      }
    }

    if (!onGround && body.velocity.y > 0 && b.ledgeCd <= 0) this.tryHang(b);
  }

  // ---------- help / hurt ----------
  findFront(b, range) {
    let best = null, bd = Infinity;
    for (const o of this.beans) {
      if (o === b || o.dead || o.finished || o.heldBy) continue;
      const dx = (o.s.x - b.s.x) * b.facing;
      const dy = o.s.y - b.s.y;
      if (dx < -8 || dx > range || Math.abs(dy) > 60) continue;
      if (dx < bd) { bd = dx; best = o; }
    }
    return best;
  }

  doPush(b) {
    b.pushCd = PUSH_CD;
    this.swipe(b);
    const t = this.findFront(b, PUSH_RANGE);
    if (!t || t.protect > 0) return;
    const cx = (b.s.x + t.s.x) / 2;
    if (t.hanging) {
      this.dropLedge(t);
      t.s.body.setVelocity(b.facing * 120, 150);
      t.lastHit = { by: b, at: this.clock };
      this.float(t, 'SHOVED OFF', COL.bad);
      this.impact(t, cx, 'medium');
      return;
    }
    if (this.hit(t, b.facing * PUSH_VX, -PUSH_VY, 0.5, b)) {
      this.float(t, 'SHOVE', COL.bad);
      this.impact(t, cx, 'medium');
    }
  }

  hit(t, vx, vy, stun, by) {
    if (t.protect > 0) return false;
    if (t.holding) this.dropHeld(t);
    t.diving = false;
    t.s.body.setVelocity(vx, vy);
    t.stun = stun;
    t.airJumps = 0; // getting hit knocks the double jump out of you, so shoves still matter
    if (by) t.lastHit = { by, at: this.clock };
    return true;
  }

  // Hurt feedback: white flash, squash, spark burst, shake + freeze by tier.
  impact(t, x, tier, color = 0xffffff) {
    this.flash(t);
    this.squash(t, 0.7, 1.3);
    this.burst(x, t.s.y - 4, color, tier === 'large' ? 12 : 7, tier === 'large' ? 90 : 60, 280);
    this.feel(tier);
  }

  doGrab(b) {
    b.grabCd = 0.4;
    const t = this.findFront(b, GRAB_RANGE);
    if (!t) return;
    if (t.hanging) {
      this.climbUp(t);
      b.karma += 1;
      b.saves += 1;
      this.float(b, '+1 KARMA', COL.good);
      this.log(`${b.name} saved ${t.name}  +1 Karma`, hex(b.color));
      // Help feedback is warm, not violent: green ring, happy hop, no shake or freeze.
      this.ring(t.s.x, t.s.y, 0x7fd48a, 14, 70, 420);
      this.burst(t.s.x, t.s.y, 0x7fd48a, 6, 45, 360);
      this.squash(t, 0.8, 1.25);
      this.squash(b, 0.85, 1.15);
      return;
    }
    if (t.protect > 0 || t.holding || t.heldBy) return;
    b.holding = t;
    b.holdT = 0;
    t.heldBy = b;
    t.diving = false;
    t.s.body.setAllowGravity(false);
    this.squash(t, 1.2, 0.8);
    if (b.bot) b.bot.holdPlan = 0.3 + Math.random() * 0.8;
  }

  throwHeld(b) {
    const t = b.holding;
    b.holding = null;
    b.grabCd = 0.8;
    if (!t) return;
    t.heldBy = null;
    t.s.body.setAllowGravity(true);
    t.s.body.setVelocity(b.facing * THROW_VX + b.s.body.velocity.x * 0.3, -THROW_VY);
    t.stun = 0.6;
    t.airJumps = 0;
    t.lastHit = { by: b, at: this.clock };
    this.float(t, 'THROWN', COL.text);
    this.squash(t, 0.75, 1.3);
    this.squash(b, 1.2, 0.85);
    this.feel('small');
  }

  dropHeld(b) {
    const t = b.holding;
    b.holding = null;
    if (!t) return;
    t.heldBy = null;
    t.s.body.setAllowGravity(true);
    t.s.body.setVelocity(0, 0);
  }

  // ---------- ledges ----------
  surfaces() {
    const list = this.platforms.map((obj) => ({ obj, ...this.rectOf(obj) }));
    list.push({ obj: this.mover, ...this.rectOf(this.mover) });
    return list;
  }

  rectOf(obj) {
    const b = obj.body;
    return { left: b.left, right: b.right, top: b.top, bottom: b.bottom };
  }

  tryHang(b) {
    const bb = b.s.body;
    for (const r of this.surfaces()) {
      for (const side of [-1, 1]) {
        const edge = side > 0 ? r.right : r.left;
        const inner = side > 0 ? bb.left : bb.right;
        const d = (inner - edge) * side; // how far outside the edge the bean is
        if (d < -4 || d > 16) continue;
        if (bb.top < r.top - 8 || bb.top > r.top + 20) continue;
        this.startHang(b, r.obj, side);
        return;
      }
    }
  }

  startHang(b, obj, side) {
    b.hanging = true;
    b.ledge = { obj, side };
    b.hangT = HANG_TIME;
    b.climb = 0;
    b.diving = false;
    b.stun = 0;
    b.facing = -side;
    b.s.body.setAllowGravity(false).setVelocity(0, 0);
    if (b.bot) b.bot.mashT = 0.3;
  }

  hangPos(b) {
    const r = this.rectOf(b.ledge.obj);
    const bb = b.s.body;
    const x = b.ledge.side > 0 ? r.right + bb.halfWidth + 1 : r.left - bb.halfWidth - 1;
    return [x, r.top - 10 + bb.halfHeight];
  }

  stepHanging(b, inp, dt) {
    const [x, y] = this.hangPos(b);
    b.s.body.reset(x, y);
    b.hangT -= dt;
    if (inp.jump) {
      b.climb += 1;
      if (b.climb >= CLIMB_PRESSES) {
        this.climbUp(b);
        return;
      }
    }
    if (b.hangT <= 0) this.dropLedge(b);
  }

  climbUp(b) {
    const r = this.rectOf(b.ledge.obj);
    const side = b.ledge.side;
    b.hanging = false;
    b.s.body.setAllowGravity(true);
    b.s.body.reset(side > 0 ? r.right - 22 : r.left + 22, r.top - 22);
    b.ledgeCd = 0.5;
    b.protect = Math.max(b.protect, 0.6);
    this.squash(b, 1.25, 0.8);
    this.dust(b, 3);
  }

  dropLedge(b) {
    b.hanging = false;
    b.s.body.setAllowGravity(true);
    b.s.body.setVelocity(b.ledge.side * 60, 80);
    b.ledgeCd = 0.8;
  }

  // ---------- world rules ----------
  checkWorld() {
    for (const b of this.beans) {
      if (b.dead) continue;
      const s = b.s, bb = s.body;
      if (s.y > KO_Y) {
        this.knockOut(b);
        continue;
      }
      if (b.finished) continue;

      // bounce pad
      if (!b.heldBy && !b.hanging && bb.blocked.down && Math.abs(bb.bottom - PAD.top) < 4 && s.x > PAD.x0 && s.x < PAD.x1) {
        bb.velocity.y = -PAD_V;
        bb.velocity.x = Phaser.Math.Clamp(bb.velocity.x, -150, 150); // mostly straight up, so you land on the block
        this.squash(b, 0.7, 1.4);
        this.ring(s.x, PAD.top, COL.pad, 10, 60, 320);
        this.padRect.setScale(1.15, 0.4);
        this.tweens.add({ targets: this.padRect, scaleX: 1, scaleY: 1, duration: 260, ease: 'Back.easeOut' });
      }

      // hammer
      const p = this.pend;
      if (!b.heldBy && b.hitCd <= 0 && Phaser.Math.Distance.Between(s.x, s.y, p.hx, p.hy) < p.r + 18) {
        const dir = Math.abs(p.omega) > 0.2 ? Math.sign(p.omega) : Math.sign(s.x - p.hx) || 1;
        if (b.hanging) this.dropLedge(b);
        if (this.hit(b, dir * 660, -480, 0.5, null)) {
          this.float(b, 'BONK', COL.bad);
          this.impact(b, (s.x + p.hx) / 2, 'large', COL.hazard);
        }
        b.hitCd = 0.4;
      }

      // checkpoints
      for (let i = CHECKPOINTS.length - 1; i > b.cp; i--) {
        if (s.x > CHECKPOINTS[i].x + 20 && bb.blocked.down) {
          b.cp = i;
          break;
        }
      }

      // finish
      if (this.state === 'play' && s.x > FINISH_X && bb.blocked.down) this.finish(b);
    }
  }

  knockOut(b) {
    b.dead = true;
    b.falls += 1;
    if (b.holding) this.dropHeld(b);
    if (b.heldBy) {
      b.heldBy.holding = null;
      b.heldBy = null;
    }
    b.hanging = false;
    b.diving = false;
    b.stun = 0;
    b.view.setVisible(false);
    b.s.body.enable = false;

    // splash at the bottom of the pit, in the bean's color
    this.burst(b.s.x, WORLD_H - 6, b.color, 12, 110, 500, -Math.PI / 2, 1.1);

    const lh = b.lastHit;
    if (lh && lh.by !== b && this.clock - lh.at < HIT_CREDIT_WINDOW) {
      const k = lh.by;
      this.feel('large');
      this.popText(b.s.x, WORLD_H - 70, 'KO!', COL.bad, 34);
      k.bounty += 1;
      k.kos += 1;
      let msg = `${k.name} knocked out ${b.name}  +1 Bounty`;
      if (b === this.targetBean && b.bounty > 0) {
        const steal = Math.ceil(b.bounty / 2);
        b.bounty -= steal;
        k.bounty += steal;
        msg += `, stole ${steal} from the target`;
      }
      this.log(msg, COL.bad);
    } else {
      this.log(`${b.name} fell`, COL.dim);
      this.feel('small');
    }
    b.lastHit = null;

    if (b.karma >= KARMA_SAVE_COST) {
      b.karma -= KARMA_SAVE_COST;
      b.respawnAt = { ...b.lastSafe };
      b.respawnT = 0.4;
      this.log(`${b.name} spent 3 Karma: instant respawn on the spot`, COL.good);
    } else {
      const cp = CHECKPOINTS[b.cp];
      b.respawnAt = { x: cp.sx + b.id * 28, y: cp.sy };
      b.respawnT = RESPAWN_DELAY;
    }
  }

  respawn(b) {
    b.dead = false;
    b.s.body.enable = true;
    b.s.body.setAllowGravity(true);
    b.s.body.reset(b.respawnAt.x, b.respawnAt.y);
    b.view.setVisible(true);
    b.grounded = false;
    b.airVy = 0;
    b.airJumps = 1;
    b.protect = PROTECT_TIME;
    if (b.bot) b.bot.progressT = 0;
    // pop in
    this.tweens.killTweensOf(b.view);
    b.view.setScale(0.2);
    this.tweens.add({ targets: b.view, scaleX: 1, scaleY: 1, duration: 320, ease: 'Back.easeOut' });
    this.ring(b.s.x, b.s.y, b.color, 10, 55, 380);
  }

  finish(b) {
    if (b.holding) this.dropHeld(b);
    b.finished = true;
    b.place = this.finishOrder.push(b);
    this.log(`${b.name} qualified #${b.place}`, COL.good);
    const colors = PLAYERS.map((p) => p.color);
    for (let i = 0; i < 18; i++) {
      this.burst(b.s.x, b.s.y - 10, colors[i % colors.length], 1, 70 + Math.random() * 80, 700, -Math.PI / 2, 1.3);
    }
    this.popText(b.s.x, b.s.y - 70, 'QUALIFIED!', COL.good, 22);
    this.squash(b, 0.75, 1.3);
    if (this.finishOrder.length >= Math.min(QUALIFY, this.beans.length)) {
      this.time.delayedCall(1200, () => this.endRound());
    }
  }

  endRound() {
    if (this.state === 'over') return;
    this.state = 'over';
    const rest = this.beans.filter((b) => !b.finished).sort((a, c) => c.s.x - a.s.x);
    const most = (key) => {
      const top = Math.max(...this.beans.map((b) => b[key]));
      return top > 0 ? this.beans.filter((b) => b[key] === top).map((b) => b.name).join(', ') : 'nobody';
    };
    this.results = {
      rows: [...this.finishOrder, ...rest].map((b, i) => ({ place: i + 1, name: b.name, color: b.color, qualified: b.finished, saves: b.saves, kos: b.kos, falls: b.falls })),
      saint: most('saves'),
      traitor: most('kos'),
    };
  }

  updateTarget() {
    const top = Math.max(...this.beans.map((b) => b.bounty));
    const leaders = this.beans.filter((b) => b.bounty === top);
    this.targetBean = top >= 2 && leaders.length === 1 ? leaders[0] : null;
  }

  // ---------- moving parts ----------
  updateMover() {
    const body = this.mover.body;
    if (body.x > MOVER.maxX) body.setVelocityX(-MOVER.speed);
    if (body.x < MOVER.minX) body.setVelocityX(MOVER.speed);
    this.moverTop.setPosition(this.mover.x, this.mover.y - 7);
  }

  updatePendulum(dt) {
    const p = this.pend;
    p.t += dt;
    p.angle = p.amp * Math.sin(p.t * p.speed);
    p.omega = p.amp * p.speed * Math.cos(p.t * p.speed);
    p.hx = p.px + Math.sin(p.angle) * p.len;
    p.hy = p.py + Math.cos(p.angle) * p.len;
    this.pendArm.clear().lineStyle(6, COL.platTop, 1).lineBetween(p.px, p.py, p.hx, p.hy);
    this.pendHead.setPosition(p.hx, p.hy);
  }

  // ---------- bots ----------
  botInput(b, dt) {
    const bot = b.bot, cfg = b.botCfg || PLAYERS[b.id].bot;
    const inp = { ...NO_INPUT, jumpHeld: true }; // bots always do full jumps
    if (b.dead || b.heldBy || b.stun > 0) return inp;

    if (b.hanging) {
      bot.mashT -= dt;
      if (bot.mashT <= 0) {
        inp.jump = true;
        bot.mashT = (1 / cfg.mash) * (0.7 + Math.random() * 0.6);
      }
      return inp;
    }
    if (b.holding) {
      inp.right = b.facing > 0;
      inp.left = b.facing < 0;
      inp.grabDown = b.holdT < bot.holdPlan;
      return inp;
    }

    let dir = 1;
    const bb = b.s.body;
    const onGround = bb.blocked.down || bb.touching.down;

    // unstick: back up if no progress for a while
    bot.progressT += dt;
    if (b.s.x > bot.bestX + 20) {
      bot.bestX = b.s.x;
      bot.progressT = 0;
    }
    if (bot.backT > 0) {
      bot.backT -= dt;
      dir = -1;
    } else if (bot.progressT > 2.5) {
      bot.backT = 0.7;
      bot.progressT = 0;
    }

    if (onGround && dir > 0) {
      if (!this.groundAhead(b, dir)) {
        if (this.landingAhead(b, dir) || bot.waitT > 6) {
          inp.jump = true;
          bot.waitT = 0;
        } else {
          bot.waitT += dt;
          bot.progressT = 0; // waiting on purpose is not being stuck
          dir = 0; // wait at the edge for the moving platform
          // no moving platform nearby: this gap just needs a run-up, so step back and retry
          if (bot.waitT > 0.6 && Math.abs(this.mover.x - b.s.x) > 450) {
            bot.backT = 0.45;
            bot.waitT = 0;
          }
        }
      } else {
        bot.waitT = 0;
        if (Math.random() < dt * 0.25) inp.jump = true; // idle hop
      }
    }

    if (!onGround && bb.velocity.y < -500) dir = 0; // riding a bounce pad: don't overshoot the block

    // save yourself: falling with nothing below means a double jump toward the next surface
    if (!onGround && bb.velocity.y > 150 && b.airJumps > 0 && !this.groundBelow(b, 420)) inp.jump = true;

    // hammer: wait for it to swing past, or hop over it when it is right there
    const p = this.pend;
    const toHead = p.hx - b.s.x;
    if (onGround && dir > 0 && p.hy > 700 && toHead > -30 && toHead < 170) {
      if (toHead < 80 && Math.random() < 0.5) inp.jump = true;
      else {
        dir = 0;
        bot.progressT = 0;
      }
    }

    // social choices
    bot.socialCd -= dt;
    if (bot.socialCd <= 0) {
      const near = this.beans.find((o) => o !== b && !o.dead && !o.finished && !o.heldBy && Math.abs(o.s.x - b.s.x) < 75 && Math.abs(o.s.y - b.s.y) < 60);
      if (near) {
        bot.socialCd = 1.2 + Math.random();
        const face = Math.sign(near.s.x - b.s.x) || 1;
        const r = Math.random();
        if (near.hanging) {
          if (r < cfg.help) inp.grabPressed = true;
          else if (r < cfg.help + cfg.push) inp.push = true;
        } else if (face === b.facing || dir === 0) {
          if (r < cfg.push * 0.6) inp.push = true;
          else if (r < cfg.push * 0.6 + cfg.grab) {
            inp.grabPressed = true;
            inp.grabDown = true;
          }
        }
        if (inp.push || inp.grabPressed) dir = face;
      }
    }

    inp.right = dir > 0;
    inp.left = dir < 0;
    return inp;
  }

  groundAhead(b, dir) {
    const fx = b.s.x + dir * 30, bottom = b.s.body.bottom;
    return this.surfaces().some((r) => fx >= r.left && fx <= r.right && r.top >= bottom - 6 && r.top <= bottom + 70);
  }

  groundBelow(b, depth) {
    const x = b.s.x, bottom = b.s.body.bottom;
    return this.surfaces().some((r) => x >= r.left - 10 && x <= r.right + 10 && r.top >= bottom - 4 && r.top <= bottom + depth);
  }

  landingAhead(b, dir) {
    const x = b.s.x, bottom = b.s.body.bottom;
    // how far a jump carries depends on run speed: from a standstill it is much shorter
    const speed = Phaser.Math.Clamp(Math.abs(b.s.body.velocity.x) / RUN_SPEED, 0, 1);
    const reach = 100 + 150 * speed;
    return this.surfaces().some((r) => {
      const near = dir > 0 ? r.right > x + 70 && r.left < x + reach : r.left < x - 70 && r.right > x - reach;
      return near && r.top >= bottom - 120 && r.top <= bottom + 260;
    });
  }

  // ---------- visuals ----------
  updateVisuals() {
    for (const b of this.beans) {
      const s = b.s, v = b.view;
      b.label.setVisible(!b.dead).setPosition(s.x, s.y - 26);
      v.setFlipX(b.facing < 0);

      // pose: dive = belly flop, stunned = wobble, hanging = tremble that grows as time runs out,
      // running = lean into the direction of travel
      let targetRot = 0;
      let jitter = 0;
      if (b.diving) targetRot = b.facing * 1.25;
      else if (b.stun > 0 && !b.heldBy) targetRot = Math.sin(this.clock * 28) * 0.35;
      else if (b.hanging) {
        const urgency = 1 - b.hangT / HANG_TIME;
        targetRot = Math.sin(this.clock * 38) * 0.12 * urgency;
        jitter = Math.sin(this.clock * 53) * 2.5 * urgency;
      } else if (b.grounded) targetRot = (s.body.velocity.x / RUN_SPEED) * 0.1;
      if (b.spinT > 0) v.rotation = b.facing * Math.PI * 2 * (1 - b.spinT / 0.32);
      else v.rotation += (targetRot - v.rotation) * 0.3;
      v.setPosition(s.x + jitter, s.y + 22);
      v.setAlpha(b.protect > 0 && !b.dead ? (Math.sin(this.clock * 30) > 0 ? 1 : 0.35) : 1);

      let mark = '';
      let color = COL.bad;
      if (b.dead) mark = '';
      else if (b.hanging) {
        mark = `HELP! ${b.hangT.toFixed(1)}s`;
        color = b.hangT < 1 ? COL.bad : COL.text;
      } else if (b === this.targetBean) mark = 'TARGET';
      else if (b.finished) {
        mark = `#${b.place}`;
        color = COL.good;
      }
      b.mark.setText(mark).setColor(color).setVisible(!b.dead).setPosition(s.x, s.y - 44);
    }
  }

  updateCamera(dt) {
    const cam = this.cameras.main;
    const points = [];
    const humans = this.beans.filter((b) => b.human && !b.finished);
    const humanPts = humans.map((h) => (h.dead ? h.respawnAt : { x: h.s.x, y: h.s.y }));
    points.push(...humanPts);
    for (const b of this.beans) {
      if (b.dead || b.finished || b.human) continue;
      if (!humanPts.length || humanPts.some((h) => Math.abs(h.x - b.s.x) < 1100)) points.push({ x: b.s.x, y: b.s.y });
    }
    if (!points.length) this.beans.filter((b) => !b.dead).forEach((b) => points.push({ x: b.s.x, y: b.s.y }));
    if (!points.length) return;

    const xs = points.map((p) => p.x), ys = points.map((p) => p.y);
    const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
    const w = maxX - minX + 520, h = maxY - minY + 440;
    const z = Phaser.Math.Clamp(Math.min(cam.width / w, cam.height / h), 0.55, 1.0);
    // look-ahead: lead the camera a little in the direction the human players are running
    const movers = humans.filter((h) => !h.dead);
    const lead = movers.length ? Phaser.Math.Clamp((movers.reduce((a, h) => a + h.s.body.velocity.x, 0) / movers.length) * 0.3, -110, 110) : 0;
    const k = 1 - Math.exp(-4 * dt);
    this.camZ += (z - this.camZ) * k;
    this.camX += ((minX + maxX) / 2 + lead - this.camX) * k;
    this.camY += ((minY + maxY) / 2 - 60 - this.camY) * k;
    // shake rides on top of the smooth follow: trauma squared, smooth sine noise, never the bodies
    const sh = this.trauma * this.trauma;
    const ox = 18 * sh * Math.sin(this.shakeT * 47);
    const oy = 12 * sh * Math.sin(this.shakeT * 61 + 1.3);
    cam.setZoom(this.camZ);
    cam.centerOn(this.camX + ox / this.camZ, this.camY + oy / this.camZ);
  }

  // ---------- game feel helpers ----------
  feel(tier) {
    const f = FEEL[tier];
    if (this.shakeOn) this.trauma = Math.min(1, this.trauma + f.trauma);
    this.hitStop = Math.max(this.hitStop, f.stop);
  }

  // squash & stretch the visual, then spring back with overshoot
  squash(b, sx, sy, duration = 240) {
    const v = b.view;
    this.tweens.killTweensOf(v);
    v.setScale(sx, sy);
    this.tweens.add({ targets: v, scaleX: 1, scaleY: 1, duration, ease: 'Back.easeOut' });
  }

  flash(b) {
    b.view.setTint(0xffffff).setTintMode(Phaser.TintModes.FILL);
    this.time.delayedCall(70, () => b.view.setTint(b.color).setTintMode(Phaser.TintModes.MULTIPLY));
  }

  onJump(b) {
    this.squash(b, 0.75, 1.3, 260);
    this.dust(b, 3);
  }

  onDoubleJump(b) {
    this.squash(b, 0.8, 1.25, 240);
    b.spinT = 0.32; // a quick front flip
    this.ring(b.s.x, b.s.body.bottom, 0x9aa1ad, 6, 34, 300);
    this.burst(b.s.x, b.s.body.bottom, 0x9aa1ad, 4, 30, 300, Math.PI / 2, 0.9);
  }

  onLand(b, fallSpeed) {
    const k = Phaser.Math.Clamp((fallSpeed - 250) / 1100, 0, 1);
    this.squash(b, 1.12 + 0.3 * k, 0.9 - 0.25 * k, 220);
    this.dust(b, 2 + Math.round(5 * k));
    if (k > 0.75) this.feel('small');
  }

  // little grey puffs at the feet; `behind` = one puff kicked back while running
  dust(b, n, behind = false) {
    const x = b.s.x, y = b.s.body.bottom;
    for (let i = 0; i < n; i++) {
      const side = behind ? -b.facing : i % 2 ? 1 : -1;
      const c = this.add.circle(x - (behind ? b.facing * 10 : 0), y - 3, 3 + Math.random() * 3, 0x9aa1ad).setAlpha(0.7).setDepth(9);
      this.tweens.add({
        targets: c,
        x: c.x + side * (18 + Math.random() * 26),
        y: c.y - 6 - Math.random() * 12,
        alpha: 0,
        scale: 0.3,
        duration: 320 + Math.random() * 120,
        ease: 'Cubic.easeOut',
        onComplete: () => c.destroy(),
      });
    }
  }

  // flat particle burst; angle/spread limit the direction (default: all around)
  burst(x, y, color, n, dist, life, angle = 0, spread = Math.PI) {
    for (let i = 0; i < n; i++) {
      const a = angle + (Math.random() * 2 - 1) * spread;
      const d = dist * (0.5 + Math.random() * 0.7);
      const p = this.add.circle(x, y, 2.5 + Math.random() * 3, color).setDepth(25);
      this.tweens.add({
        targets: p,
        x: x + Math.cos(a) * d,
        y: y + Math.sin(a) * d,
        alpha: 0,
        scale: 0.3,
        duration: life * (0.7 + Math.random() * 0.5),
        ease: 'Cubic.easeOut',
        onComplete: () => p.destroy(),
      });
    }
  }

  ring(x, y, color, r0, r1, life) {
    const c = this.add.circle(x, y, r1).setStrokeStyle(3, color).setDepth(24).setScale(r0 / r1);
    this.tweens.add({ targets: c, scale: 1, alpha: 0, duration: life, ease: 'Cubic.easeOut', onComplete: () => c.destroy() });
  }

  swipe(b) {
    const r = this.add.rectangle(b.s.x + b.facing * 32, b.s.y, 12, 30, 0xffffff).setAlpha(0.8).setDepth(15);
    this.tweens.add({ targets: r, alpha: 0, x: r.x + b.facing * 14, duration: 160, onComplete: () => r.destroy() });
  }

  float(b, text, color) {
    this.popText(b.s.x, b.s.y - 60, text, color, 16);
  }

  // text that pops in with overshoot, then drifts up and fades
  popText(x, y, text, color, size) {
    const t = this.add.text(x, y, text, { fontFamily: FONT, fontSize: `${size}px`, fontStyle: 'bold', color }).setOrigin(0.5).setDepth(30).setScale(0.4);
    this.tweens.add({ targets: t, scale: 1, duration: 180, ease: 'Back.easeOut' });
    this.tweens.add({ targets: t, y: y - 40, alpha: 0, delay: 350, duration: 650, onComplete: () => t.destroy() });
  }

  log(text, color) {
    this.feed.push({ text, color, at: this.clock });
  }
}

class UIScene extends Phaser.Scene {
  constructor() {
    super('ui');
  }

  create() {
    const f = { fontFamily: FONT, fontSize: '18px', color: COL.text };
    this.add.text(20, 16, 'Round 1: Ledge Run', { ...f, fontSize: '20px', fontStyle: 'bold' });
    this.timer = this.add.text(20, 44, '', { ...f, color: COL.dim });
    this.qual = this.add.text(640, 16, '', f).setOrigin(0.5, 0);
    this.cards = [0, 1, 2, 3].map((i) => this.add.text(20, 80 + i * 22, '', { ...f, fontSize: '15px' }));
    this.feedTexts = [0, 1, 2, 3, 4].map((i) => this.add.text(1260, 16 + i * 22, '', { ...f, fontSize: '15px' }).setOrigin(1, 0));
    this.center = this.add.text(640, 290, '', { ...f, fontSize: '72px', fontStyle: 'bold' }).setOrigin(0.5);
    this.sub = this.add.text(640, 350, '', { ...f, fontSize: '20px', color: COL.dim }).setOrigin(0.5);
    this.add.text(640, 706, 'A/D move   W/Space jump (again in the air: double jump)   Shift dive   F shove   E grab: tap next to a hanging player to save them, hold to carry, release to throw   |   2: add Player 2   H: shake on/off   R: restart', { ...f, fontSize: '13px', color: COL.dim }).setOrigin(0.5, 1);
    this.resultsGroup = null;
  }

  update() {
    const play = this.scene.get('play');
    if (!play || !play.beans || !play.beans.length) return;

    this.timer.setText(play.state === 'countdown' ? '' : `${Math.max(0, Math.ceil(play.timeLeft))}s left`);
    this.qual.setText(`Qualified ${play.finishOrder.length} / ${QUALIFY}`);
    play.beans.forEach((b, i) => {
      const extra = b.finished ? `   #${b.place}` : b.dead ? '   (respawning)' : '';
      const who = b.role ? `${b.name} (${b.role})` : b.name;
      this.cards[i].setText(`${who}   Karma ${b.karma}   Bounty ${b.bounty}${extra}`).setColor(hex(b.color));
    });

    const recent = play.feed.filter((e) => play.clock - e.at < 7).slice(-5);
    this.feedTexts.forEach((t, i) => {
      const e = recent[i];
      if (!e) return t.setText('');
      t.setText(e.text).setColor(e.color).setAlpha(Math.min(1, (7 - (play.clock - e.at)) / 1.5));
    });

    if (play.state === 'countdown') {
      this.center.setText(String(Math.ceil(play.countdown)));
      this.sub.setText('Reach the flag. Top 3 qualify. Save your friends, or shove them off.');
    } else if (play.state === 'play' && play.clock - play.playStartedAt < 0.8) {
      this.center.setText('GO!');
      this.sub.setText('');
    } else {
      this.center.setText('');
      this.sub.setText('');
    }

    if (play.state === 'over' && !this.resultsGroup) this.showResults(play.results);
    if (play.state !== 'over' && this.resultsGroup) {
      this.resultsGroup.forEach((o) => o.destroy());
      this.resultsGroup = null;
    }
  }

  showResults(r) {
    const f = { fontFamily: FONT, fontSize: '18px', color: COL.text };
    const objs = [this.add.rectangle(640, 360, 720, 400, 0x2a2e38)];
    objs.push(this.add.text(640, 190, 'ROUND OVER', { ...f, fontSize: '32px', fontStyle: 'bold' }).setOrigin(0.5));
    r.rows.forEach((row, i) => {
      const status = row.qualified ? 'qualified' : 'out';
      objs.push(
        this.add.text(330, 250 + i * 32, `${row.place}.  ${row.name}`, { ...f, color: hex(row.color) }),
        this.add.text(620, 250 + i * 32, `${status}    saves ${row.saves}    knockouts ${row.kos}    falls ${row.falls}`, { ...f, color: row.qualified ? COL.good : COL.dim }),
      );
    });
    objs.push(
      this.add.text(640, 410, `Saint (most saves): ${r.saint}`, { ...f, color: COL.good }).setOrigin(0.5),
      this.add.text(640, 440, `Traitor (most knockouts): ${r.traitor}`, { ...f, color: COL.bad }).setOrigin(0.5),
      this.add.text(640, 510, 'Press R to play again', { ...f, color: COL.dim }).setOrigin(0.5),
    );
    this.resultsGroup = objs;
  }
}

window.__game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  width: 1280,
  height: 720,
  backgroundColor: hex(COL.bg),
  scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
  physics: { default: 'arcade', arcade: { gravity: { x: 0, y: GRAVITY }, debug: false } },
  scene: [PlayScene, UIScene],
});
