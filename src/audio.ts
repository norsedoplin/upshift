// Synthesized engine sound. No samples: a harmonic-rich oscillator locked to crank speed,
// shaped by load, plus intake noise, starter whine, wind and gear grind.

import type { EngineSound } from './cars';
import type { Car } from './sim/car';

export class EngineAudio {
  ctx: AudioContext | null = null;
  private master!: GainNode;
  private engineOsc!: OscillatorNode;
  private engineOsc2!: OscillatorNode;
  private engineGain!: GainNode;
  private engineFilter!: BiquadFilterNode;
  private shaper!: WaveShaperNode;
  private intakeFilter!: BiquadFilterNode;
  private intakeGain!: GainNode;
  private starterOsc!: OscillatorNode;
  private starterGain!: GainNode;
  private windFilter!: BiquadFilterNode;
  private windGain!: GainNode;
  private grindGain!: GainNode;
  private clutchGain!: GainNode;
  private clutchFilter!: BiquadFilterNode;
  private squealFilter!: BiquadFilterNode;
  private squealGain!: GainNode;
  volume = 0.8;
  private muted = false;
  private cylinders: EngineSound = 4;

  start() {
    if (this.ctx) {
      this.ctx.resume();
      return;
    }
    const ctx = new AudioContext();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : this.volume;
    const comp = ctx.createDynamicsCompressor();
    this.master.connect(comp).connect(ctx.destination);

    // Four-cylinder character: firing order (2nd crank harmonic) dominates, with
    // half-order content for the uneven, lumpy sound of real combustion.
    const wave = engineWave(ctx, this.cylinders);
    this.engineOsc = ctx.createOscillator();
    this.engineOsc.setPeriodicWave(wave);
    this.engineOsc2 = ctx.createOscillator();
    this.engineOsc2.setPeriodicWave(wave);
    this.engineOsc2.detune.value = 9;
    const mix = ctx.createGain();
    mix.gain.value = 0.5;
    this.engineOsc.connect(mix);
    this.engineOsc2.connect(mix);

    this.shaper = ctx.createWaveShaper();
    this.shaper.curve = makeDrive(2.2);
    this.engineFilter = ctx.createBiquadFilter();
    this.engineFilter.type = 'lowpass';
    this.engineFilter.Q.value = 2.5;
    this.engineGain = ctx.createGain();
    this.engineGain.gain.value = 0;
    mix.connect(this.shaper).connect(this.engineFilter).connect(this.engineGain).connect(this.master);

    const noise = makeNoise(ctx);
    this.intakeFilter = ctx.createBiquadFilter();
    this.intakeFilter.type = 'bandpass';
    this.intakeFilter.Q.value = 1.2;
    this.intakeGain = ctx.createGain();
    this.intakeGain.gain.value = 0;
    noise.connect(this.intakeFilter).connect(this.intakeGain).connect(this.master);

    this.windFilter = ctx.createBiquadFilter();
    this.windFilter.type = 'lowpass';
    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0;
    noise.connect(this.windFilter).connect(this.windGain).connect(this.master);

    const grindFilter = ctx.createBiquadFilter();
    grindFilter.type = 'bandpass';
    grindFilter.frequency.value = 2800;
    grindFilter.Q.value = 4;
    this.grindGain = ctx.createGain();
    this.grindGain.gain.value = 0;
    noise.connect(grindFilter).connect(this.grindGain).connect(this.master);

    // Faint friction hiss from a slipping clutch.
    this.clutchFilter = ctx.createBiquadFilter();
    this.clutchFilter.type = 'bandpass';
    this.clutchFilter.Q.value = 3;
    this.clutchGain = ctx.createGain();
    this.clutchGain.gain.value = 0;
    noise.connect(this.clutchFilter).connect(this.clutchGain).connect(this.master);

    // Tyre squeal: narrow band of noise that rises as the tyres pass their limit.
    this.squealFilter = ctx.createBiquadFilter();
    this.squealFilter.type = 'bandpass';
    this.squealFilter.frequency.value = 900;
    this.squealFilter.Q.value = 9;
    this.squealGain = ctx.createGain();
    this.squealGain.gain.value = 0;
    noise.connect(this.squealFilter).connect(this.squealGain).connect(this.master);

    this.starterOsc = ctx.createOscillator();
    this.starterOsc.type = 'sawtooth';
    this.starterOsc.frequency.value = 180;
    const starterFilter = ctx.createBiquadFilter();
    starterFilter.type = 'lowpass';
    starterFilter.frequency.value = 900;
    this.starterGain = ctx.createGain();
    this.starterGain.gain.value = 0;
    this.starterOsc.connect(starterFilter).connect(this.starterGain).connect(this.master);

    this.engineOsc.start();
    this.engineOsc2.start();
    this.starterOsc.start();
    noise.start();
  }

  grind() {
    if (!this.ctx) return;
    const g = this.grindGain.gain;
    const t = this.ctx.currentTime;
    g.cancelScheduledValues(t);
    for (let i = 0; i < 6; i++) {
      g.setValueAtTime(0.35, t + i * 0.035);
      g.setValueAtTime(0.05, t + i * 0.035 + 0.018);
    }
    g.setTargetAtTime(0, t + 0.21, 0.03);
  }

  update(car: Car, tyreSlip = 0) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const tc = 0.02;
    const rpm = Math.max(0, car.rpm);
    const crankHz = rpm / 60;
    this.engineOsc.frequency.setTargetAtTime(Math.max(1, crankHz), t, tc);
    this.engineOsc2.frequency.setTargetAtTime(Math.max(1, crankHz), t, tc);

    const spinning = Math.min(1, rpm / 300);
    const load = car.load;
    const level = car.running ? 0.22 + 0.4 * load + (rpm / 7000) * 0.2 : car.cranking ? 0.12 * spinning : 0.1 * spinning;
    this.engineGain.gain.setTargetAtTime(level, t, car.running ? tc : 0.08);
    this.engineFilter.frequency.setTargetAtTime(180 + rpm * 0.28 + load * 1400, t, tc);

    this.intakeFilter.frequency.setTargetAtTime(500 + rpm * 0.35, t, tc);
    this.intakeGain.gain.setTargetAtTime(car.running ? car.throttleEff * (0.03 + (rpm / 7000) * 0.12) : 0, t, tc);

    this.starterGain.gain.setTargetAtTime(car.cranking ? 0.06 : 0, t, 0.02);
    this.starterOsc.frequency.setTargetAtTime(150 + rpm * 0.6, t, 0.05);

    const v = Math.abs(car.speed);
    this.windFilter.frequency.setTargetAtTime(200 + v * 25, t, 0.1);
    this.windGain.gain.setTargetAtTime(Math.min(0.35, (v / 40) ** 2 * 0.3 + (v > 0.3 ? 0.015 : 0)), t, 0.1);

    const squeal = Math.max(0, Math.min(1, (tyreSlip - 0.1) / 0.2));
    this.squealGain.gain.setTargetAtTime(squeal * 0.22, t, 0.05);
    this.squealFilter.frequency.setTargetAtTime(750 + squeal * 350 + Math.sin(t * 17) * 40, t, 0.05);

    const slipPower = Math.abs(car.clutchTorque * (car.engineOmega - car.outputOmega));
    this.clutchFilter.frequency.setTargetAtTime(900 + Math.abs(car.slipRpm) * 0.4, t, tc);
    this.clutchGain.gain.setTargetAtTime(Math.min(0.05, slipPower / 400000), t, tc);
  }

  /**
   * Little musical stings for score events: a chime that climbs in pitch as the combo grows,
   * a brighter arpeggio for the big ones, a dull thud for mistakes and a riser on a new tier.
   */
  sting(kind: 'good' | 'great' | 'bad' | 'tier', combo = 0) {
    const ctx = this.ctx;
    if (!ctx || this.muted) return;
    const t0 = ctx.currentTime + 0.005;
    const out = ctx.createGain();
    out.gain.value = 0.5;
    out.connect(this.master);
    const note = (freq: number, at: number, len: number, type: OscillatorType, vol: number) => {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = freq;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t0 + at);
      g.gain.linearRampToValueAtTime(vol, t0 + at + 0.008);
      g.gain.exponentialRampToValueAtTime(0.0008, t0 + at + len);
      o.connect(g).connect(out);
      o.start(t0 + at);
      o.stop(t0 + at + len + 0.05);
    };
    // A major scale step per combo level, so a streak sounds like it's going somewhere.
    const steps = [0, 2, 4, 5, 7, 9, 11, 12, 14];
    const root = 523.25 * 2 ** (steps[Math.min(8, combo)] / 12);
    if (kind === 'good') {
      note(root, 0, 0.16, 'triangle', 0.22);
      note(root * 1.5, 0.06, 0.2, 'triangle', 0.16);
    } else if (kind === 'great') {
      [1, 1.25, 1.5, 2].forEach((m, i) => note(root * m, i * 0.05, 0.28, 'triangle', 0.2));
      note(root * 4, 0.15, 0.4, 'sine', 0.06);
    } else if (kind === 'bad') {
      const o = ctx.createOscillator();
      o.type = 'square';
      o.frequency.setValueAtTime(190, t0);
      o.frequency.exponentialRampToValueAtTime(70, t0 + 0.28);
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = 600;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.25, t0);
      g.gain.exponentialRampToValueAtTime(0.0008, t0 + 0.3);
      o.connect(f).connect(g).connect(out);
      o.start(t0);
      o.stop(t0 + 0.35);
    } else {
      [1, 1.25, 1.5, 2, 2.5].forEach((m, i) => note(root * m * 0.5, i * 0.07, 0.35, 'sawtooth', 0.07));
      [1, 1.5, 2].forEach((m) => note(root * m, 0.35, 0.6, 'triangle', 0.12));
      // A whoosh under it.
      const n = makeNoise(ctx);
      const f = ctx.createBiquadFilter();
      f.type = 'bandpass';
      f.Q.value = 2;
      f.frequency.setValueAtTime(400, t0);
      f.frequency.exponentialRampToValueAtTime(5000, t0 + 0.45);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t0);
      g.gain.linearRampToValueAtTime(0.18, t0 + 0.35);
      g.gain.exponentialRampToValueAtTime(0.0008, t0 + 0.7);
      n.connect(f).connect(g).connect(out);
      n.start(t0);
      n.stop(t0 + 0.75);
    }
    setTimeout(() => out.disconnect(), 1500);
  }

  setMuted(m: boolean) {
    this.muted = m;
    if (this.ctx) this.master.gain.setTargetAtTime(m ? 0 : this.volume, this.ctx.currentTime, 0.05);
  }

  setVolume(v: number) {
    this.volume = v;
    this.setMuted(this.muted);
  }

  /** Change the engine's character (firing order) for a different car. */
  setEngine(cylinders: EngineSound) {
    this.cylinders = cylinders;
    if (!this.ctx) return;
    const wave = engineWave(this.ctx, cylinders);
    this.engineOsc.setPeriodicWave(wave);
    this.engineOsc2.setPeriodicWave(wave);
  }
}

/**
 * Harmonics of crank rotation. A four fires twice per turn (2nd order dominates) with
 * half-order roughness; a straight six fires three times per turn and sounds smoother.
 */
function engineWave(ctx: AudioContext, cylinders: EngineSound) {
  // Harmonics of the crank frequency. A four fires twice a revolution, a six three
  // times; a twin-rotor also fires twice, but its short, sharp exhaust pulses keep
  // the upper harmonics strong, which gives the buzzy "brap".
  const h =
    cylinders === 4
      ? [0, 0.25, 1.0, 0.18, 0.55, 0.12, 0.35, 0.06, 0.22, 0.05, 0.12, 0.03, 0.08]
      : cylinders === 6
        ? [0, 0.12, 0.2, 1.0, 0.1, 0.15, 0.6, 0.05, 0.1, 0.32, 0.04, 0.06, 0.18]
        : [0, 0.08, 1.0, 0.1, 0.78, 0.07, 0.66, 0.06, 0.55, 0.05, 0.46, 0.04, 0.38, 0.03, 0.3, 0.02, 0.24];
  return ctx.createPeriodicWave(new Float32Array(h.length), new Float32Array(h));
}

function makeNoise(ctx: AudioContext) {
  const buf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.loop = true;
  return src;
}

function makeDrive(k: number) {
  const n = 1024;
  const curve = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    curve[i] = Math.tanh(k * x) / Math.tanh(k);
  }
  return curve;
}
