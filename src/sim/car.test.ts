import { describe, expect, it } from 'vitest';
import { Car, CarInputs } from './car';

const DT = 0.001;

function inputs(p: Partial<CarInputs> = {}): CarInputs {
  return { throttle: 0, brake: 0, clutch: 0, handbrake: false, slope: 0, ...p };
}

function run(car: Car, seconds: number, inp: CarInputs | ((t: number) => CarInputs)) {
  const events: string[] = [];
  const n = Math.round(seconds / DT);
  for (let i = 0; i < n; i++) {
    car.step(DT, typeof inp === 'function' ? inp(i * DT) : inp);
    for (const e of car.drainEvents()) events.push(e.type);
  }
  return events;
}

function runningCar() {
  const car = new Car();
  car.crank();
  run(car, 3, inputs());
  return car;
}

describe('engine', () => {
  it('starts with the starter and settles at idle', () => {
    const car = new Car();
    car.crank();
    const ev = run(car, 4, inputs());
    expect(ev).toContain('start');
    expect(car.running).toBe(true);
    expect(car.rpm).toBeGreaterThan(780);
    expect(car.rpm).toBeLessThan(920);
  });

  it('revs up in neutral and respects the rev limiter', () => {
    const car = runningCar();
    run(car, 3, inputs({ throttle: 1 }));
    expect(car.rpm).toBeGreaterThan(6400);
    expect(car.rpm).toBeLessThan(7000);
  });
});

describe('clutch', () => {
  it('refuses a gear with the clutch out (grinds)', () => {
    const car = runningCar();
    expect(car.shiftTo(1, 0)).toBe(false);
    expect(car.drainEvents().map((e) => e.type)).toContain('grind');
    expect(car.gear).toBe(0);
  });

  it('stalls when the clutch is dumped at idle in first', () => {
    const car = runningCar();
    car.shiftTo(1, 1);
    const ev = run(car, 1.5, inputs({ clutch: 0 }));
    expect(ev).toContain('stall');
    expect(car.running).toBe(false);
  });

  it('pulls away without stalling when released slowly with a little gas', () => {
    const car = runningCar();
    car.shiftTo(1, 1);
    const ev = run(car, 4, (t) => inputs({ clutch: Math.max(0, 1 - t / 2.5), throttle: 0.2 }));
    expect(ev).not.toContain('stall');
    expect(ev).toContain('lock');
    expect(car.locked).toBe(true);
    expect(car.speed).toBeGreaterThan(1);
  });

  it('can creep away from idle with a very slow release and no gas', () => {
    const car = runningCar();
    car.shiftTo(1, 1);
    const ev = run(car, 12, (t) => inputs({ clutch: Math.max(0, 1 - t / 10) }));
    expect(ev).not.toContain('stall');
    expect(car.speed).toBeGreaterThan(0.5);
  });

  it('transmits no torque with the pedal fully pressed', () => {
    const car = new Car();
    expect(car.clutchCapacityFor(1)).toBe(0);
    expect(car.clutchCapacityFor(0)).toBe(car.spec.clutchMaxTorque);
  });
});

describe('driving', () => {
  it('accelerates through the gears', () => {
    const car = runningCar();
    car.shiftTo(1, 1);
    run(car, 3, (t) => inputs({ clutch: Math.max(0, 1 - t / 1.5), throttle: 0.5 }));
    for (const g of [2, 3]) {
      run(car, 3, inputs({ throttle: 1 }));
      car.shiftTo(g, 1);
      run(car, 0.6, (t) => inputs({ clutch: Math.max(0, 1 - t / 0.5), throttle: 0.4 }));
    }
    run(car, 3, inputs({ throttle: 1 }));
    expect(car.gear).toBe(3);
    expect(car.running).toBe(true);
    expect(car.speed * 3.6).toBeGreaterThan(70);
  });

  it('rolls back on a hill in neutral and the brake holds it', () => {
    const car = new Car();
    run(car, 2, inputs({ slope: 0.08 }));
    expect(car.speed).toBeLessThan(-0.5);
    const held = new Car();
    run(held, 2, inputs({ slope: 0.08, brake: 0.5 }));
    expect(held.speed).toBe(0);
  });

  it('holds the car on a hill when parked in gear with the engine off', () => {
    const car = new Car();
    car.shiftTo(1, 1);
    run(car, 2, inputs({ slope: 0.08 }));
    expect(Math.abs(car.speed)).toBeLessThan(0.05);
  });

  it('matching revs on a downshift gives a smooth engagement', () => {
    const drive = () => {
      const car = runningCar();
      car.shiftTo(1, 1);
      run(car, 3, (t) => inputs({ clutch: Math.max(0, 1 - t / 1.5), throttle: 0.5 }));
      run(car, 3, inputs({ throttle: 1 }));
      car.shiftTo(2, 1);
      run(car, 0.5, (t) => inputs({ clutch: Math.max(0, 1 - t / 0.4), throttle: 0.3 }));
      run(car, 3, inputs({ throttle: 1 }));
      return car;
    };
    const lurch = (blip: boolean) => {
      const car = drive();
      car.shiftTo(1, 1);
      run(car, 0.25, inputs({ clutch: 1, throttle: blip ? 1 : 0 }));
      let peak = 0;
      run(car, 0.6, (t) => {
        peak = Math.max(peak, Math.abs(car.accel));
        return inputs({ clutch: t < 0.05 ? 1 : 0, throttle: blip ? 0.3 : 0 });
      });
      return peak;
    };
    expect(lurch(true)).toBeLessThan(lurch(false));
  });
});

describe('neutral', () => {
  it('locks the clutch in neutral instead of chattering', () => {
    const car = runningCar();
    run(car, 1, inputs({ clutch: 0 }));
    expect(car.locked).toBe(true);
    expect(Math.abs(car.slipRpm)).toBeLessThan(1);
  });
});
