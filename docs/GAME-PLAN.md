# Game Plan: Fall Guys style party game with a help-or-hurt twist

> Game title: **Frenymies** (decided 2026-10-01)
> Created: 2026-09-30 · Owner: Raven · Status: planning. A throwaway 2D prototype exists (see "What the prototype already settled" below); no online game yet
> Decisions are tracked in the Google Sheet "Frenymies Tracker" (Drive folder Frenymies): https://docs.google.com/spreadsheets/d/19q1OvtyaaFu9c9eDdXzXUeyKfZpIJtYYpPs-oetelaQ/edit . Copy final answers back here. Raven's first 14 answers were copied in on 2026-10-01, the rest on 2026-10-02. Still open: the playtest date (16).

## How to use this file

- `[ ]` = pick one (or more) by changing it to `[x]`.
- `Your answer:` = write your answer on that line.
- **Rec:** = my recommendation and why. Ignore it if you disagree.
- Sections marked **(pre-filled)** are already decided from our chats. Change them if you want.
- When every **Top decision** below is filled in, we can start building.

---

## Top decisions (fill these first, they change everything else)

| # | Decision | Where | Answer |
|---|---|---|---|
| 1 | 2D or 3D | Section 2.1 | **2D side view** |
| 2 | Camera / view | Section 2.2 | **Shared zoom that fits everyone** |
| 3 | How the help-or-hurt twist scores | Section 5.3 | **B: points for both** |
| 4 | What happens when you "kill" someone | Section 5.2 | **Depends on the round type** |
| 5 | Which rounds go in the round pool (each match draws 3) | Section 6.3 | **Ledge Run, Hot Plate, Two-Key Door, Tail Tag, Trust Bridge** |

---

## What the prototype already settled (as of 2026-10-01)

The local 2D prototype (`prototype-2d/`, Desktop shortcut "Play Frenymies") is throwaway code, but playing it answered some questions. These are facts about how it works today, **not** your decisions: every `[ ]` box below is still yours to tick. Exact numbers are in section 5.5 and 9.1.

| Area | What the prototype does | Plan section |
|---|---|---|
| View | 2D side view, shared camera that zooms (0.55x to 1x) to fit everyone and leads a little in the running direction | 2.1, 2.2 |
| Engine | Phaser 4.2.1 + Vite, plain JavaScript, Phaser's Arcade Physics (browser only, no server) | 2.3, 2.4 |
| Players | 1 human + 3 bots (saint, traitor, chaos). Press 2 to add Player 2 on the same keyboard. Bots use the same input object as humans | 1, 12 |
| Moves | Run, jump, **double jump** (new), dive, shove, grab, throw. Ledge hanging, climbing and saving | 4.2 |
| Double jump | One extra jump in the air at 85% strength. A shove or throw takes it away until you land and recover, so hits still matter | 4.2 |
| Ledges | Falling past a platform edge makes you hang for 2.5 s. Mash jump 6 times to climb up alone, or a friend grabs you to pull you up | 5.1 |
| Help | Pulling someone up = +1 Karma. Throwing someone can help or hurt | 5.1 |
| Hurt | Shove (also knocks a hanging player off), grab and hold, throw off | 5.1 |
| Knockouts | Race rules: fall, respawn at the last checkpoint after 1.6 s. Whoever shoved or threw you in the last 4 s gets the credit | 5.2 |
| Scoring | Model A, Karma and Bounty. 3 Karma is spent automatically for an instant respawn where you last stood. Each KO = +1 Bounty. The sole Bounty leader with 2+ gets the TARGET tag, and knocking them out steals half their Bounty. **Raven picked model B for the real game, so this changes** | 5.3 |
| Anti-griefing | Spawn protection 1.5 s (bean blinks), shove cooldown 1.2 s, short protection after climbing up | 5.4 |
| Round | Ledge Run: gaps, swinging hammer, moving platform, bounce pad, tall block, 4 checkpoints. 100 s timer, first 3 to finish qualify. Results show Saint (most saves) and Traitor (most KOs) | 6.2, 7 |
| Game feel | Squash and stretch, dust, confetti. Hurts flash, freeze briefly and shake the screen. Helps get a green ring and never shake. H turns shake off | 9 |
| Art | Plain shapes drawn in code, waiting for your drawings | 10.2 |

---

## 1. Game overview

**Title:** Frenymies

**One-line pitch:** Your answer:
> Example: "Up to 4 friends race through chaotic obstacle courses, where every jump is a choice: give your friend a hand, or push them off the edge."

**3 game pillars** (what every feature must support):
1. Chaotic, funny physics
2. Every round forces a help-or-hurt choice
3. A match lasts 5 to 10 minutes, so "one more game" is easy

Your changes:

**Players:** 1 to 4 per match **(pre-filled)**. Empty seats filled by bots? `[x] yes` `[ ] no`
**Rec:** yes. It lets 2 friends play a full 4-player match.

**Platforms:** `[x]` browser on laptop/desktop `[ ]` phone browsers too (touch controls) `[ ]` gamepad support
**Controls:** keyboard only for v1 (Raven, 2026-10-01). Gamepad and touch can come later.

**Audience:** `[ ]` me and my friends `[x]` public, anyone with a link `[ ]` both
Public means anyone with the link can join, so the security basics in 13.8 (rate limits) matter more. No chat in v1 (section 12) keeps it safe.

**Match length target:** 5 to 10 minutes, 3 rounds (Raven, 2026-10-01)

**Language(s):** `[x]` English `[ ]` Filipino `[ ]` both

---

## 2. Core technical decisions

### 2.1 2D or 3D (the biggest decision in this file)

| Option | Feels like | Build time to first playable | Difficulty |
|---|---|---|---|
| `[ ]` **A. 3D low-poly** (three.js) | Real Fall Guys | 8 to 12 weeks | Hard: 3D physics online, camera, character feel |
| `[x]` **B. 2D side view** (Phaser) | Fall Guys meets Pico Park / Mario Party | 4 to 6 weeks | Medium |
| `[ ]` **C. 2D top-down** (Phaser) | Fall Guys from above, like Stumble Guys minigames seen from a drone | 4 to 6 weeks | Medium, but jumping is awkward from above |

**Rec:** **B (2D side view) first.** Pushing people off ledges and pulling them up are very readable from the side, and it is half the build time. Moving to 3D later reuses the whole backend, the rooms, the round system and the twist rules; only the physics and graphics change. If "it must feel like real Fall Guys" matters more than speed, pick A and accept the longer timeline.

Your answer: **B, 2D side view** (2026-10-01)

### 2.2 Camera / view

- If 3D: `[ ]` third person behind your own character `[ ]` fixed angled camera showing everyone
- If 2D side view: `[ ]` camera follows you `[x]` camera shows all 4 players and zooms out as they spread

Raven's note: "Follows me a bit but it has a shared zoom, for each player's POV." So each player's screen uses the shared zoom that fits everyone, but leans a little toward their own bean. Online, every player has their own screen, so this is easy to do.

**Rec (2D):** shared camera that zooms to fit everyone, like Smash Bros. You see every help or hurt moment, which is the whole point of the twist.

### 2.3 Physics

| Choice | Rec |
|---|---|
| Physics engine | **Rapier** (runs on both server and browser, 2D and 3D versions, same results on both sides) |
| Who decides what really happened | **The server** (server-authoritative), so nobody can cheat a push or a win |
| Physics rate | 60 steps per second on the server |
| Network update rate | 20 to 30 snapshots per second to each player |

Note: Phaser's built-in Arcade Physics only runs in the browser, so for online play the server needs its own physics (Rapier). We would use Phaser for graphics, input and screens, and Rapier for the real simulation.

Prototype: uses Arcade Physics because it is local only. The jump and shove numbers in 5.5 and 9.1 are the feel to match when we move to Rapier.

**Changed in milestone 2 (2026-10-02):** bean movement is our own small piece of code (`packages/shared/src/sim.ts`), not Rapier. The server and the browser run the exact same code, so your own bean can be predicted perfectly: in testing, 0 corrections even at 300 ms lag. Rapier comes in later, only for obstacles that tip, roll or swing (seesaw, rolling ball), from milestone 4. **Update (milestone 4):** the seesaw turned out simple enough to build without it (two linked halves), so Rapier is still not used; the rolling ball may need it.

Your changes:

### 2.4 Tech stack (pre-filled)

| Part | Choice | Why |
|---|---|---|
| Language | TypeScript everywhere | Client and server share types and game rules |
| Client (2D) | Phaser 4 | We have the Phaser skills installed |
| Client (3D) | three.js | We have the three.js skills installed |
| Physics | Rapier (`@dimforge/rapier2d-compat` or `rapier3d-compat`) | Same simulation on server and client |
| Server | Node.js 24 + `ws` (or `uWebSockets.js` later) | Long-lived WebSocket rooms |
| Message checking | Zod | Reject bad or malicious messages at the door |
| Build tool | Vite | Fast local dev for the client |
| Tests | Vitest | Game rules and round logic |
| Database | None at first. Postgres + Redis later for accounts/stats | Rooms live in memory |

---

## 3. Core gameplay loop

### 3.1 One match ("a show")

```
Lobby (up to 4, ready up)
   -> Round 1 intro (name, rules, 5 sec)
   -> Countdown 3-2-1
   -> Play round (60 to 120 sec)
   -> Round results (who qualified, help/hurt highlights)
   -> Round 2 ... -> Final round
   -> Winner screen + match stats (most helpful, biggest traitor)
   -> Rematch or back to lobby
```

### 3.2 Elimination with 4 players **(needs your decision)**

| Round | Players in | Players out | Example |
|---|---|---|---|
| 1 | 4 | 1 | Race: first 3 to finish qualify |
| 2 | 3 | 1 | Survival: last 2 standing qualify |
| 3 (final) | 2 | 1 | Final: one winner |

`[ ]` Use this table
`[x]` No elimination, everyone plays every round and collects points (better for 4 friends, nobody sits out)
`[ ]` Other: Your answer:

**Rec:** points-based with no elimination for v1. With only 4 players, sitting out after round 1 is boring. If you want elimination, see 3.3.

### 3.3 What eliminated players do

`[x]` Just watch (spectate) (Raven, 2026-10-02)
`[ ]` **Become ghosts** that can still help or hurt the players left (e.g. drop a boost pad or a banana)
`[ ]` Nothing, points mode means nobody is eliminated

**Rec:** ghosts, if you choose elimination. It extends the twist to everyone.

**How this fits with points mode:** nobody leaves the match, but in survival rounds a knocked-out player is out for the rest of that round (see 5.2). For those seconds they spectate, then rejoin normally next round. Raven first picked ghosts, then changed it to spectate on 2026-10-02. Ghosts can come back later as a fun mode.

### 3.4 Every match is different (decided 2026-10-01)

**Decided:** a match is always 3 rounds, but every match has different settings and difficulty. Rounds feel like stages: clear one, and the next one is harder.

What changes from match to match (Raven's answers, 2026-10-02):

| Setting | Decided |
|---|---|
| Which 3 rounds | Random from the pool, always ending on a Final round |
| Difficulty levels | Easy, Normal, Hard (Chaos later as a fun mode) |
| Who sets it | Random each match, no host setting |
| Inside a match | Each round is harder than the last |
| Course layout | Same course shape, small random changes from the match seed (gaps, platform positions, obstacle timing), rolled once per match |
| Scenery | Each match picks one of Raven's 10 themes (10.2) |
| Modifiers (low gravity, no double jump...) | None in v1, add after playtests |

What a difficulty level changes: platform width and gap size, obstacle speed, number of hazards, number of checkpoints, round timer, bot skill. Each level is one set of numbers, so tuning stays in one place.

Random difficulty plus "each round gets harder" means: the match rolls Easy, Normal or Hard, and inside it round 1 is the easy end of that level and the final is the hard end.

Netcode note: the server only sends the match seed and the difficulty. Every client builds the same course from them (see section 7 and 13.3).

---

## 4. Characters and controls

### 4.1 Character

- Look: `[x]` jellybean like Fall Guys `[ ]` blob `[ ]` animal `[ ]` other. Plain colored jellybeans for now, Raven provides the final art.
- Customization in v1: `[ ]` color only `[x]` color + hat `[ ]` none
- Hats: 4 to 6 to start, drawn separately so any hat sits on any color (see 10.2).

### 4.2 Moves

| Move | Include? | In prototype | Notes |
|---|---|---|---|
| Run | `[x]` | yes | |
| Jump | `[x]` | yes | Tap = small hop, hold = full jump |
| Double jump | `[x]` | yes | One extra jump in the air. Lost when shoved or thrown until you land. Fewer missed jumps means fewer save moments, so playtest it |
| Dive (forward leap) | `[x]` | yes | Fall Guys signature move, good for recovering |
| Grab | `[x]` | yes | Needed for both help (pull up) and hurt (hold back) |
| Push / shove | `[x]` | yes | Main "hurt" move. Also knocks a hanging player off the ledge |
| Throw (after grab) | `[x]` | yes | Release grab to throw (auto-throws after 1.8 s). Throw someone off, or across a gap to help |
| Ledge hang + climb | `[x]` | yes | Hang 2.5 s, mash jump to climb, or wait to be pulled up. Creates the save moment |
| Emote | no | no | Not in v1 (Raven, 2026-10-02) |

### 4.3 Controls

v1 is keyboard only (Raven, 2026-10-01). The gamepad and touch columns are for later.

| Action | Keyboard | Gamepad (later) | Touch (later) |
|---|---|---|---|
| Move | A/D (W/S too if 3D) | Left stick | Left thumb pad |
| Jump / double jump | W or Space (press again in the air) | A | Button |
| Dive | Shift | X | Button |
| Grab / pull up | E (hold) | RT | Button |
| Push | F | B | Button |
| Throw | Let go of E (throws the way you face) | Release RT | |

Prototype keys today: Player 2 on the same keyboard uses J/L move, I jump, K dive, U grab, O push. Extra keys: 2 adds Player 2, H toggles screen shake, R restarts. Arrow keys are not wired up yet.

Your changes:

---

## 5. The twist: help or hurt

This is what makes the game different from Fall Guys. Fill this section carefully.

### 5.1 Actions

**Help actions** (tick the ones you want):
- `[x]` **Pull up:** grab someone hanging off a ledge and save them
- `[ ]` **Boost:** let someone jump off your head for extra height
- `[x]` **Throw across:** throw a player over a gap they couldn't jump
- `[x]` **Hold the door:** stand on a pressure plate so others can pass (co-op obstacles)
- `[ ]` **Share a power-up:** give your shield or speed boost to someone
- `[ ]` **Revive:** bring back a knocked-out player faster
- `[ ]` Other: Your answer:

**Hurt actions:**
- `[x]` **Push / shove:** knock someone off a platform
- `[x]` **Grab and hold:** slow someone down
- `[x]` **Throw off:** grab, then throw them off the map
- `[ ]` **Fake help:** pull someone up, then drop them (betrayal)
- `[ ]` **Traps:** drop a banana, oil slick or fake platform
- `[ ]` **Steal:** take someone's power-up or points
- `[ ]` Other: Your answer:

Fake help still happens naturally (pull someone halfway, then let go), it just isn't a separate move.

### 5.2 What "kill" means

`[ ]` **Knockout + respawn:** you fall off, lose a few seconds, respawn at the last checkpoint (Fall Guys race style)
`[ ]` **Knockout = out for this round** (survival rounds only)
`[x]` Depends on the round type (race = respawn, survival = out)

**Rec:** depends on the round type. Being out for good in a race round feels bad; in survival rounds it is the point.

Cartoon style only? (no blood, beans just "pop" or fly off screen) `[x]` yes `[ ]` no
**Rec:** yes, keeps it funny and friendly to share with anyone.

### 5.3 Why help, why hurt (the scoring that makes the choice matter)

If hurting is always better, nobody helps. The twist only works if **both choices pay off**. Pick one model:

`[ ]` **A. Karma and Bounty**
- Helping earns **Karma**. Karma gives perks: a free respawn, a small speed boost, or bonus points at the end.
- Hurting earns **Bounty** points right away, but the player with the most Bounty **glows**, and anyone who knocks them out steals part of it.
- End of match awards: *Saint* (most help), *Traitor* (most betrayals), *Winner*.

`[x]` **B. Points for both, bigger reward for trust** (Raven, 2026-10-01)
- Each help = +X points, each knockout = +Y points.
- Some obstacles **need 2 players** to pass (co-op doors, see-saws), so you need allies to reach the finish.

`[ ]` **C. Secret roles** (Among Us style)
- One random player each round is secretly the **Saboteur**, who wins by knocking others out. Everyone else wins by finishing together.

`[ ]` Mix: Your answer:

**Rec:** **A (Karma and Bounty)** for v1. It is the easiest to understand, it creates the "do I trust them?" moment every time, and the glowing target stops one player from just bullying the others. C is great as a special round later.

**Decided: B.** What this changes:
- The prototype runs model A. The real game drops Karma, Bounty and the TARGET tag in favour of plain points: +X per help, +Y per knockout.
- Co-op obstacles become essential, because they are what make helping pay. Every round in the pool needs at least one spot that 2 players must pass together.
- The TARGET tag was the safety valve against one player bullying the rest. B needs a new one. Options to pick from later: help is worth more than a knockout (X > Y), knockouts on the same player within a few seconds give fewer points, or the anti-griefing rules in 5.4 do the job.
- End of match awards stay the same: Winner (most points), Saint (most helps), Traitor (most knockouts).

### 5.4 Anti-griefing / keeping it fun

- `[x]` A player can't be grabbed again for 2 seconds after escaping a grab (not in prototype)
- `[x]` Spawn protection: 2 seconds of immunity after respawning (prototype: 1.5 s, bean blinks)
- `[x]` Pushes have a cooldown (e.g. 1.5 sec) (prototype: 1.2 s)
- `[x]` Catch-up help: last place gets a small boost (not in prototype)
- Other: Your answer:

All four picked (Raven, 2026-10-02). Together they are also the anti-bullying safety valve that model B needed (5.3).

Prototype extras: 0.6 s of protection after climbing up a ledge; held players can't be grabbed or shoved by a third player.

### 5.5 Numbers to tune later

First column is the original guess, second is what the prototype uses now after playing it. The prototype values are the current best starting point. The Karma, Bounty and TARGET rows only apply to the prototype (model A); the real game uses model B points instead.

| Value | First guess | Prototype now |
|---|---|---|
| Push strength | TBD | 700 sideways, 430 up |
| Push cooldown | 1.5 s | 1.2 s |
| Push reach | | 72 px |
| Stun after a shove | | 0.5 s |
| Grab reach | | 70 px |
| Grab hold max time (then auto-throw) | 3 s | 1.8 s |
| Throw strength | | 720 sideways, 700 up |
| Ledge hang time | | 2.5 s |
| Jump presses to climb alone | | 6 |
| Karma per help (pull up) | 1 | 1 |
| Karma for a free respawn | 3 | 3, spent automatically, respawn where you last stood |
| Bounty per knockout | 1 | 1 |
| KO credit window after a shove/throw | | 4 s |
| TARGET tag | glows | sole Bounty leader with 2 or more |
| Bounty stolen from the TARGET | 50% | 50% (rounded up) |
| Respawn delay | 2 s | 1.6 s |
| Spawn protection | 2 s | 1.5 s |
| Round time | 60 to 120 s | 100 s (Ledge Run takes 25 to 45 s with bots) |
| Qualify per race | | first 3 |

---

## 6. Rounds

### 6.1 Round types

| Type | Goal | Help/hurt angle |
|---|---|---|
| **Race** | Reach the finish | Push rivals off, or pull people up ledges |
| **Survival** | Be the last on the platform | Knock others off, or team up against the leader |
| **Co-op gate** | Obstacles need 2+ players | Help is required to progress, but who gets through first? |
| **Hunt / tail tag** | Hold the tail/crown when time runs out | Steal it, or pass it to protect an ally |
| **Trust bridge** | Bridge only holds 2 people | Prisoner's dilemma: cross together or push someone off |
| **Final** | One winner | Everything allowed |

### 6.2 Round idea bank (add your own)

| # | Name | Type | Description | Help moment | Hurt moment |
|---|---|---|---|---|---|
| 1 | Ledge Run | Race | Platforms over a pit, moving blocks | Pull up a hanging player | Push someone mid-jump |
| 2 | Hot Plate | Survival | Tiles fall away one by one | Throw someone to a safe tile | Grab and drag toward a falling tile |
| 3 | Two-Key Door | Co-op gate | Doors open only while someone holds a plate | Hold the plate | Let go of the plate halfway |
| 4 | Trust Bridge | Final | Narrow bridge over lava, breaks if 3+ stand on it | Cross together | Push someone off to lighten it |
| 5 | Tail Tag | Hunt | Everyone chases whoever holds the tail; hold it when time runs out | Pass the tail to an ally who is about to be caught | Steal it, or shove the holder off a ledge |
| 6 | Your idea | | | | |

### 6.3 Round pool for v1 (each match draws 3)

Since every match is different (3.4), v1 needs more than 3 rounds.

Rounds in the pool: **Ledge Run (race), Hot Plate (survival), Two-Key Door (co-op gate), Tail Tag (hunt), Trust Bridge (final)** (Raven, 2026-10-02, took the recommendation)

Trust Bridge is the only Final, and every match ends on a Final, so in v1 every match ends on Trust Bridge. Rounds 1 and 2 are drawn from the other 4. A second Final can be added later so the ending varies too.

**Rec:** 5 rounds: Ledge Run (race), Hot Plate (survival), Two-Key Door (co-op gate), Tail Tag (hunt), Trust Bridge (final, always the last round). Together they show off every side of the twist, and back-to-back matches rarely repeat.

---

## 7. Obstacles catalog

Timed obstacles move on a fixed timer from the round's start, so the server only sends the start time and every client computes the motion itself (saves bandwidth, keeps everyone in sync). Obstacles that react to players (falling platform, seesaw, push button) are run by the server.

**Raven's list (2026-10-02), 36 obstacles.** That is too many to build before the first playtest, so they go in two steps.

**Step 1: starter set** (on top of what the prototype already has: moving platform, bounce pad, swinging hammer)

| Obstacle | Why it is first |
|---|---|
| Falling platform | Simple, creates save moments |
| Rotating bar | Classic knock-off hazard |
| Conveyor belt | Easy to build, changes how pushes land |
| Seesaw | Two players change it together: help or hurt |
| Giant fan | Pushes sideways, sets up throws across gaps |
| Closing gate + push button | The co-op "hold the door" spot that model B needs |
| Fake floor tile | The betrayal moment: who steps on it first? |

**Step 2: the rest, added round by round after playtests**

- Basic: disappearing platform, sliding block, pushing block, rolling ball, moving wall, jumping bar, ice floor, mud/slow zone, wind zone, falling objects, crushing walls, rotating blade
- Fun / chaotic: rotating door, treadmill, catapult, random door, bomb/timer object
- Extra: punching glove, pendulum ball, random bounce zone, spinning platform, trapdoor, water cannon, rolling log, earthquake floor

Doubles in the list, built once with different art: "Seesaw" and "Seesaw Platform"; "Wind Zone" and "Giant Fan"; "Swinging Hammer" and "Pendulum Ball".

---

## 8. Power-ups (optional for v1)

`[x]` No power-ups in v1 (Rec: skip them until the core push/pull feels good)
`[ ]` Include:
- `[ ]` Shield (blocks one push)
- `[ ]` Speed burst
- `[ ]` Super push
- `[ ]` Banana trap
- `[ ]` Other: Your answer:

---

## 9. Game feel

Describe how it should feel. This guides tuning.

- Movement: `[ ]` floaty and silly (Fall Guys) `[ ]` tight and precise (Celeste) `[x]` in between (Raven, 2026-10-02, matches 9.1)
- Pushes: `[ ]` small nudges `[ ]` big launches across the screen
- Falls: `[ ]` instant `[ ]` slow-motion "noooo" moment
- Camera shake on hits: `[ ]` yes `[ ]` no
- Reference games to copy the feel from: Your answer:

### 9.1 Prototype feel numbers (what you have been playing)

Movement sits **in between** floaty and precise. The jump is set by how it should feel (height and time to the top), and gravity is worked out from that.

| Value | Prototype | What it does |
|---|---|---|
| Jump height | 150 px | Full jump with jump held |
| Time to the top | 0.36 s | Gives gravity ~2315 and jump speed ~833 |
| Fall gravity | 1.6x | Falling is heavier than rising, so jumps don't feel floaty |
| Apex hang | 0.55x gravity | A little float at the top while jump is held, for air control |
| Jump cut | 0.45 | Letting go early cuts the rise: tap = hop |
| Coyote time | 0.1 s | You can still jump just after running off a ledge |
| Jump buffer | 0.12 s | A jump pressed just before landing still counts |
| Double jump | 0.85 strength | Set to 0 to turn it off |
| Run speed | 360 px/s | |
| Dive speed | 580 px/s | |
| Bounce pad | 1180 up | |

Feedback tiers: small hits shake a little with no freeze, medium hits (shove) shake and freeze 0.06 s, large hits (knockout) shake hard and freeze 0.11 s. Helping never shakes or freezes.

---

## 10. Art and audio

### 10.1 Visual style

`[x]` Smooth cartoon (Raven, 2026-10-02)
`[ ]` Flat and minimal: solid colors, simple shapes
`[ ]` Pixel art (would need an asset pack or an artist)

**Color palette:** 8 to 12 colors, red kept for hazards only. Raven provides the backgrounds, following "Backgrounds: how to make them" in 10.2.

**Asset source:** `[ ]` drawn in code `[x]` my own art (Raven) `[ ]` Kenney.nl (free, CC0) `[ ]` bought pack `[ ]` artist

**Making the art:** Raven will generate it (2026-10-01). Generated art still has to follow the checklist below: one style, one palette, transparent PNGs at 2x size, and the same bean shape in every pose. Until it arrives the game uses plain colored jellybeans.

### 10.2 Asset checklist (if drawing my own art)

Every item below is a plain placeholder shape in the 2D prototype today. Tick `[x]` when drawn.
Draw in tier order: Tier 1 alone already makes the game look like yours.

**Before drawing**
- One style for everything. Smooth cartoon matches the current beans; pixel art means redrawing them too.
- Pick an 8 to 12 color palette first (fill in 10.1). Keep the background soft and muted so beans and red hazards pop.
- Export transparent PNGs, at 2x the in-game size. Sprite sheets (all frames in one image) load easiest in Phaser.
- Start small: 1 bean pose + 1 platform piece + 1 sky, drop them into the prototype, then draw the rest.

**Tier 1: must have**

*Bean character* (in-game ~36x44 px, draw at 72x88 or bigger). Draw it **white/light grey**: the game tints it per player, so one drawing covers all 4.
- `[ ]` Idle
- `[ ]` Run (4 to 6 frames)
- `[ ]` Jump
- `[ ]` Fall
- `[ ]` Dive (lying flat)
- `[ ]` Hanging from a ledge
- `[ ]` Grabbing / carrying someone
- `[ ]` Hit / dizzy
- `[ ]` Celebrate (qualified / win)
- `[ ]` Faces: happy, sneaky (shoving), shocked (hit), grateful (saved)

*Platforms* (one repeating tileset, any width)
- `[ ]` Left edge piece
- `[ ]` Middle piece (repeats)
- `[ ]` Right edge piece
- `[ ]` Top strip (grass or colored edge)
- `[ ]` Underside / dirt fill

*Backgrounds: how to make them* (same steps for every theme)
- Size: each layer 2560 x 1440 px, and it must repeat left to right with no visible seam (the course is 4300 px long, so it repeats).
- 4 layers per theme, back to front:
  - Sky: full image, does not move
  - Far layer (hills, skyline): moves at 20% of the camera
  - Middle layer: moves at 45%
  - Near layer (bushes, clouds, props): moves at 70%
- Far, middle and near layers are transparent PNGs. Only the sky fills the whole image.
- Keep them calm and muted so the beans stand out. No red (red means danger), no text.
- Put the horizon about 60% of the way down.
- File names: `theme-layer.png`, e.g. `volcano-sky.png`, `volcano-far.png`, `volcano-mid.png`, `volcano-near.png`, saved in `Frenymies\art\backgrounds`.

*Your first theme* (do one fully, test it in the game, then do the rest)
- `[ ]` Sky
- `[ ]` Far layer
- `[ ]` Middle layer
- `[ ]` Near layer

*All 10 themes* (each match picks one)
- `[ ]` Volcano (keep the lava for hazards, so the background stays darker and calm)
- `[ ]` Candy Land
- `[ ]` Beach Island
- `[ ]` Haunted Castle
- `[ ]` Factory
- `[ ]` Cloud Kingdom
- `[ ]` Desert Ruins
- `[ ]` Arcade World
- `[ ]` Jungle
- `[ ]` Amusement Park

**Tier 2: course objects**

| Done | Object | Now in prototype | Draw |
|---|---|---|---|
| `[ ]` | Moving platform | grey bar | floating platform with gears, propeller or cloud |
| `[ ]` | Bounce pad | purple strip "BOUNCE" | spring, trampoline or mushroom (normal + squished) |
| `[ ]` | Swinging pendulum | red ball on a line | mace, hammer or punching glove + its anchor |
| `[ ]` | Checkpoint flag | white rectangles | flag on a pole (down + raised) |
| `[ ]` | Finish line | white post + "FINISH" text | finish arch or banner |
| `[ ]` | Fall zone | nothing | slime, water or cloud sea at the bottom |
| `[ ]` | Hats (4 to 6) | none | about 72 x 48 px, facing right, drawn separately so they sit on any bean |
| `[ ]` | Falling platform | none | platform with cracks (normal + shaking) |
| `[ ]` | Rotating bar | none | long bar with a center pivot |
| `[ ]` | Conveyor belt | none | belt strip with arrows or rollers (2 to 3 frames) |
| `[ ]` | Seesaw | none | plank + pivot |
| `[ ]` | Giant fan | none | fan body + blades (2 to 3 frames), wind lines |
| `[ ]` | Closing gate + push button | none | gate (open + closed), button (up + pressed) |
| `[ ]` | Fake floor tile | none | looks like a normal platform, plus a crumble frame |

The rest of the obstacle list (section 7, step 2) gets art when its round is built.

**Tier 3: effects (the help-or-hurt feel)**
- `[ ]` Dust puffs (jump, land, run)
- `[ ]` Hit sparks / star burst (shoved)
- `[ ]` Help sparkle: green ring or hearts (saved someone)
- `[ ]` Shove swipe (whoosh arc)
- `[ ]` Dizzy stars over a stunned bean
- `[ ]` Knockout poof / splash (fell off)

**Tier 4: UI**
- `[ ]` Game logo
- `[ ]` Countdown: 3, 2, 1, GO!
- `[ ]` Name tag above beans
- `[ ]` Icons: help, hurt, points, qualified, out
- `[ ]` Round results screen + buttons (Play again, Menu)

### 10.3 Audio

- Music: `[ ]` none in v1 `[x]` free/royalty-free tracks
- Sound effects: jump, push, grab, fall, qualify, win. Source: free CC0 packs, or made in jsfxr (Raven, 2026-10-02)

---

## 11. Screens and UI

| Screen | Contents | Notes |
|---|---|---|
| Home | Name input, **Create room**, **Join with code** | No account needed |
| Lobby | 4 player slots, colors, hats, ping, Ready button, **Copy invite link** | Link: `frenymies.vercel.app/r/K7QX`. Built: scoreboard top right marks [ready], R readies, C copies the link, ping top left. Hats come with the art |
| Round intro | Round name, 1-line rules, 5 s | |
| In-game HUD | Timer, position/qualified count, points, cooldown icons | Keep it small |
| Round results | Qualified/out, highlights ("Ava saved Ben 3 times") | Built: places, points, helps, KOs, Saint/Traitor, and the biggest help and hurt of the round |
| Match end | Winner, Saint, Traitor, stats, **Rematch** | |
| Spectate | Knocked out of a survival round | Watch until the round ends. Built: "You are out" and [out] on the scoreboard |
| Settings | Volume, controls, name, hat | |
| Disconnected | "Reconnecting..." with timer | |

Anything to add: Your answer:

---

## 12. Multiplayer and social features (pre-filled from our chats)

- **Rooms:** private by default, 4-letter code, invite link
- **Host:** the room creator starts the match. Rounds and difficulty are random, so there is nothing else to set
- **No accounts:** guest name only in v1
- **Reconnect:** 30 seconds to rejoin the same match if Wi-Fi drops
- **Bots:** fill empty seats (see section 1)
- **Ping display** in the lobby
- **Chat:** `[x]` none `[ ]` quick-chat buttons only ("Help!", "Sorry!", "Traitor!") `[ ]` free text
  None in v1 (Raven, 2026-10-02). Nothing to moderate, which suits a public game.
- **Quick Match with strangers:** `[ ]` v1 `[x]` later

---

## 13. Technical architecture

### 13.1 Big picture

```
 Players' browsers
   │  1. load the game (HTML/JS/assets)
   ├──────────────► Vercel  (free, static client)
   │
   │  2. play (WebSocket, wss://<game-server-domain>)
   └──────────────► Caddy (TLS) ──► Game server :3100 (Node + Rapier)
                    VPS, Singapore, already paid for
```

### 13.2 Game server parts

```
Game server
 ├─ Connection manager   (WebSockets, heartbeats, rate limits, reconnect tokens)
 ├─ Room manager         (create/join by code, lobby, host, ready, bots)
 ├─ Show director        (the round list, round intro -> play -> results -> next)
 ├─ Round runtime        (one per active round)
 │    ├─ Physics world   (Rapier, 60 steps/s)
 │    ├─ Round rules     (race / survival / co-op gate ... as plugins)
 │    ├─ Twist system    (tracks help/hurt events and points)
 │    └─ Bot brains      (simple AI for empty seats)
 └─ Snapshot sender      (20-30 updates/s to each player)
```

Each round type is a **plugin** with the same interface, so adding a new round never touches the core:

```ts
interface RoundModule {
  id: string;                  // "ledge-run"
  type: "race" | "survival" | "coop" | "hunt" | "final";
  durationSec: number;
  buildLevel(world: PhysicsWorld, seed: number): Level;
  onPlayerEvent(e: PlayerEvent): void;   // fell, finished, grabbed, pushed...
  qualified(): PlayerId[] | null;        // null until the round ends
}
```

### 13.3 Netcode model

| Topic | Approach |
|---|---|
| Authority | The server runs the real physics. Clients never decide positions, hits or wins. |
| Player input | Client sends inputs only (move, jump, dive, grab, push) with a sequence number, 60 times/s, batched |
| Own character | **Client prediction:** your bean moves instantly on your screen, then corrects smoothly if the server disagrees |
| Other players | **Interpolation:** shown about 100 ms in the past so their movement is smooth (more on a shaky connection, up to 400 ms). If a packet is late, their bean keeps moving for up to 130 ms with the buttons they last held, then eases into the real position |
| Uneven input arrival | The server keeps 50 ms of each player's inputs in hand and applies them one per tick, so nobody stutters on other screens. After a lag spike it catches up quickly, but nobody can move faster than 60 ticks a second on average |
| Frozen tab / dropped Wi-Fi | After 500 ms with no input, the server keeps that bean falling with no buttons pressed |
| Push / grab between players | Resolved on the server. When lag makes it unclear: **favor the pusher** (Raven, 2026-10-02). If it looked like a hit on the pusher's screen, it counts. Shoves feel snappy; the cost is that the victim sometimes gets hit by a shove that looked like a miss on their screen. Revisit after the lag tests |
| Obstacles | Driven by the round's start time + seed, computed on every client, not sent every frame |
| Clock | Clients sync to the server clock at join and every few seconds |
| Expected latency | 90 to 200 ms measured from Raven's laptop to the VPS (2026-09-30). Fine for a party game |

### 13.4 Messages

As built (milestone 5). The full shapes are in `packages/shared/src/protocol.ts`, checked with Zod on the server.

**Client to server:**

| Message | Contents |
|---|---|
| `hello` | name, room code (joining an unknown code makes the room) |
| `ready` | on or off (lobby only) |
| `input` | up to a few `[seq, buttons, viewTick]` at a time; viewTick is the tick the other beans were drawn at (favor the pusher) |
| `ping` | client time |

**Server to client:**

| Message | Contents |
|---|---|
| `welcome` | your id, your slot (color), room code, server tick |
| `roster` | who is in the room, names, colors |
| `round` | phase, the match's 3 rounds, which one is on, seed + difficulty (every browser builds the course from these), start/end ticks, who is ready / finished / out, and the results table with Saint, Traitor, winners and highlights |
| `snap` | 30 times a second: tick, your last applied input and the tick it ran at, every bean's state, events (shoves, saves, knockouts, steals...), and the moving parts of the course |
| `error` | code, message (room full, bad message, too many messages) |
| `pong` | client time back, server tick |

Format: JSON for v1. Snapshots are about 78 KB/s per player, so they get slimmed (or go binary) before milestone 6.

### 13.5 Room and match state machine

As built (milestone 5):

```
LOBBY (practice on Ledge Run, R = ready) -- everyone ready -->
  INTRO (round card 3 s, then 3-2-1) -> PLAY (until the timer or the round's own end) -> RESULTS (8 s)
     ^                                                                                    │
     └──────────────────────── more rounds? yes ──────────────────────────────────────────┘
                                                                                          │ no
  LOBBY <──────────────── SHOW (winner, final table, Saint, Traitor, 12 s) <──────────────┘
```

A round's own end: races when 3 have finished (or everyone, with 3 players or fewer), the final at the first finish, survival when 1 is left, hunt only on the timer. Back in the lobby, readying up again is the rematch.

### 13.6 Data (what is stored where)

| Data | Where | When |
|---|---|---|
| Rooms, rounds, positions | Server memory | v1 |
| Reconnect tokens | Server memory | v1 |
| Player name, color, settings | Browser localStorage | v1 |
| Match history, stats, leaderboards | Postgres | Later, only if wanted |
| Multiple servers, presence | Redis | Only if the game outgrows one server |

### 13.7 Project folder layout

```
Frenymies/
  GAME-PLAN.md          <- this file
  packages/
    shared/             # message types, zod schemas, constants, physics settings
    rounds/             # one folder per round plugin (ledge-run, two-key-door, ...)
  server/               # Node game server (deployed to the VPS)
  client/               # Phaser or three.js client (deployed to Vercel)
  tools/                # level editor helpers, bot testers
```

### 13.8 Security basics

- Server validates every message (Zod) and ignores impossible inputs
- Rate limit inputs per connection; kick flooders
- Max message size
- Room codes are random, not guessable in order
- No personal data collected in v1

---

## 14. Hosting, deployment and cost (pre-filled)

| Part | Where | Cost |
|---|---|---|
| Client | Vercel Hobby (`frenymies.vercel.app`) | Free (non-commercial only; Pro $20/mo if it ever makes money) |
| Game server | Existing VPS, Singapore, port 3100, systemd service | $0 extra |
| HTTPS / WebSocket | `handle_path /frenymies/*` in the <game-server-domain> block of `the server's Caddy config`, so `wss://<game-server-domain>/frenymies/ws` | $0 |
| Domain | None new: a path on <game-server-domain> for the server, the free Vercel address for the page | $0 |
| Testing with friends before deploy | Cloudflare quick tunnel | Free |

**Bandwidth estimate:** about 4 to 8 KB/s per player, so a 4-player hour is roughly 60 to 120 MB. Far inside the VPS allowance.

Deploy rules: server changes need Raven's OK first, because other services run on the same box.

On the real server, start the game server with `ALLOW_TUNNEL=0` and `ALLOWED_ORIGINS` set to the real game address. By default it also accepts pages from Cloudflare tunnel links, which is only meant for sharing from the laptop.

Custom domain for the game: none for now. Free Vercel address, kept private: not linked or listed anywhere, and rooms need a code (Raven, 2026-10-02).

---

## 15. Testing plan

| Test | How |
|---|---|
| Round rules and scoring | Automated tests (Vitest), no browser needed |
| Netcode under lag | Built-in lag/packet-loss simulator (e.g. add 150 ms + 5% loss) |
| 4 players alone | 4 browser tabs on one laptop |
| Real friends before deploy | Cloudflare tunnel link: **built 2026-10-02**. Double-click "Share Frenymies Online" on the Desktop (or `Play-Frenymies-Online.cmd share`). It builds the game page, opens a temporary link like `https://random-words.trycloudflare.com/?room=K7QX`, copies it and opens it. Keep the window open while you play; closing it stops everything and the link dies. Measured: about 145 ms ping through the link, 0 corrections, 365 KB page download |
| Bots | Run a match with 4 bots to catch crashes |
| Playtest sessions | After each milestone, 20 minutes with friends, write feedback below |

**Playtest notes:**
- Date / what we tested / what felt bad / what to change:

---

## 16. Milestones

| # | Milestone | Done when | Est. (2D / 3D) |
|---|---|---|---|
| 0 | Plan complete | All Top decisions filled | This week |
| 1 | Movement sandbox | One bean runs, jumps, dives on a test level, locally | 1 wk / 2 wk. **2D: done in the prototype** (plus bots, the twist core and Ledge Run, all local). The online game has since replaced it (milestones 2 to 5) |
| 2 | Online movement | 4 tabs see each other move smoothly via the server | 1 wk / 2 wk. **Done 2026-10-02**, see "Milestone 2: what was built" below |
| 3 | Twist core | Push, grab, pull-up, knockout, help and knockout points working | 1 wk / 2 wk. **Done 2026-10-02**, see "Milestone 3: what was built" below |
| 4 | First round | Ledge Run playable start to finish, with Easy/Normal/Hard and the 7 starter obstacles | 1 wk / 2 wk. **Done 2026-10-02**, see "Milestone 4: what was built" below |
| 5 | Round pool + full show | The other 4 rounds with difficulty levels; lobby with difficulty setting, invite link, 3 rounds drawn from the pool, results, rematch | 3 wk / 5 wk. **Done 2026-10-02**, see "Milestone 5: what was built" below (difficulty stays random, no host setting, per the 2026-10-02 decision) |
| 6 | Friends test | Deployed (Vercel + the VPS), first real playtest | 0.5 wk / 1 wk. **Deployed 2026-10-03**, see "Milestone 6: what was built" below; first real playtest still to do |
| 7 | Polish | Sounds, music, effects, hats, reconnect | 1 to 2 wk |

### Milestone 2: what was built (2026-10-02)

- `packages/shared`: the level, the movement rules and the message formats, used by both sides
- `server`: the game server (Node 24 runs the TypeScript directly), rooms of up to 4, room codes, 50 ms input buffer, message checks (Zod), rate limit, max message size, browser origin check
- `client`: join screen (name + room code), Phaser 4 game with prediction for your bean, smoothing for everyone else, shared zoom camera that leans toward you
- `tools/bots.ts`: 3 test bots that run around the level, so one person can test a full room
- Lag test built in: press L in the game to cycle off / 150 ms with 5% loss / 300 ms with 10% loss. G shows where the server has your bean. The top-left counters show corrections and how far in the past others are drawn
- 21 automated tests (movement, input buffer, server end to end): `npm test`

Measured in the browser with 3 bots, over 10 seconds of running, jumping and diving per setting:

| Lag test | Corrections to your bean | Other beans frozen | Others shown in the past |
|---|---|---|---|
| off | 0 | 0% of frames | 100 ms |
| 150 ms, 5% loss | 0 | 0% | about 190 ms |
| 300 ms, 10% loss | 0 | 0% | 400 ms |

How to play it: double-click "Play Frenymies Online" on the Desktop (starts the server, the game page and 3 bots, then opens room TEST). Without bots: run `Play-Frenymies-Online.cmd` in the Frenymies folder.

Not in milestone 2 (on purpose): beans pass through each other, no shoves or grabs (milestone 3); the moving platform and hammer from the prototype are static for now (milestone 4); nothing is online for friends yet (milestone 6).

### Milestone 3: what was built (2026-10-02)

Online, with the prototype's numbers (section 5.5):

| Move | Key | What it does |
|---|---|---|
| Shove | F | Knocks the bean in front away, stuns it 0.5 s and takes its double jump. Shoves someone hanging off their ledge. 1.2 s cooldown |
| Grab | hold E | Carry the bean in front (you move at 55% speed). Let go of E, or hold for 1.8 s, to throw |
| Pull up | E on someone hanging | Saves them: they climb up and are protected for 0.6 s |
| Ledges | | Falling past a platform edge grabs it. Hang 2.5 s (a bar shows the time left), mash jump 6 times to climb alone |

Points (model B): a help and a knockout are both worth 1 point for now, one number each in `packages/shared/src/constants.ts`.
- **Help:** pulling someone up, or throwing someone across a gap so they land on another platform further ahead.
- **Knockout:** whoever shoved, grabbed or threw you in the last 4 seconds gets the point when you fall. Landing safely after a throw clears it.
- **No farming:** helping the same person again within 8 seconds scores nothing.

Anti-griefing (5.4): grab immunity 2 s after a throw or drop, spawn protection 1.5 s (the bean blinks), shove cooldown 1.2 s. The fourth rule, the catch-up boost for last place, needs race positions, so it comes with rounds in milestone 4.

Favor the pusher (13.3): every input carries the moment the other beans were drawn at on your screen. The server judges a shove or grab against where the target was at that moment, up to 0.5 s back, then applies it to them now.

What you see: SHOVE, THROWN, SAVED +1, HELP +1 and KO! +1 pop up over the beans, green rings for helps, a short event feed bottom left, points per player top right, and the screen shakes only for hits you are part of.

Tested: 38 automated tests (17 new for these rules, including favor the pusher and the 0.5 s limit). In the browser: shoving, grabbing, carrying, throwing and being carried yourself all work, with 0 corrections to your own bean unless someone else moves it. The test bots now have personalities (Ava helps, Bo hurts, Cy does both) and go after beans near them.

On purpose, not yet: beans still pass through each other (bumping into each other online needs more work, and shoves already cover contact); the catch-up boost (milestone 4); end of match awards Saint and Traitor (with rounds).

To do before going online (milestone 6): snapshots are now about 64 KB/s per player, far above the 4 to 8 KB/s estimate in section 14. Send full detail only for your own bean and a short version for the others, then measure again.

### Milestone 4: what was built (2026-10-02)

**A real round.** Lobby (wander the course, press R when ready; it starts when everyone is) -> round card (3 s: name, difficulty, rules) -> 3-2-1 (nobody can move) -> race -> results (8 s) -> back to the lobby. A match is one round for now; milestone 5 strings 3 together.

- Finishing: 1st gets 3 points, 2nd 2, 3rd 1. The round ends when 3 have finished (or everyone, with 3 players or fewer), or when the timer runs out. Finished beans turn see-through and can't be touched.
- Results: places, finish points, helps, knockouts and points, plus Saint (most helps) and Traitor (most knockouts). Ties share the award.
- Points scored while practicing in the lobby reset when the match starts.
- Catch-up boost (the fourth anti-griefing rule): last place runs 12% faster while more than 700 px behind the leader.

**Ledge Run, built from a seed.** Every browser builds the same course from the match seed and the difficulty, so only those two numbers are ever sent. The course is a row of sections, one obstacle each: hops, hammer, moving platform, conveyor belt, rotating bar, falling platforms, fake-tile bridge, giant fan, gate, seesaw. **Each match draws some of them in a random order** (Easy 5, Normal 6, Hard 7; changed the same day at Raven's request, it was a fixed order at first). Every section ends on a safe landing where a checkpoint can go, and every course ends the same way: bounce pad, tall block, finish. The seed also nudges gaps, heights, obstacle timing and which tiles are fake. The round card lists the obstacles drawn for that match.

| | Easy | Normal | Hard |
|---|---|---|---|
| Sections drawn (of 10) | 5 | 6 | 7 |
| Gaps | 85% | 100% | 115% |
| Obstacle speed | 80% | 100% | 125% |
| Timer | 30 s + 22 s a section (140 s) | 30 s + 18 s a section (138 s) | 30 s + 15 s a section (135 s) |
| Checkpoints (with the start) | 6 | 5 | 4 |
| Fake tiles (of 4) | 1 | 1 | 2 |
| Hammers | 1 | 1 | 2 |

All of it is one table, `DIFFICULTY` in `packages/shared/src/level.ts`.

**The 7 starter obstacles, plus the prototype's 3:**
- Falling platform: shakes for 0.5 s after you land on it, drops, and is back 3.5 s later.
- Rotating bar: knocks you away. Pass while it is flat, or jump the low arm.
- Conveyor belt: carries you back at 130 px/s, so shoves on it land further back.
- Seesaw: two linked halves. More beans on one side sinks it (up to 70 px) and lifts the other. Built in our own code, no Rapier needed.
- Giant fan: on for 2 s, off for 1.6 s, blows you back over a gap. Jump while it is off.
- Closing gate + push button: standing on either button holds the gate open for everyone. Walking through while someone else holds it is a help for them (+1, "held the door"). It also opens by itself for 1.4 s every 7 s, so a player alone is never stuck.
- Fake floor tile: looks exactly like the real ones, gives way 0.2 s after you step on it, back 4 s later.
- Moving platform, swinging hammer, bounce pad: back from the prototype. Hammer and bar hits work like a shove from the obstacle.

**Netcode for moving obstacles (13.3).** Timed obstacles are worked out from the tick on every machine, nothing about them is sent. The server tells each browser which tick it applied its newest input at, so the browser predicts every input at the exact tick the server will: your own bean stays exact around moving parts. The falling platforms and fake tiles you step on are predicted too. The seesaw and the gate depend on everyone, so the browser estimates them from the latest update; expect small corrections there under lag. Other beans standing on something that moves are drawn riding along with it.

**Tested.** 67 automated tests (28 new): every obstacle, the round flow, finish points, Saint and Traitor, the boost, holding the door, prediction with moving parts, and that every difficulty can be finished. For that last one there is now an autopilot (`tools/autopilot.ts`) that tries moves ahead with the real movement code; it finished 72 of 72 fixed-order courses (3 difficulties, 12 seeds, boost on and off), and after the shuffle, 72 of 72 random draws (the autopilot needs 15 to 26 s against timers of 135 to 140 s). In the browser: full rounds with 3 bots, intro to results; about 5 corrections per race with no lag and 8 at 150 ms lag with 5% loss (mostly the seesaw).

**Bots.** They race with the autopilot plus some human sloppiness (they hesitate, and now and then blunder), so they finish Normal in about 30 to 120 s. They ready up only once a real player is ready, so the launcher no longer starts a match before you join. Ava sometimes holds the door for whoever is behind.

On purpose, not yet: the other 4 rounds and 3-round matches (milestone 5), which is also when "each round gets harder" kicks in; bot skill per difficulty; beans still pass through each other; the seesaw could be predicted better.

To do before going online (milestone 6): snapshots are now about 78 KB/s per player (the course state is in them too). Slimming them is still on the list.

### Milestone 5: what was built (2026-10-02)

**A whole show.** Lobby -> ready up -> 3 rounds -> the show -> back to the lobby, where pressing R again is the rematch. Each round: round card (name, "Round X of 3", difficulty, goal, how to help, how to hurt) -> 3-2-1 -> play -> results (8 s, with the next round's name). After the last round the show (12 s) names the winner (ties share it) with the final table, Saint and Traitor.

- **The match:** 2 rounds drawn from Ledge Run, Hot Plate, Two-Key Door and Tail Tag (never the same one twice), then always Trust Bridge. One random difficulty for the whole match, and every round is a notch harder than the one before (5% wider gaps and 10% faster obstacles a round). Points carry across all 3 rounds.
- **Difficulty setting:** kept random, no host setting in the lobby, per the 2026-10-02 decision. Easy to add later if playtests want it.
- **Invite link:** C copies it (from milestone 4); joining mid-match works, you jump straight into the round that is on (in Hot Plate you watch until the next round).

**The 4 new rounds**, each built from the seed like Ledge Run:

| Round | Mode | How it works | Points |
|---|---|---|---|
| Hot Plate | Survival | 2 layers of 10 tiles. One tile at a time turns red, shakes for 1 s and drops for good (every 4 / 3.2 / 2.6 s on Easy / Normal / Hard). The bottom layer starts dropping later and slower. Fall and you are out for the round and watch. | Last ones standing: 3, 2, 1 (everyone still standing at the end counts as 1st) |
| Two-Key Door | Race | 3 doors with a plate before and after each, 2 random sections in between. A door opens while anyone stands on its plate, and by itself for 1.5 s every 10 / 13 / 16 s so nobody alone is stuck. | First 3 through: 3, 2, 1. Walking through a door someone holds is +1 for them |
| Tail Tag | Hunt | An arena with holes and ledges, no finish. 2 tails with 4 players, 1 with fewer. Grab a holder to steal it (they can't take it back for 1.5 s). Grab someone without a tail to pass yours on (a help). Knock a holder into a hole and you take the tail. | Holding a tail at the end: +3 |
| Trust Bridge | Final | 9 / 11 / 13 planks over the pit, with a rest stop every 4. A plank shakes and breaks when 3 beans stand on it (2 on Hard), back 5 s later. | First across wins the crown: +5, and the round ends at once |

**Found and fixed on the way:** doors were 170 px tall but a double jump clears about 260, so everyone (bots too) just hopped over them, in Ledge Run as well. Doors are now 340 px tall: the only ways past are a plate or a throw.

**Tested.** 98 automated tests (31 new): every round builds the same from the same seed on every difficulty, each later round is harder, Hot Plate tiles drop in order and hanging on one lets go, planks break under the limit, doors stay shut unless held, Tail Tag has no finish, and whole matches through a real room (survival places, steals, passes, tail points, the crown, points carrying over, the show, back to the lobby). The autopilot finishes every race on every difficulty, even as the hardest last round (Two-Key Door 13 to 32 s alone, waiting on the door timers; Trust Bridge 10 to 17 s). In the browser: 2 full matches with 3 bots, every screen checked (lobby, round cards, the play line for each mode, results, the show, rematch).

**Bots** now play every round: races with the autopilot (and they hold plates for whoever is behind), Hot Plate by standing on the tile that drops last on their layer (and shoving), Tail Tag by chasing the nearest holder or running from the nearest hunter, jumping holes on the way. Also: if the bots process stalls for a few seconds it now skips the lost time like the browser does, instead of sending a burst the server would kick it for.

**Check pass the same day** (going through the plan for anything milestone 5 missed):
- Results and the show now have **highlights** (section 11): the biggest help and the biggest hurt between two players, like "Cy held the door for Ava 3 times" (green) and "Bo knocked out you twice" (red). The round's on results, the whole match's on the show. Practice in the lobby doesn't count.
- The scoreboard (top right) marks **[ready]** in the lobby, **[out]** in Hot Plate and **[tail]** in Tail Tag, so you can see who is waiting on whom and where the tails are.
- **Trust Bridge planks turn red** when one more bean would break them, so the "breaks under 3" rule is visible before it bites.
- **A tail that was just stolen or passed blinks** for the 1.5 s it can't be taken back.
- Wording: in Hot Plate and Tail Tag a helpful throw now reads "threw X to safety" (there are no gaps there).
- **Bot skill follows the difficulty** (3.4): bots hesitate and blunder more on Easy (x1.6) and less on Hard (x0.6).
- Sections 13.4 and 13.5 now describe the messages and the state machine as built.
- **Crash at round changes, fixed.** When a new round started, the predicted bean kept its old state for a moment, including which platform it stood on. If the new course had fewer platforms (Ledge Run into Hot Plate), the movement code looked up a platform that did not exist and threw. That is what knocked the bots out mid-match, and it could freeze a real player's game the same way. Now every browser starts a fresh bean on the new course, exactly like the server does. Checked with a full match through the same round change that failed before.
- 101 automated tests now (3 new: picking highlights, lobby practice left out while the show sums the match, and the round-change crash).

On purpose, not yet: bots don't throw allies across in Hot Plate or pass tails on purpose; Tail Tag bots don't use the ledges well; a second Final so the ending varies; scenery themes per match (waiting on Raven's art, 10.2); "Reconnecting..." screen (milestone 7).

Target date for first friends playtest: Your answer:

### Milestone 6: what was built (2026-10-03)

- **Snapshots slimmed from about 78 KB/s to 5.6 to 8 KB/s per player** (`packages/shared/src/snapcodec.ts`): your own bean is sent as exact changes with a full copy every 30 snapshots, other beans as short rounded lists, and the course and scores only when they change.
- **Game page live on Vercel** at https://frenymies.vercel.app (`deploy/VERCEL-SETUP.md`). Desktop shortcut "Update Frenymies Online" checks the code (typecheck + all tests), uploads, and checks the live page.
- **Game server live on the VPS** (`deploy/DEPLOY.md`): one bundled file in `/opt/frenymies`, systemd unit `frenymies` on the docker bridge only, 300 MB memory cap, only the Vercel page may connect, `/health` private. Caddy forwards `/frenymies/*` on <game-server-domain>. The another service and another service were checked unchanged.
- Sound made in code, longer rounds and a slide-out controls guide (see the decision log for 2026-10-03).
- 108 automated tests.

Still to do for this milestone: the first real playtest with friends, and updating the VPS server whenever the game code changes (steps in `deploy/DEPLOY.md`).

---

## 17. Risks

| Risk | Impact | Plan |
|---|---|---|
| Physics feels bad online (rubber-banding) | High | Build milestone 2 early and test with the lag simulator before adding content |
| Push/grab fights feel unfair with lag | High | Rule is favor the pusher, so watch for "that missed me" moments in the lag tests. Generous grab range, visible cooldowns |
| Hurting is always better than helping | High | Scoring is model B, so there is no glowing target. The four anti-griefing rules (5.4) are the safety valve; tune help vs knockout points in playtests |
| Too many obstacles (36 on the list) | Medium | Build the starter set of 7 first, add the rest round by round after playtests |
| Friends' internet is slow | Medium | Show ping in lobby; server is already in Singapore |
| Snapshots too big for phones and slow Wi-Fi (78 KB/s per player now) | Medium | Slim them down before milestone 6 (see Milestone 3 and 4 notes) |
| Shares the VPS with other live services | Medium | Separate systemd service and port, memory limit on the service |

---

## 18. Open questions

- Your questions go here.

---

## 19. Decision log

| Date | Decision | Why |
|---|---|---|
| 2026-09-30 | Fall Guys style party game, max 4 players | More fun for Raven than Bomberman |
| 2026-09-30 | Twist: players can help or hurt each other | Core differentiator |
| 2026-09-30 | Browser game: client on Vercel, server on the VPS Singapore | Free, and the VPS is close to PH players |
| 2026-09-30 | Server-authoritative WebSocket netcode | Fair pushes, no cheating |
| 2026-10-01 | Game name: **Frenymies** | Raven picked it; all game files moved into the `Frenymies` folder |
| 2026-09-30 | Built a throwaway local 2D prototype (Phaser 4 + Vite) | See the look, the shared camera and the help-or-hurt moves before deciding |
| 2026-09-30 | Game feel pass: jump set by height and time, hurts shake, helps never shake | Hurting should feel punchy, helping should feel warm |
| 2026-10-01 | Double jump added to the prototype; shoves and throws take it away | Raven asked for it; hits still need to matter |
| 2026-10-01 | Decisions moved into the Google Sheet "Frenymies Tracker" | Easier to fill in than this file |
| 2026-10-01 | Official Phaser skills (28) installed | Phaser 4 help for sprites, animations, loading drawings and scenery |
| 2026-10-01 | Match format: 3 rounds per match, every match has different settings and difficulty | Raven's pick over a level map with unlockable stages: keeps matches short, no accounts or saves needed |
| 2026-10-01 | 2D side view; shared zoom camera that leans a little toward each player | Raven's pick in the tracker |
| 2026-10-01 | Scoring model B: points for both helping and knocking out | Raven's pick over A (Karma and Bounty); needs a new anti-bullying safety valve |
| 2026-10-01 | Knockouts depend on round type: race = respawn, survival = out for the round | Raven's pick |
| 2026-10-01 | Points, no elimination | Raven's pick |
| 2026-10-01 | Bots fill empty seats; keyboard only; public, anyone with a link; 5 to 10 minute matches | Raven's picks |
| 2026-10-01 | Art will be generated, not hand drawn | Raven's note on the drawing app question |
| 2026-10-02 | Knocked out of a survival round = spectate (changed from ghosts) | Raven's pick in the tracker |
| 2026-10-02 | Rounds random, always ending on a Final; Easy/Normal/Hard rolled randomly each match; each round harder; layout changes once per match from the seed | Raven's picks (round order and levels: "choose recommendation") |
| 2026-10-02 | Smooth cartoon; Raven provides all art, backgrounds and 10 scenery themes; plain colored jellybeans until then; color + hat | Raven's picks; background how-to added to 10.2 |
| 2026-10-02 | Keep double jump, dive and throw; no emotes; cartoon only | Raven's picks |
| 2026-10-02 | Help: pull up, throw across, hold the door. Hurt: shove, grab and hold, throw off. All four anti-griefing rules | Raven's picks |
| 2026-10-02 | 36 obstacles on the list; build a starter set of 7 first | Raven's list; too many to build before the first playtest |
| 2026-10-02 | Lag rule: favor the pusher | Raven's pick; snappier shoves, revisit after lag tests |
| 2026-10-02 | No chat, no power-ups, no modifiers in v1; movement in between; English; Quick Match later | Raven's picks |
| 2026-10-02 | Milestone 5 points: Final crown +5, holding a tail +3, survival places 3/2/1; difficulty stays random (no host setting) | Final should feel like the big one; keeps the earlier random-difficulty pick |
| 2026-10-02 | Doors 340 px tall (were 170) | A double jump cleared them, so the plates did nothing |
| 2026-10-03 | Rounds about 1.5x longer: Ledge Run 8/10/12 sections (repeats allowed past 10, never twice in a row, one seesaw), Two-Key Door 2 sections between doors, Trust Bridge 16/20/24 planks with a hammer every other stop, Hot Plate 14 tiles a layer, Tail Tag 90/100/120 s | Raven: "the stages are so short". Autopilot finishes 90 of 90 random courses (needed a fix: keep running after landing on a backward belt) |
| 2026-10-03 | Sound made in code: retro effects (random variant and pitch) and original chiptune songs composed per round; M music, N sounds | Raven asked for Undertale sounds; those are copyrighted, so code-made (plan 10.3 allows jsfxr-style) |
| 2026-10-03 | Controls guide top left with every key; H hides it; hidden during cards and results | Raven asked for a key guide in the left corner |
| 2026-10-03 | Controls guide became a slide-out curtain: a small tab on the left edge, click or H, open the first time, remembered after | Raven: the guide should not cover the screen, "make a curtain button" |
| 2026-10-03 | Game server on the VPS at wss://<game-server-domain>/frenymies/ws (path on the existing domain, no new subdomain or DNS) | Raven OK'd the VPS step in chat. No DNS change needed, Caddy already holds the certificate |
| 2026-10-02 | Free royalty-free music, CC0 sound effects | Raven's picks |
| 2026-10-02 | Free Vercel address, unlisted, rooms need a code | Raven asked for free and private for now |
| 2026-10-02 | Round pool: Ledge Run, Hot Plate, Two-Key Door, Tail Tag, Trust Bridge | Raven took the recommendation; Trust Bridge is always the final |
| 2026-10-02 | Milestone 2 done: online movement with prediction, smoothing, input buffer and a built-in lag test | 0 corrections and no frozen beans even at 300 ms with 10% loss |
| 2026-10-02 | Bean movement is shared custom code, not Rapier; Rapier only for tipping/rolling obstacles later | Same code on server and browser means exact prediction; Rapier would make that much harder |
| 2026-10-02 | Milestone 3 done: shove, grab, throw, ledges, pull-up, knockout credit, points, favor the pusher | All online, tested with 38 automated tests and in the browser |
| 2026-10-02 | Help = pull-up or a throw that lands someone on a platform ahead; help and knockout both 1 point; same pair scores at most once per 8 s | Simple to explain; numbers are one line each to tune after playtests |
| 2026-10-02 | Catch-up boost waits for milestone 4; beans still pass through each other | Needs race positions; contact is covered by shoves for now |
| 2026-10-02 | Friends can join early through a temporary Cloudflare link from Raven's laptop ("Share Frenymies Online") | Real-network testing before milestone 6, no VPS changes |
| 2026-10-02 | Milestone 4 done: Ledge Run as a real round, the 7 starter obstacles, Easy/Normal/Hard, catch-up boost | 67 automated tests; the autopilot finished every difficulty on 12 seeds |
| 2026-10-02 | Finish points 3, 2, 1 for the first 3; the round ends when 3 finish or the timer runs out; tied awards are shared | Defaults, one line each to tune after playtests |
| 2026-10-02 | Seesaw is two linked halves in our own code, not Rapier | Same simple code on server and browser |
| 2026-10-02 | The gate also opens by itself for 1.4 s every 7 s | A player alone is never stuck; holding the door is still faster and scores a help |
| 2026-10-02 | Catch-up boost: last place runs 12% faster while more than 700 px behind | Small enough not to decide races |
| 2026-10-02 | Ledge Run's obstacles are drawn and shuffled each match (Easy 5, Normal 6, Hard 7 of 10); the timer scales with the number of sections | Raven asked for more variety than the fixed order |
| | | |
