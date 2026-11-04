import { onFirstAudioGesture } from '../ui/lib/first-audio-gesture';

/**
 * Background music — original tunes, composed here as note lists and played live with Web Audio
 * (no sample files, nothing added to the APK). Two themes in D minor:
 *  - home: a calm folk tune (lute arpeggios, warm pad, bass, soft hand drum, flute melody);
 *  - battle: a driving march (war drums, bass ostinato, brass stabs, the theme on top).
 * A small look-ahead scheduler queues notes ~0.25 s ahead; it pauses with the app.
 */
export type Theme = 'home' | 'battle';

const KEY = 'realm-raiders-music';
// Semitones from A4 (440 Hz). D minor scale helpers.
const N: Record<string, number> = {
  D2: -31, E2: -29, F2: -28, G2: -26, A2: -24, Bb2: -23, C3: -21,
  D3: -19, E3: -17, F3: -16, G3: -14, A3: -12, Bb3: -11, C4: -9, Cs4: -8,
  D4: -7, E4: -5, F4: -4, G4: -2, A4: 0, Bb4: 1, C5: 3, D5: 5, E5: 7, F5: 8, G5: 10, A5: 12,
};
const hz = (n: string) => 440 * 2 ** (N[n]! / 12);

/** Chords (root, third, fifth) per bar, 8 bars. */
const HOME_CHORDS = [
  ['D3', 'F3', 'A3'],
  ['C3', 'E3', 'G3'],
  ['Bb2', 'D3', 'F3'],
  ['C3', 'E3', 'G3'],
  ['D3', 'F3', 'A3'],
  ['F3', 'A3', 'C4'],
  ['G3', 'Bb3', 'D4'],
  ['A2', 'Cs4', 'E3'],
];
/** Flute melody: [note | '-' (rest), length in eighths], 8 bars of 8 eighths. */
const HOME_MELODY: [string, number][] = [
  ['A4', 3], ['F4', 1], ['G4', 2], ['A4', 2],
  ['G4', 3], ['E4', 1], ['C5', 4],
  ['Bb4', 2], ['A4', 2], ['F4', 2], ['D4', 2],
  ['E4', 6], ['-', 2],
  ['D5', 3], ['C5', 1], ['A4', 2], ['F4', 2],
  ['A4', 2], ['C5', 2], ['F5', 4],
  ['D5', 2], ['Bb4', 2], ['G4', 2], ['Bb4', 2],
  ['A4', 6], ['-', 2],
];
const BATTLE_CHORDS = [
  ['D3', 'F3', 'A3'],
  ['D3', 'F3', 'A3'],
  ['Bb2', 'D3', 'F3'],
  ['C3', 'E3', 'G3'],
  ['D3', 'F3', 'A3'],
  ['F3', 'A3', 'C4'],
  ['Bb2', 'D3', 'F3'],
  ['A2', 'Cs4', 'E3'],
];
const BATTLE_MELODY: [string, number][] = [
  ['D5', 2], ['D5', 1], ['E5', 1], ['F5', 2], ['A5', 2],
  ['G5', 2], ['F5', 2], ['E5', 4],
  ['D5', 2], ['C5', 2], ['Bb4', 2], ['C5', 2],
  ['D5', 4], ['A4', 4],
  ['F5', 2], ['F5', 1], ['G5', 1], ['A5', 2], ['F5', 2],
  ['C5', 2], ['D5', 2], ['E5', 4],
  ['F5', 2], ['E5', 2], ['D5', 2], ['Bb4', 2],
  ['A4', 6], ['-', 2],
];

class Music {
  private ctx: AudioContext | null = null;
  private out: GainNode | null = null;
  private theme: Theme | null = null;
  private wanted: Theme | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private next = 0;
  private step = 0;
  enabled = true;

  constructor() {
    if (typeof window === 'undefined') return;
    try {
      this.enabled = localStorage.getItem(KEY) !== '0';
    } catch {
      /* default on */
    }
    onFirstAudioGesture(() => this.unlock());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) void this.ctx?.suspend();
      else if (this.enabled && this.theme) void this.ctx?.resume();
    });
  }

  private unlock() {
    if (!this.ctx) {
      try {
        this.ctx = new AudioContext();
        this.out = this.ctx.createGain();
        this.out.gain.value = 0;
        this.out.connect(this.ctx.destination);
      } catch {
        this.ctx = null;
        return;
      }
    }
    void this.ctx.resume();
    if (this.wanted && this.enabled) this.start(this.wanted);
  }

  setEnabled(on: boolean) {
    this.enabled = on;
    try {
      localStorage.setItem(KEY, on ? '1' : '0');
    } catch {
      /* not remembered */
    }
    if (!on) this.stop();
    else if (this.wanted) this.start(this.wanted);
  }

  /** Play a theme (no-op if it is already playing); starts after the first tap if needed. */
  play(theme: Theme) {
    this.wanted = theme;
    if (!this.enabled || !this.ctx || this.ctx.state === 'closed') return;
    if (this.theme === theme && this.timer) return;
    this.start(theme);
  }

  private start(theme: Theme) {
    const ctx = this.ctx;
    if (!ctx || !this.out) return;
    this.stop(true);
    this.theme = theme;
    this.step = 0;
    this.next = ctx.currentTime + 0.15;
    const g = this.out.gain;
    g.cancelScheduledValues(ctx.currentTime);
    g.setValueAtTime(g.value, ctx.currentTime);
    g.linearRampToValueAtTime(theme === 'battle' ? 0.16 : 0.13, ctx.currentTime + 1.2);
    this.timer = setInterval(() => this.schedule(), 50);
  }

  stop(quick = false) {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.theme = null;
    const ctx = this.ctx;
    if (ctx && this.out && !quick) {
      this.out.gain.cancelScheduledValues(ctx.currentTime);
      this.out.gain.setValueAtTime(this.out.gain.value, ctx.currentTime);
      this.out.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.4);
    }
  }

  /** Queue every eighth-note step that starts within the next 0.25 s. */
  private schedule() {
    const ctx = this.ctx;
    if (!ctx || !this.theme) return;
    const battle = this.theme === 'battle';
    const eighth = 60 / (battle ? 132 : 88) / 2;
    while (this.next < ctx.currentTime + 0.25) {
      this.playStep(this.step, this.next, eighth, battle);
      this.next += eighth;
      this.step = (this.step + 1) % 64;
    }
  }

  private playStep(step: number, t: number, e: number, battle: boolean) {
    const bar = Math.floor(step / 8);
    const beat = step % 8;
    const chord = (battle ? BATTLE_CHORDS : HOME_CHORDS)[bar]!;
    if (battle) {
      // War drums: low tom on every beat, a rim on the offbeats, a big hit to open each bar.
      if (beat % 2 === 0) this.drum(t, beat === 0 ? 70 : 95, beat === 0 ? 0.9 : 0.55, 0.22);
      else this.hat(t, 0.12);
      if (beat === 4) this.snare(t, 0.4);
      // Bass ostinato: root eighths with a fifth pickup.
      this.pluck(hz(chord[0]!) / 2, t, e * 0.9, beat === 7 ? 0.18 : 0.26, 'sawtooth', 600);
      // Brass stabs on beats 1 and 3.
      if (beat === 0 || beat === 4) for (const n of chord) this.pad(hz(n), t, e * 1.6, 0.06, 'sawtooth', 1400);
    } else {
      // Warm pad that holds the bar, a soft hand drum, lute arpeggio, bass on the beat.
      if (beat === 0) for (const n of chord) this.pad(hz(n), t, e * 8, 0.05, 'triangle', 900);
      if (beat === 0 || beat === 4) this.drum(t, 85, 0.4, 0.25);
      if (beat === 6) this.drum(t, 110, 0.18, 0.15);
      const arp = [0, 1, 2, 1, 0, 2, 1, 2][beat]!;
      this.pluck(hz(chord[arp]!) * 2, t, e * 1.8, 0.07, 'triangle', 2600);
      if (beat === 0 || beat === 4) this.pluck(hz(chord[0]!) / 2, t, e * 3.5, 0.16, 'sine', 400);
    }
    // The melody: walk the note list by eighths.
    const mel = battle ? BATTLE_MELODY : HOME_MELODY;
    let at = 0;
    for (const [n, len] of mel) {
      if (at === step && n !== '-') this.lead(hz(n), t, e * len, battle);
      at += len;
    }
  }

  private env(t: number, dur: number, peak: number, attack = 0.01) {
    const g = this.ctx!.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    g.connect(this.out!);
    return g;
  }

  private osc(type: OscillatorType, f: number, t: number, dur: number, into: AudioNode, cutoff?: number) {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f, t);
    if (cutoff) {
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = cutoff;
      o.connect(lp).connect(into);
    } else o.connect(into);
    o.start(t);
    o.stop(t + dur + 0.05);
    return o;
  }

  private pluck(f: number, t: number, dur: number, vol: number, type: OscillatorType, cutoff: number) {
    this.osc(type, f, t, dur, this.env(t, dur, vol, 0.005), cutoff);
  }

  private pad(f: number, t: number, dur: number, vol: number, type: OscillatorType, cutoff: number) {
    const g = this.env(t, dur, vol, Math.min(0.25, dur / 4));
    this.osc(type, f, t, dur, g, cutoff);
    this.osc(type, f * 1.004, t, dur, g, cutoff); // a slight chorus
  }

  private lead(f: number, t: number, dur: number, battle: boolean) {
    const ctx = this.ctx!;
    const g = this.env(t, dur * 0.95, battle ? 0.07 : 0.06, 0.03);
    const o = this.osc(battle ? 'square' : 'sine', f, t, dur, g, battle ? 2200 : undefined);
    // A gentle vibrato, like a flute (home) or a horn (battle).
    const lfo = ctx.createOscillator();
    const depth = ctx.createGain();
    lfo.frequency.value = 5.2;
    depth.gain.value = f * 0.006;
    lfo.connect(depth).connect(o.frequency);
    lfo.start(t + 0.12);
    lfo.stop(t + dur + 0.05);
  }

  private drum(t: number, f: number, vol: number, dur: number) {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(f * 1.8, t);
    o.frequency.exponentialRampToValueAtTime(f, t + 0.08);
    o.connect(this.env(t, dur, vol, 0.004));
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  private noise(t: number, dur: number, vol: number, type: BiquadFilterType, f: number) {
    const ctx = this.ctx!;
    const buf = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * dur), ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const fl = ctx.createBiquadFilter();
    fl.type = type;
    fl.frequency.value = f;
    src.connect(fl).connect(this.env(t, dur, vol, 0.002));
    src.start(t);
  }

  private snare(t: number, vol: number) {
    this.noise(t, 0.16, vol, 'bandpass', 1800);
  }

  private hat(t: number, vol: number) {
    this.noise(t, 0.05, vol, 'highpass', 6000);
  }
}

export const music = new Music();
