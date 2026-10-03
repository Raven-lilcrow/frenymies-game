// Frenymies game server. Run: node server/src/index.ts (Node 24 runs TypeScript directly).
// Settings (environment variables): PORT (default 3100), HOST (default 127.0.0.1),
// ALLOWED_ORIGINS (comma separated; default https://frenymies.vercel.app, the game page on Vercel;
// localhost pages are always allowed),
// ALLOW_TUNNEL (default 1: also allow pages from Cloudflare quick tunnel links, *.trycloudflare.com,
// for sharing a test game from this laptop; set 0 on the real server).
import { createServer, type Server } from 'node:http';
import { performance } from 'node:perf_hooks';
import { WebSocketServer, type WebSocket } from 'ws';
import { MAX_MESSAGE_BYTES, TICK_RATE, type ServerMsg } from '../../packages/shared/src/index.ts';
import { ClientMsg } from '../../packages/shared/src/protocol.ts';
import { Room } from './room.ts';

const MAX_MESSAGES_PER_SECOND = 120; // a normal client sends about 31
const TICK_MS = 1000 / TICK_RATE;

function originAllowed(origin: string | undefined, allowed: string[], allowTunnel: boolean): boolean {
  if (!origin) return true; // not a browser (bots, tests); browsers always send Origin
  try {
    const url = new URL(origin);
    const host = url.hostname;
    if (host === 'localhost' || host === '127.0.0.1' || host === '[::1]') return true;
    if (allowTunnel && url.protocol === 'https:' && host.endsWith('.trycloudflare.com')) return true;
  } catch {
    return false;
  }
  return allowed.includes(origin);
}

export interface GameServer {
  port: number;
  rooms: Map<string, Room>;
  close: () => Promise<void>;
}

export function startServer(
  opts: { port?: number; host?: string; allowedOrigins?: string[]; allowTunnel?: boolean } = {},
): Promise<GameServer> {
  const rooms = new Map<string, Room>();
  const allowed = opts.allowedOrigins ?? [];
  const allowTunnel = opts.allowTunnel ?? true;

  const http: Server = createServer((req, res) => {
    if (req.url === '/health') {
      res.writeHead(200, { 'content-type': 'application/json' });
      const detail = [...rooms.values()].map((r) => ({
        room: r.code,
        tick: r.tick,
        phase: r.round.phase,
        course: `${r.level.name} ${r.round.diff} #${r.round.seed}`,
        match: r.round.match.join(' > '),
        players: [...r.members.values()].map((m) => ({
          name: m.name, ack: m.queue.ack, waiting: m.queue.length, freeSteps: m.queue.freeSteps, dropped: m.queue.dropped,
        })),
      }));
      res.end(JSON.stringify({ ok: true, rooms: detail }));
      return;
    }
    res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('Frenymies game server is running. Open the game client to play.\n');
  });

  const wss = new WebSocketServer({
    server: http,
    maxPayload: MAX_MESSAGE_BYTES,
    verifyClient: (info: { origin?: string }) => originAllowed(info.origin, allowed, allowTunnel),
  });

  wss.on('connection', (ws: WebSocket) => {
    let room: Room | null = null;
    let memberId = 0;
    let windowStart = performance.now();
    let count = 0;
    const send = (msg: ServerMsg) => {
      if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
    };
    const fail = (code: 'bad_message' | 'too_many_messages' | 'room_full', message: string) => {
      send({ t: 'error', code, message });
      ws.close(1008, code);
    };

    ws.on('message', (data, isBinary) => {
      const now = performance.now();
      if (now - windowStart > 1000) { windowStart = now; count = 0; }
      if (++count > MAX_MESSAGES_PER_SECOND) return fail('too_many_messages', 'Too many messages');
      if (isBinary) return fail('bad_message', 'Text messages only');

      let parsed: unknown;
      try {
        parsed = JSON.parse(data.toString());
      } catch {
        return fail('bad_message', 'Not JSON');
      }
      const r = ClientMsg.safeParse(parsed);
      if (!r.success) return fail('bad_message', 'Unknown message');
      const msg = r.data;

      if (msg.t === 'ping') return send({ t: 'pong', c: msg.c, tick: room?.tick ?? 0 });
      if (msg.t === 'hello') {
        if (room) return; // already joined
        const code = msg.room;
        let target = rooms.get(code);
        if (!target) { target = new Room(code); rooms.set(code, target); }
        const m = target.join(msg.name, send);
        if (!m) {
          if (target.size === 0) rooms.delete(code);
          return fail('room_full', 'This room already has 4 players');
        }
        room = target;
        memberId = m.id;
        return;
      }
      if (msg.t === 'input' && room) room.input(memberId, msg.i);
      if (msg.t === 'ready' && room) room.setReady(memberId, msg.on);
    });

    ws.on('close', () => {
      if (!room) return;
      room.leave(memberId);
      if (room.size === 0) rooms.delete(room.code);
      room = null;
    });
    ws.on('error', () => ws.terminate());
  });

  // Fixed 60 ticks a second. Timers on Windows are coarse, so run whatever ticks are due each wake-up.
  let next = performance.now();
  let timer: NodeJS.Timeout;
  const loop = () => {
    const now = performance.now();
    let n = 0;
    while (now >= next && n < 8) {
      for (const room of rooms.values()) room.update();
      next += TICK_MS;
      n++;
    }
    if (now - next > 250) next = now; // the machine was asleep or very busy: skip ahead instead of racing
    timer = setTimeout(loop, Math.max(0, next - performance.now()));
  };
  loop();

  return new Promise((resolve) => {
    http.listen(opts.port ?? 3100, opts.host ?? '127.0.0.1', () => {
      const addr = http.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      resolve({
        port,
        rooms,
        close: () =>
          new Promise<void>((done) => {
            clearTimeout(timer);
            for (const c of wss.clients) c.terminate();
            wss.close();
            http.close(() => done());
          }),
      });
    });
  });
}

if (import.meta.main) {
  const port = Number(process.env.PORT ?? 3100);
  const host = process.env.HOST ?? '127.0.0.1';
  const allowedOrigins = (process.env.ALLOWED_ORIGINS ?? 'https://frenymies.vercel.app').split(',').map((s) => s.trim()).filter(Boolean);
  const allowTunnel = process.env.ALLOW_TUNNEL !== '0';
  const s = await startServer({ port, host, allowedOrigins, allowTunnel });
  console.log(`Frenymies game server on ws://${host}:${s.port}`);
}
