import { describe, expect, it } from 'vitest';
import { carById } from '../cars';
import { Car } from '../sim/car';
import { defaultProgress } from './progress';
import { clutchWillSlip, fitPart, peakPower, tuneFor, tunedSpec } from './tuning';

/** Hold an rpm with the clutch in and the throttle pinned, then report boost and torque. */
function revAt(car: Car, rpm: number, seconds: number, throttle = 1) {
  for (let t = 0; t < seconds; t += 0.001) {
    car.engineOmega = rpm / (60 / (2 * Math.PI));
    car.step(0.001, { throttle, brake: 0, clutch: 1, handbrake: false, slope: 0 });
  }
}

describe('turbo', () => {
  it('builds boost slowly low down and quickly once spooled', () => {
    const car = new Car(carById('ronin').spec);
    car.running = true;
    revAt(car, 2200, 1);
    const low = car.boost;
    const car2 = new Car(carById('ronin').spec);
    car2.running = true;
    revAt(car2, 5000, 1);
    expect(low).toBeLessThan(0.25);
    expect(car2.boost).toBeGreaterThan(0.8);
  });
  it('makes less torque before the boost arrives', () => {
    const car = new Car(carById('ronin').spec);
    car.running = true;
    revAt(car, 4000, 0.02);
    const early = car.combustionTorque;
    revAt(car, 4000, 2);
    expect(car.combustionTorque).toBeGreaterThan(early * 1.3);
  });
  it('vents through the blow-off valve when you lift with boost up', () => {
    const car = new Car(carById('ronin').spec);
    car.running = true;
    revAt(car, 5000, 1.5);
    car.drainEvents();
    revAt(car, 5000, 0.3, 0);
    expect(car.drainEvents().some((e) => e.type === 'blowoff')).toBe(true);
  });
});

describe('tuning', () => {
  it('buys a part once and then fits it for free', () => {
    const p = defaultProgress();
    p.creds = 2000;
    expect(fitPart(p, 'hatch', 'turbo', 1)).toBe('bought');
    expect(p.creds).toBe(200);
    expect(fitPart(p, 'hatch', 'turbo', 0)).toBe('fitted');
    expect(fitPart(p, 'hatch', 'turbo', 1)).toBe('fitted');
    expect(p.creds).toBe(200);
    expect(fitPart(p, 'hatch', 'turbo', 2)).toBe('too-poor');
    expect(tuneFor(p, 'hatch')).toEqual({ turbo: 1 });
    expect(tuneFor(p, 'kitsune')).toEqual({});
  });
  it('turns a turbo kit into real power, and warns when the stock clutch cannot hold it', () => {
    const stock = carById('hatch').spec;
    const big = tunedSpec(stock, { turbo: 2 });
    expect(stock.turbo).toBeUndefined();
    expect(peakPower(big)).toBeGreaterThan(peakPower(stock) * 1.7);
    expect(clutchWillSlip(big)).toBe(true);
    expect(clutchWillSlip(tunedSpec(stock, { turbo: 2, clutch: 2 }))).toBe(false);
  });
  it('narrows the bite with a stage clutch and lightens the car', () => {
    const stock = carById('hatch').spec;
    const t = tunedSpec(stock, { clutch: 2, weight: 2 });
    expect(t.biteEnd - t.biteStart).toBeLessThan((stock.biteEnd - stock.biteStart) * 0.8);
    expect(t.mass).toBeCloseTo(stock.mass * 0.9);
  });
});
