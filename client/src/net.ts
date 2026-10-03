// WebSocket connection to the game server, with a built-in lag simulator for testing bad internet.
// WebSocket runs over TCP, so a "lost" packet is never dropped: it arrives late (resent), and
// everything behind it waits. The simulator copies that, so it feels like real bad Wi-Fi.
import type { ClientMsg, ServerMsg } from '../../packages/shared/src/index.ts';

export interface LagSettings {
  lagMs: number; // round trip, split evenly both ways
  jitterMs: number;
  lossPct: number;
}

export const LAG_PRESETS: Array<LagSettings & { label: string }> = [
  { label: 'off', lagMs: 0, jitterMs: 0, lossPct: 0 },
  { label: '150 ms, 5% loss', lagMs: 150, jitterMs: 20, lossPct: 5 },
  { label: '300 ms, 10% loss', lagMs: 300, jitterMs: 40, lossPct: 10 },
];

class DelayLine {
  // One queue and one timer, so messages always come out in the order they went in (separate
  // setTimeouts can swap two messages due within the same millisecond).
  private queue: Array<{ at: number; fn: () => void }> = [];
  private last = 0;
  private timer = 0;
  private lag: () => LagSettings;
  constructor(lag: () => LagSettings) {
    this.lag = lag;
  }

  run(fn: () => void): void {
    const { lagMs, jitterMs, lossPct } = this.lag();
    if (lagMs <= 0 && jitterMs <= 0 && lossPct <= 0 && !this.queue.length) return fn();
    let at = performance.now() + lagMs / 2 + Math.random() * jitterMs;
    if (Math.random() * 100 < lossPct) at += Math.max(lagMs, 60); // lost: resent about one round trip later
    at = Math.max(at, this.last); // nothing overtakes an earlier message, like TCP
    this.last = at;
    this.queue.push({ at, fn });
    if (this.queue.length === 1) this.schedule();
  }

  private schedule(): void {
    clearTimeout(this.timer);
    if (!this.queue.length) return;
    this.timer = window.setTimeout(() => this.flush(), Math.max(0, this.queue[0].at - performance.now()));
  }

  private flush(): void {
    const now = performance.now();
    while (this.queue.length && this.queue[0].at <= now + 0.5) this.queue.shift()!.fn();
    this.schedule();
  }
}

export class Net {
  lag: LagSettings = { ...LAG_PRESETS[0] };
  rttMs = 0;
  onMessage: (msg: ServerMsg) => void = () => {};
  onClose: (reason: string) => void = () => {};
  private ws: WebSocket;
  private out = new DelayLine(() => this.lag);
  private inn = new DelayLine(() => this.lag);
  private pingTimer = 0;

  constructor(url: string) {
    this.ws = new WebSocket(url);
    this.ws.onmessage = (e) => {
      this.inn.run(() => {
        const msg = JSON.parse(e.data as string) as ServerMsg;
        if (msg.t === 'pong') {
          this.rttMs = this.rttMs ? this.rttMs * 0.7 + (performance.now() - msg.c) * 0.3 : performance.now() - msg.c;
          return;
        }
        this.onMessage(msg);
      });
    };
    this.ws.onclose = (e) => {
      clearInterval(this.pingTimer);
      this.onClose(e.reason || 'Disconnected from the server');
    };
  }

  opened(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.ws.readyState === WebSocket.OPEN) return resolve();
      this.ws.addEventListener('open', () => {
        this.pingTimer = window.setInterval(() => this.send({ t: 'ping', c: performance.now() }), 1000);
        resolve();
      }, { once: true });
      this.ws.addEventListener('error', () => reject(new Error('Could not reach the game server')), { once: true });
    });
  }

  send(msg: ClientMsg): void {
    const text = JSON.stringify(msg);
    this.out.run(() => {
      if (this.ws.readyState === WebSocket.OPEN) this.ws.send(text);
    });
  }
}
