import { onFirstAudioGesture } from '../ui/lib/first-audio-gesture';

/**
 * Original procedural sound: every cue is synthesised with Web Audio (no sample files), so the
 * APK ships no audio. Unlocked on the first gesture (WebView autoplay rules, §17.5).
 */
type Cue =
  | 'tap'
  | 'deploy'
  | 'shot'
  | 'boom'
  | 'thud'
  | 'seal'
  | 'coin'
  | 'build'
  | 'star'
  | 'victory'
  | 'defeat'
  | 'rally'
  | 'hit'
  | 'weak'
  | 'error'
  // Phase 8: the new attacks and features (still synthesised, no sample files).
  | 'swing'
  | 'arrow'
  | 'fireball'
  | 'breath'
  | 'slam'
  | 'gem'
  | 'emote'
  | 'alert'
  | 'duel'
  | 'auto';

class Sfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private last = new Map<Cue, number>();
  muted = false;

  constructor() {
    if (typeof window !== 'undefined') onFirstAudioGesture(() => this.unlock());
  }

  unlock() {
    if (this.ctx) return void this.ctx.resume();
    try {
      this.ctx = new AudioContext();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.5;
      this.master.connect(this.ctx.destination);
    } catch {
      this.ctx = null;
    }
  }

  private tone(freq: number, dur: number, type: OscillatorType, vol: number, when = 0, slideTo?: number) {
    const ctx = this.ctx!;
    const t = ctx.currentTime + when;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.master!);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  private noise(dur: number, vol: number, filter: number, when = 0, type: BiquadFilterType = 'lowpass', sweepTo?: number) {
    const ctx = this.ctx!;
    const t = ctx.currentTime + when;
    const buf = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * dur), ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(filter, t);
    if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, t + dur);
    const g = ctx.createGain();
    g.gain.value = vol;
    src.connect(f).connect(g).connect(this.master!);
    src.start(t);
  }

  play(cue: Cue, vol = 1) {
    if (this.muted || !this.ctx || this.ctx.state !== 'running') return;
    const now = performance.now();
    const gap = cue === 'shot' || cue === 'hit' || cue === 'arrow' || cue === 'swing' ? 70 : cue === 'breath' ? 180 : 30;
    const prev = this.last.get(cue);
    if (prev !== undefined && now - prev < gap) return;
    this.last.set(cue, now);
    const v = 0.35 * vol;
    switch (cue) {
      case 'tap':
        return this.tone(660, 0.06, 'triangle', v * 0.6);
      case 'deploy':
        return this.tone(220, 0.08, 'square', v * 0.25, 0, 160);
      case 'shot':
        return this.noise(0.06, v * 0.3, 3000);
      case 'boom':
        this.noise(0.5, v * 1.2, 500);
        return this.tone(90, 0.4, 'sine', v, 0, 40);
      case 'thud':
        return this.noise(0.18, v * 0.8, 800);
      case 'seal':
        this.tone(523, 0.6, 'sine', v * 0.7);
        this.tone(784, 0.8, 'sine', v * 0.5, 0.08);
        return this.tone(1046, 1.0, 'sine', v * 0.35, 0.16);
      case 'coin':
        this.tone(988, 0.08, 'square', v * 0.25);
        return this.tone(1319, 0.14, 'square', v * 0.25, 0.07);
      case 'build':
        this.noise(0.08, v * 0.6, 1500);
        return this.noise(0.08, v * 0.6, 1500, 0.14);
      case 'star':
        return this.tone(880, 0.3, 'triangle', v * 0.6, 0, 1320);
      case 'victory':
        [523, 659, 784, 1046].forEach((f, i) => this.tone(f, 0.35, 'triangle', v * 0.6, i * 0.12));
        return;
      case 'defeat':
        [392, 330, 262].forEach((f, i) => this.tone(f, 0.45, 'sine', v * 0.5, i * 0.18));
        return;
      case 'rally':
        this.tone(392, 0.25, 'sawtooth', v * 0.3);
        return this.tone(523, 0.4, 'sawtooth', v * 0.3, 0.15);
      case 'hit':
        return this.tone(140 + Math.random() * 40, 0.08, 'square', v * 0.25, 0, 80);
      case 'weak':
        return this.tone(1200, 0.15, 'triangle', v * 0.4, 0, 1800);
      case 'error':
        return this.tone(180, 0.18, 'square', v * 0.3, 0, 120);
      case 'swing':
        // Sword swoosh: a band of air swept upward.
        return this.noise(0.14, v * 0.45, 900, 0, 'bandpass', 4200);
      case 'arrow':
        // Arrow / bolt: a short whistle falling in pitch.
        return this.tone(1800, 0.12, 'sine', v * 0.18, 0, 700);
      case 'fireball':
        // Ember Mage: a whoosh, then a soft crackling burst.
        this.noise(0.22, v * 0.5, 300, 0, 'lowpass', 2400);
        return this.noise(0.18, v * 0.35, 2600, 0.12, 'highpass');
      case 'breath':
        // Fire Dragon: a long roaring rush with a low growl under it.
        this.noise(0.55, v * 0.7, 500, 0, 'lowpass', 1800);
        return this.tone(70, 0.5, 'sawtooth', v * 0.18, 0, 55);
      case 'slam':
        // Stone Giant: a deep fist-fall and a short rumble.
        this.tone(60, 0.35, 'sine', v * 1.1, 0, 30);
        return this.noise(0.3, v * 0.9, 380);
      case 'gem':
        [1568, 2093, 2637].forEach((f, i) => this.tone(f, 0.16, 'triangle', v * 0.35, i * 0.06));
        return;
      case 'emote':
        return this.tone(740, 0.09, 'sine', v * 0.5, 0, 990);
      case 'alert':
        // Raid alert horn: two low brassy blasts.
        this.tone(196, 0.32, 'sawtooth', v * 0.32);
        return this.tone(262, 0.4, 'sawtooth', v * 0.32, 0.34);
      case 'duel':
        [392, 523, 659, 784].forEach((f, i) => this.tone(f, 0.22, 'square', v * 0.22, i * 0.09));
        return;
      case 'auto':
        this.tone(523, 0.3, 'sine', v * 0.45);
        this.tone(659, 0.3, 'sine', v * 0.4, 0.1);
        return this.tone(988, 0.5, 'triangle', v * 0.3, 0.2);
    }
  }
}

export const sfx = new Sfx();
