# Frenymies

A 2D online party game for 1 to 4 players: race, survive and steal tails across 3 rounds, and choose every round whether to **help** your rivals (pull them up, throw them across, hold the door) or **hurt** them (shove, grab, throw them off).

Built with Phaser 4 (browser), a Node WebSocket game server with server-side physics, and shared rules in TypeScript.

The full design is in [docs/GAME-PLAN.md](docs/GAME-PLAN.md).

## Run it locally

Needs Node 24 (it runs TypeScript directly).

```sh
npm install
npm run server    # game server on port 3100
npm run client    # game page on http://localhost:5190
npm run bots      # optional: 3 bots in room TEST
npm test          # automated tests
```

On Windows, `Play-Frenymies-Online.cmd bots` starts all three and opens the game.

## Contributing

This is a personal project. Issues are welcome; pull requests are not accepted.

Before committing in a clone, run `node tools/install-hooks.ts` once: it installs a check that blocks commits containing secrets.
