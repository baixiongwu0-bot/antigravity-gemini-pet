/**
 * Zero-dependency Web Audio API procedural cute SFX synthesizer.
 * Safe no-op inside Node.js test environments where AudioContext is unavailable.
 */

export type PetSoundKind =
  | 'click'
  | 'meow_happy'
  | 'meow_shy'
  | 'meow_tsundere'
  | 'meow_sleepy'
  | 'meow_startle'
  | 'star_chime'
  | 'star_celebrate'
  | 'crunch';

let soundEnabled = true;
let audioCtx: AudioContext | null = null;
let noiseBuffer: AudioBuffer | null = null;

export function setSoundEnabled(enabled: boolean): void {
  soundEnabled = Boolean(enabled);
}

export function isSoundEnabled(): boolean {
  return soundEnabled;
}

function getAudioContext(): AudioContext | null {
  if (!soundEnabled || typeof window === 'undefined') return null;
  const g = window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext };
  const Ctor = g.AudioContext || g.webkitAudioContext;
  if (!Ctor) return null;
  try {
    if (!audioCtx) {
      audioCtx = new Ctor();
    }
    if (audioCtx.state === 'suspended') {
      void audioCtx.resume().catch(() => {});
    }
    return audioCtx;
  } catch {
    return null;
  }
}

function getNoiseBuffer(ctx: AudioContext): AudioBuffer {
  if (noiseBuffer && noiseBuffer.sampleRate === ctx.sampleRate) return noiseBuffer;
  const len = Math.floor(ctx.sampleRate * 0.25);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) {
    data[i] = Math.random() * 2 - 1;
  }
  noiseBuffer = buf;
  return buf;
}

function scheduleTone(
  ctx: AudioContext,
  startAt: number,
  duration: number,
  freqStart: number,
  freqMid: number,
  freqEnd: number,
  gainPeak: number,
  type: OscillatorType = 'triangle',
  cutoffHz = 2200,
): void {
  const osc = ctx.createOscillator();
  const filter = ctx.createBiquadFilter();
  const gain = ctx.createGain();

  osc.type = type;
  osc.frequency.setValueAtTime(freqStart, startAt);
  osc.frequency.exponentialRampToValueAtTime(Math.max(40, freqMid), startAt + duration * 0.42);
  osc.frequency.exponentialRampToValueAtTime(Math.max(40, freqEnd), startAt + duration);

  filter.type = 'lowpass';
  filter.frequency.setValueAtTime(cutoffHz, startAt);
  filter.Q.setValueAtTime(1.4, startAt);

  gain.gain.setValueAtTime(0.0001, startAt);
  gain.gain.linearRampToValueAtTime(gainPeak, startAt + Math.min(0.025, duration * 0.2));
  gain.gain.exponentialRampToValueAtTime(0.0001, startAt + duration);

  osc.connect(filter);
  filter.connect(gain);
  gain.connect(ctx.destination);
  osc.start(startAt);
  osc.stop(startAt + duration + 0.02);
}

function scheduleNoiseBurst(
  ctx: AudioContext,
  startAt: number,
  duration: number,
  centerHz: number,
  q: number,
  gainPeak: number,
): void {
  const src = ctx.createBufferSource();
  src.buffer = getNoiseBuffer(ctx);
  const filter = ctx.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.setValueAtTime(centerHz, startAt);
  filter.Q.setValueAtTime(q, startAt);

  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.0001, startAt);
  gain.gain.linearRampToValueAtTime(gainPeak, startAt + 0.006);
  gain.gain.exponentialRampToValueAtTime(0.0001, startAt + duration);

  src.connect(filter);
  filter.connect(gain);
  gain.connect(ctx.destination);
  src.start(startAt);
  src.stop(startAt + duration + 0.01);
}

export function playPetSound(kind: PetSoundKind): void {
  const ctx = getAudioContext();
  if (!ctx) return;
  try {
    const t = ctx.currentTime + 0.005;
    switch (kind) {
      case 'click':
        scheduleTone(ctx, t, 0.055, 520, 620, 380, 0.045, 'sine', 2400);
        break;
      case 'meow_happy':
        scheduleTone(ctx, t, 0.21, 560, 820, 520, 0.075, 'triangle', 1900);
        scheduleNoiseBurst(ctx, t, 0.07, 1700, 2.2, 0.012);
        break;
      case 'meow_shy':
        scheduleTone(ctx, t, 0.19, 640, 910, 680, 0.065, 'sine', 2100);
        scheduleNoiseBurst(ctx, t, 0.05, 1900, 2.0, 0.01);
        break;
      case 'meow_tsundere':
        scheduleTone(ctx, t, 0.11, 680, 520, 440, 0.068, 'triangle', 1750);
        scheduleTone(ctx, t + 0.12, 0.14, 590, 740, 560, 0.058, 'triangle', 1800);
        break;
      case 'meow_sleepy':
        scheduleTone(ctx, t, 0.28, 460, 490, 350, 0.05, 'sine', 1300);
        break;
      case 'meow_startle':
        scheduleTone(ctx, t, 0.13, 620, 980, 790, 0.062, 'triangle', 2200);
        break;
      case 'star_chime': {
        const notes = [1046.5, 1318.5, 1568.0];
        notes.forEach((f, idx) => {
          scheduleTone(ctx, t + idx * 0.065, 0.28, f, f * 1.004, f, 0.042, 'sine', 4200);
        });
        break;
      }
      case 'star_celebrate': {
        const notes = [1046.5, 1318.5, 1568.0, 1975.5, 2093.0];
        notes.forEach((f, idx) => {
          scheduleTone(ctx, t + idx * 0.06, 0.34, f, f * 1.006, f, 0.046, 'sine', 4800);
        });
        break;
      }
      case 'crunch':
        scheduleNoiseBurst(ctx, t, 0.045, 2400, 1.4, 0.06);
        scheduleNoiseBurst(ctx, t + 0.075, 0.05, 2100, 1.5, 0.055);
        scheduleTone(ctx, t + 0.14, 0.12, 620, 780, 640, 0.042, 'sine', 2000);
        break;
    }
  } catch {
    /* ignore audio context scheduling failures */
  }
}
