import { describe, expect, it } from 'vitest';
import { Car, CarInputs } from '../sim/car';
import { Scorer, ScoreEvent, cashoutFor, tierFor } from './scoring';

const DT = 0.001;
const FRAME = 1 / 60;

type Feet = { throttle: number; brake: number; clutch: number };

/** Run car + scorer at 60 fps with a 1 kHz sim, like the game loop. */
function play(car: Car, sc: Scorer, seconds: number, feet: (t: number) => Feet, onFrame?: (t: number) => void) {
  const out: ScoreEvent[] = [];
  const frames = Math.round(seconds / FRAME);
  for (let f = 0; f < frames; f++) {
    const t = f * FRAME;
    onFrame?.(t);
    const ft = feet(t);
    const inp: CarInputs = { ...ft, handbrake: false, slope: 0 };
    for (let i = 0; i < Math.round(FRAME / DT); i++) car.step(DT, inp);
    sc.update(FRAME, car, ft, car.drainEvents());
    out.push(...sc.drain());
  }
  return out;
}

function inThird() {
  const car = new Car();
  const sc = new Scorer();
  car.crank();
  play(car, sc, 2, () => ({ throttle: 0, brake: 0, clutch: 0 }));
  car.shiftTo(1, 1);
  play(car, sc, 3, (t) => ({ throttle: 0.4, brake: 0, clutch: Math.max(0, 1 - t / 1.5) }));
  for (const g of [2, 3]) {
    play(car, sc, 2.5, () => ({ throttle: 1, brake: 0, clutch: 0 }));
    car.shiftTo(g, 1);
    play(car, sc, 1, (t) => ({ throttle: t > 0.3 ? 0.3 : 0, brake: 0, clutch: Math.max(0, 1 - t / 0.5) }));
  }
  play(car, sc, 2.5, () => ({ throttle: 1, brake: 0, clutch: 0 }));
  sc.drain();
  return { car, sc };
}

/** Clutch in, change gear, let the clutch out over `release` seconds with `throttle` during the gap. */
function shift(car: Car, sc: Scorer, gear: number, opts: { release: number; blip?: number; brake?: number }) {
  let shifted = false;
  return play(
    car,
    sc,
    2,
    (t) => ({
      throttle: t < 0.25 ? 0 : t < 0.45 ? opts.blip ?? 0 : 0,
      brake: opts.brake ?? 0,
      clutch: t < 0.25 ? 1 : Math.max(0, 1 - (t - 0.45) / opts.release),
    }),
    (t) => {
      if (!shifted && t > 0.1) shifted = car.shiftTo(gear, 1);
    },
  );
}

describe('scoring', () => {
  it('rewards a smooth launch', () => {
    const car = new Car();
    const sc = new Scorer();
    car.crank();
    play(car, sc, 2, () => ({ throttle: 0, brake: 0, clutch: 1 }));
    car.shiftTo(1, 1);
    const ev = play(car, sc, 4, (t) => ({ throttle: 0.3, brake: 0, clutch: Math.max(0, 1 - t / 2) }));
    expect(ev.map((e) => e.label)).toContain('SMOOTH LAUNCH');
  });

  it('grades a quick, matched upshift well', () => {
    const { car, sc } = inThird();
    const ev = shift(car, sc, 4, { release: 0.3 });
    const grade = ev.find((e) => e.label.endsWith('SHIFT'));
    expect(grade?.good).toBe(true);
  });

  it('grades a downshift without a blip worse than one with a blip', () => {
    const a = inThird();
    const rough = shift(a.car, a.sc, 2, { release: 0.1 }).find((e) => e.label.endsWith('SHIFT'))!;
    const b = inThird();
    const matched = shift(b.car, b.sc, 2, { release: 0.1, blip: 1 }).find((e) => e.label.endsWith('SHIFT'))!;
    expect(matched.points).toBeGreaterThan(rough.points);
  });

  it('awards heel-toe for a braking, blipped, matched downshift', () => {
    const { car, sc } = inThird();
    const ev = shift(car, sc, 2, { release: 0.15, blip: 1, brake: 0.4 });
    expect(ev.map((e) => e.label)).toContain('HEEL-TOE');
  });

  it('punishes a money shift into first at speed', () => {
    const { car, sc } = inThird();
    const ev = shift(car, sc, 1, { release: 0.1 });
    expect(ev.map((e) => e.label)).toContain('MONEY SHIFT');
  });

  it('punishes a stall and resets the combo', () => {
    const car = new Car();
    const sc = new Scorer();
    sc.combo = 4;
    car.crank();
    play(car, sc, 2, () => ({ throttle: 0, brake: 0, clutch: 1 }));
    car.shiftTo(1, 1);
    const ev = play(car, sc, 2, () => ({ throttle: 0, brake: 0, clutch: 0 }));
    expect(ev.map((e) => e.label)).toContain('STALLED');
    expect(sc.combo).toBe(0);
  });
});

describe('combo tiers and cashout', () => {
  it('names the combo as it climbs', () => {
    expect(tierFor(0).name).toBe('');
    expect(tierFor(4).name).toBe('HOT');
    expect(tierFor(12).name).toBe('TOUGE KING');
  });
  it('pays a tenth of the score when you leave early, without the finish bonus', () => {
    const stats = { score: 1840, shifts: 0, perfect: 0, clean: 0, heelToe: 0, stalls: 0, bestCombo: 0, flow: 0 };
    expect(cashoutFor(stats)).toBe(184);
  });
});
