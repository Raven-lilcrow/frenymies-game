// End to end: a real server on a random port, real WebSocket clients.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { WebSocket as WsClient } from 'ws';
import { BTN, SnapDecoder, type ServerMsg, type Snapshot } from '../../packages/shared/src/index.ts';
import { startServer, type GameServer } from './index.ts';

let server: GameServer;
beforeEach(async () => { server = await startServer({ port: 0 }); });
afterEach(async () => { await server.close(); });

class Client {
  ws: WebSocket;
  msgs: ServerMsg[] = [];
  snaps: Snapshot[] = []; // decoded, like the browser does
  private decoder: SnapDecoder | null = null;
  closed = false;
  constructor(port: number) {
    this.ws = new WebSocket(`ws://127.0.0.1:${port}`);
    this.ws.onmessage = (e) => {
      const m = JSON.parse(String(e.data)) as ServerMsg;
      this.msgs.push(m);
      if (m.t === 'welcome') this.decoder = new SnapDecoder(m.id);
      if (m.t === 'snap' && this.decoder) {
        const s = this.decoder.decode(m);
        if (s) this.snaps.push(s);
      }
    };
    this.ws.onclose = () => { this.closed = true; };
  }
  open() {
    return new Promise<void>((r) => (this.ws.readyState === WebSocket.OPEN ? r() : this.ws.addEventListener('open', () => r(), { once: true })));
  }
  send(m: unknown) {
    this.ws.send(typeof m === 'string' ? m : JSON.stringify(m));
  }
  async waitFor<T extends ServerMsg['t']>(t: T, pred: (m: Extract<ServerMsg, { t: T }>) => boolean = () => true, ms = 2000) {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      const m = this.msgs.find((x) => x.t === t && pred(x as Extract<ServerMsg, { t: T }>));
      if (m) return m as Extract<ServerMsg, { t: T }>;
      await new Promise((r) => setTimeout(r, 10));
    }
    throw new Error(`no ${t} message`);
  }
  async waitForSnap(pred: (s: Snapshot) => boolean = () => true, ms = 2000) {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      const s = this.snaps.find(pred);
      if (s) return s;
      await new Promise((r) => setTimeout(r, 10));
    }
    throw new Error('no snapshot');
  }
}

async function joined(name: string, room = 'TEST') {
  const c = new Client(server.port);
  await c.open();
  c.send({ t: 'hello', name, room });
  return c;
}

describe('game server', () => {
  it('two players join the same room and see each other', async () => {
    const a = await joined('Ana');
    const b = await joined('Ben');
    const wa = await a.waitFor('welcome');
    const wb = await b.waitFor('welcome');
    expect(wa.slot).toBe(0);
    expect(wb.slot).toBe(1);
    const roster = await a.waitFor('roster', (m) => m.players.length === 2);
    expect(roster.players.map((p) => p.name).sort()).toEqual(['Ana', 'Ben']);
    const snap = await b.waitForSnap((m) => m.players.length === 2);
    expect(snap.players.find((p) => p.id === wa.id)).toBeDefined();
  });

  it('applies inputs and acknowledges them', async () => {
    const a = await joined('Ana');
    const w = await a.waitFor('welcome');
    const startX = (await a.waitForSnap()).players.find((p) => p.id === w.id)!.x;
    a.send({ t: 'input', i: Array.from({ length: 30 }, (_, i) => [i, BTN.right, 0]) });
    const snap = await a.waitForSnap((m) => m.ack === 29);
    expect(snap.players.find((p) => p.id === w.id)!.x).toBeGreaterThan(startX + 100);
  });

  it('sends the course on join, and readying up starts the round', async () => {
    const a = await joined('Ana');
    const w = await a.waitFor('welcome');
    const lobby = await a.waitFor('round');
    expect(lobby.phase).toBe('lobby');
    a.send({ t: 'ready', on: true });
    const intro = await a.waitFor('round', (m) => m.phase === 'intro');
    expect(intro.go).toBeGreaterThan(w.tick);
    const snap = await a.waitForSnap((m) => m.w.lock === intro.go);
    expect(snap.w.trig.length).toBeGreaterThan(0);
  });

  it('turns away a fifth player', async () => {
    for (const n of ['A', 'B', 'C', 'D']) await (await joined(n)).waitFor('welcome');
    const e = await joined('E');
    const err = await e.waitFor('error');
    expect(err.code).toBe('room_full');
  });

  it('drops a client that sends garbage', async () => {
    const a = await joined('Ana');
    await a.waitFor('welcome');
    a.send({ t: 'input', i: [[0, 999]] });
    expect((await a.waitFor('error')).code).toBe('bad_message');
    await new Promise((r) => setTimeout(r, 100));
    expect(a.closed).toBe(true);
  });

  it('frees the seat when a player leaves', async () => {
    const a = await joined('Ana');
    const b = await joined('Ben');
    await b.waitFor('roster', (m) => m.players.length === 2);
    a.ws.close();
    await b.waitFor('roster', (m) => m.players.length === 1);
    b.ws.close();
    await new Promise((r) => setTimeout(r, 100));
    expect(server.rooms.size).toBe(0);
  });

  it('accepts the game page from localhost and tunnel links, but not other websites', async () => {
    const opens = (origin: string) =>
      new Promise<boolean>((resolve) => {
        const ws = new WsClient(`ws://127.0.0.1:${server.port}`, { origin });
        ws.on('open', () => { ws.close(); resolve(true); });
        ws.on('error', () => resolve(false));
      });
    expect(await opens('http://localhost:5190')).toBe(true);
    expect(await opens('https://happy-blue-cat.trycloudflare.com')).toBe(true);
    expect(await opens('http://happy-blue-cat.trycloudflare.com')).toBe(false); // tunnels are always https
    expect(await opens('https://evil.example.com')).toBe(false);
    expect(await opens('https://trycloudflare.com.evil.example.com')).toBe(false);
  });
});
