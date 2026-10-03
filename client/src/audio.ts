// Sound for Frenymies, all made in code with the browser's Web Audio: no sound files, nothing to license.
// - Sound effects: retro bleeps for every action (jsfxr style, see GAME-PLAN 10.3). Each has a few
//   variations, picked at random, with a little random pitch, so repeats don't sound the same.
// - Music: short chiptune songs composed on the spot from a random seed (original every time): a calm one
//   in the lobby, an upbeat one per round (faster on harder levels), a tense one for the final, and
//   jingles for the results and the winner.
// M turns the music on and off, N the sound effects; both are remembered in this browser.
// Browsers only allow sound after the player has clicked or pressed a key, so unlock() is called then.

type Wave = OscillatorType | 'noise';

interface Tone {
  w?: Wave; // default square
  f: number; // start frequency, Hz (for noise: the filter frequency)
  to?: number; // slide to this frequency
  d: number; // duration, seconds
  v?: number; // volume 0..1 (default 0.25)
  at?: number; // start offset, seconds
  vib?: number; // vibrato speed, Hz
}

export type Sfx =
  | 'jump' | 'jump2' | 'pad' | 'land' | 'dive' | 'shove' | 'grab' | 'throw' | 'help' | 'ko' | 'fall' | 'climb'
  | 'bonk' | 'out' | 'steal' | 'finish' | 'count' | 'go' | 'intro' | 'results' | 'win' | 'lose' | 'blip';

/** Note number to frequency: 0 = A4 (440 Hz), 3 = C5, 12 = A5. */
const hz = (n: number) => 440 * 2 ** (n / 12);
/** A quick run of notes (an arpeggio). */
const arp = (notes: number[], step: number, w: Wave = 'square', v = 0.2, last = step * 1.5): Tone[] =>
  notes.map((n, i) => ({ w, f: hz(n), d: i === notes.length - 1 ? last : step * 0.95, at: i * step, v }));

const C5 = 3, E5 = 7, G5 = 10, C6 = 15;

/** Every sound effect, with its variations (one is picked at random each time). */
const SFX: Record<Sfx, Tone[][]> = {
  jump: [[{ f: 330, to: 660, d: 0.11, v: 0.16 }], [{ f: 392, to: 760, d: 0.1, v: 0.16 }], [{ f: 294, to: 620, d: 0.12, v: 0.16 }]],
  jump2: [[{ f: 523, to: 1046, d: 0.09, v: 0.15 }, { f: 784, to: 1318, d: 0.07, at: 0.05, v: 0.12 }],
    [{ f: 587, to: 1174, d: 0.1, v: 0.15 }]],
  pad: [[{ w: 'triangle', f: 180, to: 900, d: 0.28, v: 0.3, vib: 18 }]],
  land: [[{ w: 'noise', f: 300, d: 0.05, v: 0.12 }]],
  dive: [[{ w: 'noise', f: 1400, to: 300, d: 0.18, v: 0.18 }, { f: 240, to: 110, d: 0.14, v: 0.08 }]],
  shove: [[{ w: 'noise', f: 900, d: 0.08, v: 0.45 }, { f: 170, to: 80, d: 0.12, v: 0.25 }],
    [{ w: 'noise', f: 1300, d: 0.07, v: 0.4 }, { f: 200, to: 90, d: 0.1, v: 0.25 }],
    [{ w: 'noise', f: 650, d: 0.09, v: 0.45 }, { w: 'sawtooth', f: 150, to: 70, d: 0.12, v: 0.18 }]],
  grab: [[{ f: 440, d: 0.045, v: 0.18 }, { f: 660, d: 0.06, at: 0.05, v: 0.18 }],
    [{ f: 392, d: 0.045, v: 0.18 }, { f: 587, d: 0.06, at: 0.05, v: 0.18 }]],
  throw: [[{ w: 'noise', f: 400, to: 2200, d: 0.2, v: 0.22 }, { w: 'triangle', f: 300, to: 900, d: 0.2, v: 0.2 }]],
  help: [arp([C5, E5, G5, C6], 0.06), arp([0, 4, 7, 12], 0.06), arp([5, 9, 12, 17], 0.055), arp([G5, C6, E5 + 12], 0.07)],
  ko: [[{ f: 620, to: 70, d: 0.35, v: 0.24 }, { w: 'noise', f: 220, d: 0.25, at: 0.05, v: 0.25 }],
    [{ w: 'sawtooth', f: 500, to: 60, d: 0.4, v: 0.16 }, { w: 'noise', f: 300, d: 0.2, at: 0.08, v: 0.25 }]],
  fall: [[{ w: 'triangle', f: 950, to: 140, d: 0.6, v: 0.24, vib: 9 }], [{ w: 'triangle', f: 800, to: 120, d: 0.55, v: 0.24, vib: 12 }]],
  climb: [arp([-2, 3, 7], 0.05, 'square', 0.15), arp([0, 5, 9], 0.05, 'square', 0.15)],
  bonk: [[{ w: 'noise', f: 600, d: 0.07, v: 0.4 }, { f: 110, d: 0.1, v: 0.25 }]],
  out: [arp([10, 8, 7, 6], 0.13, 'triangle', 0.28, 0.4)],
  steal: [[{ f: 1200, to: 300, d: 0.1, v: 0.16 }, { f: 300, to: 1300, d: 0.12, at: 0.1, v: 0.16 }]],
  finish: [arp([C5, E5, G5, C6, G5, C6], 0.08, 'square', 0.2, 0.35), arp([0, 4, 7, 12, 16], 0.08, 'square', 0.2, 0.35)],
  count: [[{ f: 440, d: 0.12, v: 0.22 }]],
  go: [[{ f: 880, d: 0.32, v: 0.25 }, { w: 'triangle', f: 440, d: 0.32, v: 0.2 }]],
  intro: [arp([C5 - 12, G5 - 12, C5, E5], 0.09, 'triangle', 0.25, 0.3)],
  results: [arp([C5, E5, G5, E5, C6], 0.11, 'square', 0.18, 0.5)],
  win: [[...arp([C5, C5, C5, C5 + 5 - 1], 0.12, 'square', 0.2, 0.2), ...arp([G5, C6, E5 + 12, C6 + 12], 0.14, 'square', 0.2, 0.7).map((t) => ({ ...t, at: (t.at ?? 0) + 0.5 }))]],
  lose: [arp([G5, E5, C5, C5 - 1], 0.16, 'triangle', 0.25, 0.6)],
  blip: [[{ f: 720, d: 0.03, v: 0.12 }]],
};

// ---------- music ----------

const MAJOR = [0, 2, 4, 5, 7, 9, 11];
const MINOR = [0, 2, 3, 5, 7, 8, 10];
const PROGRESSIONS = { major: [[0, 5, 3, 4], [0, 3, 4, 0], [0, 4, 5, 3], [0, 3, 0, 4]], minor: [[0, 5, 2, 6], [0, 3, 4, 0], [0, 6, 5, 4]] };
// rhythms for one bar of 16 steps: where the lead plays a note (the rest are held or silent)
const RHYTHMS = [
  [1, 0, 0, 0, 1, 0, 1, 0, 1, 0, 0, 0, 1, 0, 0, 0],
  [1, 0, 1, 0, 1, 0, 0, 0, 1, 0, 1, 0, 1, 0, 0, 0],
  [1, 0, 0, 1, 0, 0, 1, 0, 1, 0, 1, 0, 1, 0, 0, 0],
  [1, 0, 1, 1, 1, 0, 1, 0, 1, 0, 0, 0, 0, 0, 0, 0],
  [1, 0, 0, 0, 0, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0],
];

export type Mood = 'lobby' | 'round' | 'final';

interface Song {
  bpm: number;
  root: number; // note number (0 = A4)
  scale: number[];
  bars: Array<{ chord: number; lead: Array<number | null> }>; // per bar: chord degree, and 16 steps of lead notes
  drums: boolean;
  arp: boolean;
  leadWave: OscillatorType;
}

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A new little song: a chord progression, a melody that sticks to the chords, played as 8 bars (AABA AABA'). */
export function compose(mood: Mood, seed: number, intensity = 0): Song {
  const r = rng(seed);
  const pick = <T>(a: T[]) => a[Math.floor(r() * a.length)];
  const minor = mood === 'final';
  const scale = minor ? MINOR : MAJOR;
  const prog = pick(minor ? PROGRESSIONS.minor : PROGRESSIONS.major);
  const root = pick([-9, -7, -5, -4, -2]); // C4, D4, E4, F4, G4
  const deg = (d: number) => scale[((d % 7) + 7) % 7] + 12 * Math.floor(d / 7); // scale degree to semitones
  const motif = (chord: number) => {
    const rhythm = pick(RHYTHMS);
    let cur = chord + pick([0, 2, 4]); // start on a chord tone
    return rhythm.map((on, i) => {
      if (!on) return null;
      // strong beats land on chord tones, the rest walk up or down the scale
      if (i % 4 === 0) {
        const tones = [chord, chord + 2, chord + 4, chord + 7];
        cur = tones.reduce((best, t) => (Math.abs(t - cur) < Math.abs(best - cur) ? t : best), tones[0]);
      } else {
        cur += pick([-1, 1, 1, 2, -2]);
      }
      cur = Math.max(-2, Math.min(9, cur));
      return deg(cur) + 12;
    });
  };
  const a = prog.map(motif);
  const b = prog.map(motif);
  const ending = motif(prog[3]).map((n, i) => (i === 0 ? deg(0) + 24 : i < 8 ? n : null)); // land on the home note
  const bars = [
    ...prog.map((c, i) => ({ chord: c, lead: a[i] })),
    ...prog.map((c, i) => ({ chord: c, lead: i === 3 ? ending : b[i] })),
  ];
  const bpm = mood === 'lobby' ? 92 : mood === 'final' ? 150 : 118 + intensity * 8;
  return { bpm, root, scale, bars, drums: mood !== 'lobby', arp: mood === 'final' || intensity >= 3, leadWave: mood === 'lobby' ? 'triangle' : 'square' };
}

// ---------- the player ----------

export class Sound {
  private ctx: AudioContext | null = null;
  private sfxBus: GainNode | null = null;
  private musicBus: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  musicOn = localStorage.getItem('frenymies.music') !== 'off';
  sfxOn = localStorage.getItem('frenymies.sfx') !== 'off';
  private song: Song | null = null;
  private step = 0;
  private nextAt = 0;
  private timer = 0;
  private songGain: GainNode | null = null;
  private wanted: { mood: Mood; intensity: number } | null = null; // asked for before sound was allowed

  /** Call from a click or key press: browsers only allow sound after one. */
  unlock(): void {
    if (!this.ctx) {
      const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!Ctx) return;
      this.ctx = new Ctx();
      const master = this.ctx.createGain();
      master.gain.value = 0.8;
      master.connect(this.ctx.destination);
      this.sfxBus = this.ctx.createGain();
      this.sfxBus.gain.value = this.sfxOn ? 1 : 0;
      this.sfxBus.connect(master);
      this.musicBus = this.ctx.createGain();
      this.musicBus.gain.value = this.musicOn ? 0.35 : 0;
      this.musicBus.connect(master);
      this.noise = this.ctx.createBuffer(1, this.ctx.sampleRate, this.ctx.sampleRate);
      const data = this.noise.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    if (this.wanted && !this.song) this.music(this.wanted.mood, this.wanted.intensity);
  }

  get ready(): boolean {
    return !!this.ctx && this.ctx.state === 'running';
  }

  toggleMusic(): boolean {
    this.musicOn = !this.musicOn;
    localStorage.setItem('frenymies.music', this.musicOn ? 'on' : 'off');
    if (this.musicBus && this.ctx) this.musicBus.gain.setTargetAtTime(this.musicOn ? 0.35 : 0, this.ctx.currentTime, 0.05);
    return this.musicOn;
  }

  toggleSfx(): boolean {
    this.sfxOn = !this.sfxOn;
    localStorage.setItem('frenymies.sfx', this.sfxOn ? 'on' : 'off');
    if (this.sfxBus && this.ctx) this.sfxBus.gain.setTargetAtTime(this.sfxOn ? 1 : 0, this.ctx.currentTime, 0.02);
    return this.sfxOn;
  }

  /** Play a sound effect: a random variation, a little random pitch. pan -1 (left) .. 1 (right). */
  play(name: Sfx, volume = 1, pan = 0): void {
    if (!this.ready || !this.sfxOn) return;
    const variants = SFX[name];
    const v = variants[Math.floor(Math.random() * variants.length)];
    const pitch = name === 'count' || name === 'go' ? 1 : 0.94 + Math.random() * 0.12;
    const out = this.ctx!.createStereoPanner();
    out.pan.value = Math.max(-1, Math.min(1, pan));
    out.connect(this.sfxBus!);
    const t0 = this.ctx!.currentTime + 0.005;
    for (const tone of v) this.tone(tone, t0, pitch, volume, out);
  }

  private tone(t: Tone, t0: number, pitch: number, volume: number, out: AudioNode): void {
    const ctx = this.ctx!;
    const start = t0 + (t.at ?? 0);
    const end = start + t.d;
    const g = ctx.createGain();
    const peak = (t.v ?? 0.25) * volume;
    g.gain.setValueAtTime(0.0001, start);
    g.gain.exponentialRampToValueAtTime(Math.max(peak, 0.0002), start + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, end);
    g.connect(out);
    const f0 = t.f * pitch;
    const f1 = (t.to ?? t.f) * pitch;
    if (t.w === 'noise') {
      const src = ctx.createBufferSource();
      src.buffer = this.noise;
      src.loop = true;
      const filter = ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.Q.value = 1.2;
      filter.frequency.setValueAtTime(f0, start);
      if (f1 !== f0) filter.frequency.exponentialRampToValueAtTime(f1, end);
      src.connect(filter).connect(g);
      src.start(start, Math.random() * 0.5);
      src.stop(end + 0.02);
      return;
    }
    const osc = ctx.createOscillator();
    osc.type = t.w ?? 'square';
    osc.frequency.setValueAtTime(f0, start);
    if (f1 !== f0) osc.frequency.exponentialRampToValueAtTime(f1, end);
    if (t.vib) {
      const lfo = ctx.createOscillator();
      const depth = ctx.createGain();
      lfo.frequency.value = t.vib;
      depth.gain.value = f0 * 0.04;
      lfo.connect(depth).connect(osc.frequency);
      lfo.start(start);
      lfo.stop(end);
    }
    osc.connect(g);
    osc.start(start);
    osc.stop(end + 0.02);
  }

  /** Start a new random song for this mood (a new one every time), fading out whatever was playing. */
  music(mood: Mood, intensity = 0): void {
    this.stopMusic();
    this.wanted = { mood, intensity };
    if (!this.ctx) return;
    this.song = compose(mood, Math.floor(Math.random() * 2 ** 31), intensity);
    this.step = 0;
    this.nextAt = this.ctx.currentTime + 0.15;
    this.songGain = this.ctx.createGain();
    this.songGain.gain.value = 1;
    this.songGain.connect(this.musicBus!);
    this.timer = window.setInterval(() => this.schedule(), 25);
  }

  stopMusic(): void {
    this.wanted = null;
    if (this.timer) window.clearInterval(this.timer);
    this.timer = 0;
    if (this.songGain && this.ctx) {
      const g = this.songGain;
      g.gain.setTargetAtTime(0, this.ctx.currentTime, 0.08);
      window.setTimeout(() => g.disconnect(), 600);
    }
    this.songGain = null;
    this.song = null;
  }

  /** Put the next few notes on the audio clock, a little ahead, so timing stays tight. */
  private schedule(): void {
    const ctx = this.ctx;
    const song = this.song;
    if (!ctx || !song || !this.songGain) return;
    if (this.nextAt < ctx.currentTime - 0.25) this.nextAt = ctx.currentTime + 0.05; // the tab was asleep: don't catch up
    const stepLen = 60 / song.bpm / 4;
    while (this.nextAt < ctx.currentTime + 0.12) {
      const bar = song.bars[Math.floor(this.step / 16) % song.bars.length];
      const i = this.step % 16;
      const at = this.nextAt;
      const deg = (d: number) => song.scale[((d % 7) + 7) % 7] + 12 * Math.floor(d / 7);
      const lead = bar.lead[i];
      if (lead !== null) {
        // hold until the next note (at most a quarter note)
        let len = 1;
        while (len < 4 && i + len < 16 && bar.lead[i + len] === null) len++;
        this.note(song.leadWave, hz(song.root + lead), at, stepLen * len * 0.9, 0.16);
      }
      const bass = song.root + deg(bar.chord) - 12;
      if (song.drums ? i % 4 === 0 || i % 4 === 2 : i % 8 === 0) {
        this.note('triangle', hz(bass + (i % 8 === 4 ? 7 : 0)), at, stepLen * (song.drums ? 1.8 : 7), 0.3);
      }
      if (song.arp) {
        const chordTone = [0, 2, 4, 7][i % 4];
        this.note('square', hz(song.root + deg(bar.chord + chordTone) + 12), at, stepLen * 0.6, 0.05);
      }
      if (song.drums) {
        if (i % 8 === 0) this.kick(at);
        if (i % 2 === 0) this.hat(at, i % 4 === 2 ? 0.07 : 0.035);
        if (i % 8 === 4) this.hat(at, 0.12, 1800);
      }
      this.nextAt += stepLen;
      this.step++;
    }
  }

  private note(w: OscillatorType, f: number, at: number, d: number, v: number): void {
    const ctx = this.ctx!;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = w;
    osc.frequency.value = f;
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(v, at + 0.008);
    g.gain.setValueAtTime(v, at + d * 0.6);
    g.gain.exponentialRampToValueAtTime(0.0001, at + d);
    osc.connect(g).connect(this.songGain!);
    osc.start(at);
    osc.stop(at + d + 0.02);
  }

  private kick(at: number): void {
    const ctx = this.ctx!;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.frequency.setValueAtTime(140, at);
    osc.frequency.exponentialRampToValueAtTime(45, at + 0.12);
    g.gain.setValueAtTime(0.5, at);
    g.gain.exponentialRampToValueAtTime(0.0001, at + 0.15);
    osc.connect(g).connect(this.songGain!);
    osc.start(at);
    osc.stop(at + 0.16);
  }

  private hat(at: number, v: number, f = 7000): void {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const filter = ctx.createBiquadFilter();
    filter.type = f > 5000 ? 'highpass' : 'bandpass';
    filter.frequency.value = f;
    const g = ctx.createGain();
    g.gain.setValueAtTime(v, at);
    g.gain.exponentialRampToValueAtTime(0.0001, at + (f > 5000 ? 0.04 : 0.1));
    src.connect(filter).connect(g).connect(this.songGain!);
    src.start(at, Math.random() * 0.5);
    src.stop(at + 0.12);
  }
}
