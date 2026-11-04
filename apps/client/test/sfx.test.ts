import { describe, expect, it } from 'vitest';

/**
 * Every sound cue (old and the Phase 8 attack sounds) is synthesised with Web Audio nodes — no
 * sample files — and plays without throwing. A tiny fake AudioContext counts the nodes.
 */
class Param {
  value = 0;
  setValueAtTime() {}
  exponentialRampToValueAtTime() {}
}
let nodes = 0;
class Node {
  frequency = new Param();
  gain = new Param();
  type = '';
  buffer: unknown = null;
  constructor() {
    nodes++;
  }
  connect(n: unknown) {
    return n;
  }
  start() {}
  stop() {}
}
class FakeContext {
  state = 'running';
  currentTime = 0;
  sampleRate = 8000;
  destination = new Node();
  createGain = () => new Node();
  createOscillator = () => new Node();
  createBiquadFilter = () => new Node();
  createBufferSource = () => new Node();
  createBuffer = (_c: number, n: number) => ({ getChannelData: () => new Float32Array(n) });
  resume() {}
}

describe('procedural sound (spec Phase 8)', () => {
  it('every cue, including the new attacks, synthesises from oscillators and noise', async () => {
    (globalThis as unknown as { AudioContext: unknown }).AudioContext = FakeContext;
    const { sfx } = await import('../src/audio/sfx');
    sfx.unlock();
    const cues = ['tap', 'deploy', 'shot', 'boom', 'thud', 'seal', 'coin', 'build', 'star', 'victory', 'defeat', 'rally', 'hit', 'weak', 'error', 'swing', 'arrow', 'fireball', 'breath', 'slam', 'gem', 'emote', 'alert', 'duel', 'auto'] as const;
    for (const c of cues) {
      const before = nodes;
      expect(() => sfx.play(c)).not.toThrow();
      expect(nodes - before, c).toBeGreaterThan(0);
    }
    // Muted: nothing is made.
    sfx.muted = true;
    const before = nodes;
    await new Promise((r) => setTimeout(r, 200));
    sfx.play('breath');
    expect(nodes).toBe(before);
  });
});
