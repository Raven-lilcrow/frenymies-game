// Messages between the browser and the game server (JSON over WebSocket).
// The server checks every incoming message against these schemas and drops anything else.
import { z } from 'zod';
import { MAX_INPUTS_PER_MESSAGE, ROOM_CODE } from './constants.ts';
import type { Difficulty, RoundType } from './level.ts';
import type { PlayerState } from './sim.ts';
import type { WireSnap } from './snapcodec.ts';

export const ClientMsg = z.discriminatedUnion('t', [
  z.object({
    t: z.literal('hello'),
    name: z.string().trim().min(1).max(16),
    room: z.string().regex(ROOM_CODE),
  }),
  z.object({
    t: z.literal('input'),
    // [seq, buttons, viewTick], oldest first. seq goes up by 1 per tick. viewTick = the server tick the
    // other beans were drawn at on your screen, so a shove is judged by what you saw (favor the pusher).
    i: z
      .array(z.tuple([z.number().int().nonnegative(), z.number().int().min(0).max(63), z.number().int().nonnegative()]))
      .min(1)
      .max(MAX_INPUTS_PER_MESSAGE),
  }),
  z.object({ t: z.literal('ping'), c: z.number() }),
  z.object({ t: z.literal('ready'), on: z.boolean() }), // lobby: ready to start (a rematch after a match)
]);
export type ClientMsg = z.infer<typeof ClientMsg>;

export interface PlayerInfo {
  id: number;
  slot: number;
  name: string;
  color: number;
}

export interface SnapPlayer extends PlayerState {
  id: number;
  points: number;
  helps: number;
  kos: number;
}

/** Something worth showing: who did what to whom, and where. */
export interface GameEvent {
  k:
    | 'shove' | 'shoveOff' | 'grab' | 'throw' | 'save' | 'help' | 'door' | 'ko' | 'fall' | 'climb' | 'bonk' | 'finish'
    | 'out' // knocked out of a survival round
    | 'steal' | 'pass'; // Tail Tag: a took b's tail / a gave b their tail
  tick: number;
  a: number; // who did it (for 'fall', 'climb', 'bonk', 'finish' and 'out': who it happened to)
  b: number; // who it was done to (0 if nobody)
  x: number;
  y: number;
  pts?: number; // points scored by `a`, if any
  place?: number; // 'finish': 1 for first
}

/**
 * lobby: wander a practice course and ready up. intro: round card, then 3-2-1 (nobody moves until `go`).
 * play: the round. results: how the round went. show: the end of the match (winner, Saint, Traitor).
 */
export type Phase = 'lobby' | 'intro' | 'play' | 'results' | 'show';

export interface ResultRow {
  id: number;
  place: number; // this round, 0 = none (did not finish, out early...)
  roundPts: number; // points for the place this round
  points: number; // match total so far
  helps: number; // match totals
  kos: number;
}

/** A standout moment for the results: `a` did `k` to `b`, `n` times (this round, or over the match on the show). */
export interface Highlight {
  k: 'save' | 'door' | 'pass' | 'help' | 'ko' | 'steal';
  a: number;
  b: number;
  n: number;
}

export interface RoundInfo {
  phase: Phase;
  match: RoundType[]; // the rounds of this match, in order (empty in the lobby)
  index: number; // which of them is on
  type: RoundType; // the course being played (the lobby practices on Ledge Run)
  seed: number; // with type, diff and index, every browser builds the same course
  diff: Difficulty;
  go: number; // tick the round starts
  end: number; // tick the round ends at the latest (the timer)
  next: number; // results and show: tick the next thing starts
  ready: number[]; // lobby: who is ready
  finished: number[]; // ids in finishing order (races)
  out: number[]; // ids in the order they were knocked out (survival)
  // saints: most helps, traitors: most knockouts, winners: most points (everyone tied for the top; empty if nobody).
  // highlights: the biggest help and the biggest hurt between two players (at most one of each)
  results: { rows: ResultRow[]; saints: number[]; traitors: number[]; winners: number[]; highlights: Highlight[] } | null;
}

export type ServerMsg =
  | { t: 'welcome'; id: number; slot: number; room: string; tick: number }
  | { t: 'roster'; players: PlayerInfo[] }
  | ({ t: 'round' } & RoundInfo)
  // 30 a second; slimmed for the wire, see snapcodec.ts (SnapDecoder turns it back into a full snapshot)
  | WireSnap
  | { t: 'pong'; c: number; tick: number }
  | { t: 'error'; code: 'room_full' | 'bad_message' | 'too_many_messages'; message: string };
