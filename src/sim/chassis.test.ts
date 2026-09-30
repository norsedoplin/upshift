import { describe, expect, it } from 'vitest';
import { Car } from './car';
import { Chassis } from './chassis';

const DT = 0.001;

function drive(seconds: number, car: Car, ch: Chassis, steer: (t: number) => number, throttle = 0.3, handbrake = false) {
  let maxLat = 0;
  for (let i = 0; i < Math.round(seconds / DT); i++) {
    const t = i * DT;
    car.step(DT, { throttle, brake: 0, clutch: 0, handbrake, slope: 0, extraForce: ch.extraForce });
    ch.step(DT, car, { steer: steer(t), handbrake });
    maxLat = Math.max(maxLat, Math.abs(ch.latAccel));
  }
  return maxLat;
}

/** A car already rolling at `speed` m/s in the given gear with the clutch locked. */
function rolling(speed: number, gear = 3) {
  const car = new Car();
  car.crank();
  for (let i = 0; i < 3000; i++) car.step(DT, { throttle: 0, brake: 0, clutch: 0, handbrake: false, slope: 0 });
  car.shiftTo(gear, 1);
  car.setSpeed(speed);
  car.engineOmega = car.outputOmega;
  car.locked = true;
  return car;
}

describe('chassis', () => {
  it('drives straight when not steering', () => {
    const car = rolling(20);
    const ch = new Chassis();
    drive(3, car, ch, () => 0);
    expect(Math.abs(ch.yaw)).toBeLessThan(1e-6);
    expect(Math.abs(ch.x)).toBeLessThan(1e-3);
    expect(ch.z).toBeLessThan(-40);
  });

  it('turns left for a left stick and right for a right stick', () => {
    const l = new Chassis();
    drive(2, rolling(15), l, () => -0.4);
    expect(l.yaw).toBeGreaterThan(0.3);
    const r = new Chassis();
    drive(2, rolling(15), r, () => 0.4);
    expect(r.yaw).toBeLessThan(-0.3);
  });

  it('never corners harder than the tyres allow', () => {
    const ch = new Chassis();
    const lat = drive(4, rolling(25, 4), ch, () => 1);
    expect(lat).toBeLessThan(1.1 * 9.81);
    expect(lat).toBeGreaterThan(0.6 * 9.81);
  });

  it('turns on the spot geometry at walking pace without blowing up', () => {
    const car = rolling(1, 1);
    const ch = new Chassis();
    drive(5, car, ch, () => -1, 0);
    expect(Number.isFinite(ch.yaw)).toBe(true);
    expect(Number.isFinite(ch.vy)).toBe(true);
    expect(Math.abs(ch.vy)).toBeLessThan(2);
  });

  it('scrubs speed in a hard corner', () => {
    const straight = rolling(25, 4);
    drive(3, straight, new Chassis(), () => 0, 0);
    const corner = rolling(25, 4);
    drive(3, corner, new Chassis(), () => 1, 0);
    expect(corner.speed).toBeLessThan(straight.speed);
  });

  it('pulling the handbrake mid-corner rotates the car more', () => {
    const plain = new Chassis();
    drive(1.2, rolling(15, 2), plain, () => -0.5, 0);
    const hb = new Chassis();
    const car = rolling(15, 2);
    drive(0.4, car, hb, () => -0.5, 0);
    drive(0.8, car, hb, () => -0.5, 0, true);
    expect(hb.yaw).toBeGreaterThan(plain.yaw);
  });
});
