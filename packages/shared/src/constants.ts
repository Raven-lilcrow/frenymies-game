// Tuning numbers shared by the server (the real game) and the browser (prediction).
// Movement values are copied from prototype-2d so the online bean feels the same.

export const TICK_RATE = 60;
export const DT = 1 / TICK_RATE;
export const SNAPSHOT_EVERY = 2; // ticks between snapshots: 30 per second
export const MAX_PLAYERS = 4;
export const MAX_MESSAGE_BYTES = 4096;
export const MAX_INPUTS_PER_MESSAGE = 30;
export const ROOM_CODE = /^[A-Z0-9]{4}$/;

export const WORLD_H = 1100; // every course is this tall; its width comes from the course
export const KO_Y = WORLD_H + 60;

// Body size (the hitbox). The drawn bean is 36x44, the body is a bit smaller.
export const HALF_W = 15;
export const HALF_H = 20;

// Jump is defined by feel (height + time to the top); gravity and speed come from it.
export const JUMP_HEIGHT = 150;
export const APEX_TIME = 0.36;
export const GRAVITY = (2 * JUMP_HEIGHT) / (APEX_TIME * APEX_TIME); // ~2315 while rising
export const JUMP_V = (2 * JUMP_HEIGHT) / APEX_TIME; // ~833
export const FALL_MULT = 1.6; // falling is heavier than rising
export const APEX_HANG = 0.55; // lighter gravity near the top while jump is held
export const JUMP_CUT = 0.45; // letting go early cuts the rise: tap = hop, hold = full jump
export const COYOTE = 0.1;
export const JUMP_BUFFER = 0.12;
export const DOUBLE_JUMP = 0.85; // 0 turns the double jump off
export const RUN_SPEED = 360;
export const DIVE_VX = 580;
export const DIVE_TIME = 0.55;
export const PAD_V = 1180;
export const MAX_FALL = 1500; // stops tunneling through thin platforms on long falls
export const RESPAWN_DELAY = 1.6;

// Help and hurt (milestone 3). Values from the prototype unless noted.
export const PUSH_VX = 700;
export const PUSH_VY = 430;
export const PUSH_CD = 1.2; // shove cooldown (anti-griefing)
export const PUSH_RANGE = 72;
export const SHOVE_STUN = 0.5;
export const GRAB_RANGE = 70;
export const GRAB_CD = 0.4;
export const THROW_CD = 0.8;
export const THROW_VX = 720;
export const THROW_VY = 700;
export const THROW_STUN = 0.6;
export const HOLD_MAX = 1.8; // then you throw automatically
export const HOLD_SPEED = 0.55; // carrying someone slows you down
export const HANG_TIME = 2.5;
export const CLIMB_PRESSES = 6;
export const CLIMB_PROTECT = 0.6;
export const PROTECT_TIME = 1.5; // spawn protection (anti-griefing)
export const GRAB_IMMUNE = 2; // can't be grabbed again right after escaping (anti-griefing)
export const HIT_CREDIT = 4; // seconds a shove, grab or throw still counts toward a knockout
export const THROW_HELP_WINDOW = 2.5; // a throw that lands you on a platform ahead within this time is a help

// Points (model B). Help and knockout are worth the same for now; tune after playtests.
export const HELP_POINTS = 1;
export const KO_POINTS = 1;
export const HELP_PAIR_COOLDOWN = 8; // seconds before helping the same person scores again
export const MAX_REWIND_TICKS = 30; // favor the pusher, but never by more than 500 ms

// Obstacles (milestone 4). A hit works like a shove from the obstacle: knocked back, briefly stunned.
export const HAMMER_VX = 650;
export const HAMMER_VY = 420;
export const HAMMER_STUN = 0.5;
export const BAR_VX = 560;
export const BAR_VY = 380;
export const BAR_STUN = 0.45;
export const BAR_REACH = 22; // bean center to the bar's middle line
export const HAZARD_CD = 0.6; // can't be hit by an obstacle again right away

// Rounds (milestone 4)
export const INTRO_SEC = 3; // round name and rules
export const COUNTDOWN_SEC = 3;
export const RESULTS_SEC = 8;
export const SHOW_SEC = 12; // the end of the match: winner, Saint, Traitor
export const ROUNDS_PER_MATCH = 3;
export const QUALIFY = 3; // in a race, the first 3 to finish score; the round ends when they are in
export const FINISH_POINTS = [3, 2, 1]; // for 1st, 2nd, 3rd (races, and the last ones standing in survival)
export const FINAL_POINTS = 5; // the crown: first across in the final
export const TAIL_POINTS = 3; // holding a tail when Tail Tag ends
export const TAIL_IMMUNE = 1.5; // seconds a new tail holder can't be robbed
export const BOOST_SPEED = 1.12; // catch-up boost for last place (anti-griefing)
export const BOOST_GAP = 700; // only when this far behind the leader

// Velocity blends per tick. Worked out once from the prototype's exp(-rate * dt) at 60 steps/s.
export const GROUND_BLEND = 1 - Math.exp(-16 * DT);
export const AIR_BLEND = 1 - Math.exp(-6 * DT);
export const SLIDE_KEEP = Math.exp(-5 * DT);

export const PLAYER_COLORS = [0xf2b134, 0x4fb3bf, 0xe0607e, 0x8bc34a];
