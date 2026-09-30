import { describe, expect, it } from 'vitest';
import { CARS, forwardGears } from '../cars';
import { Car } from '../sim/car';
import { Chassis } from '../sim/chassis';
import { collideWithEdges } from './collide';
import { generateTouge, SAMPLE_STEP } from './touge';

// A simple robot driver: pure-pursuit steering, speed picked from the curvature ahead,
// gear chosen by rpm with proper clutch use. If it can finish, a person can.
describe('touge is drivable', () => {
  const road = generateTouge();
  it.each(CARS.map((m) => [m.name, m] as const))('a robot driver gets the %s from start to finish', (_name, model) => {
    const car = new Car(model.spec);
    const ch = new Chassis(model.chassis);
    const topGear = forwardGears(model.spec).length;
    const start = road.sampleAt(road.startS - 18);
    ch.place(start.x, start.z, start.yaw);
    let idx = Math.round(start.s / SAMPLE_STEP);
    car.crank();
    const DT = 0.001;
    let t = 0;
    let clutch = 1;
    let shiftTimer = 0;
    let impacts = 0;
    let maxOffset = 0;

    for (let i = 0; i < 12 * 60 * 1000 && idx * SAMPLE_STEP < road.finishS; i++) {
      t += DT;
      const s = idx * SAMPLE_STEP;
      const v = car.speed;

      // Steering: aim at a point on the centreline ahead.
      const look = road.sampleAt(s + Math.max(6, Math.abs(v) * 0.6));
      const dx = look.x - ch.x;
      const dz = look.z - ch.z;
      const [fx, fz] = ch.forward();
      const [lx, lz] = ch.left();
      const along = dx * fx + dz * fz;
      const side = dx * lx + dz * lz;
      const kappa = (2 * side) / (along * along + side * side);
      const delta = Math.atan(kappa * ch.wheelbase);
      const maxD = ch.spec.maxSteer / (1 + Math.abs(v) / 10);
      const steer = Math.max(-1, Math.min(1, -delta / maxD));

      // Speed: slow for the tightest curvature in the next 40 m.
      let k = 0;
      for (let d = 0; d <= 40; d += 4) k = Math.max(k, Math.abs(road.sampleAt(s + d).kappa));
      const target = Math.min(22, Math.sqrt((0.55 * 9.81) / Math.max(k, 1e-3)));
      let throttle = Math.max(0, Math.min(1, (target - v) * 0.5));
      const brake = Math.max(0, Math.min(1, (v - target) * 0.4));
      if (brake > 0) throttle = 0;

      // Gears: 1st to pull away, then shift on rpm with the clutch.
      if (t > 1.5 && car.gear === 0) car.shiftTo(1, 1);
      if (shiftTimer > 0) {
        shiftTimer -= DT;
        clutch = shiftTimer > 0.25 ? 1 : Math.max(0, shiftTimer / 0.25);
        throttle = shiftTimer > 0.25 ? 0 : 0.2;
      } else if (car.gear >= 1 && v > 1) {
        const up = car.rpm > car.spec.revLimit - 2300 && car.gear < topGear;
        const down = car.rpm < 1600 && car.gear > 1;
        if (up || down) {
          clutch = 1;
          car.shiftTo(car.gear + (up ? 1 : -1), 1);
          shiftTimer = 0.5;
        } else clutch = 0;
      } else if (car.gear === 1) {
        clutch = Math.max(0, clutch - DT / 1.2);
        throttle = Math.max(throttle, 0.35);
      }

      if (!car.running) clutch = 1;
      car.step(DT, { throttle, brake, clutch, handbrake: false, slope: 0, extraForce: ch.extraForce });
      ch.step(DT, car, { steer, handbrake: false });
      const r = collideWithEdges(road, ch, car, idx);
      idx = r.loc.index;
      if (r.impact > 1) impacts++;
      maxOffset = Math.max(maxOffset, Math.abs(r.loc.offset));
      if (!car.running) car.crank();
    }

    expect(idx * SAMPLE_STEP).toBeGreaterThanOrEqual(road.finishS);
    expect(impacts).toBeLessThan(5);
    expect(maxOffset).toBeLessThanOrEqual(road.wallOffset);
  });
});
