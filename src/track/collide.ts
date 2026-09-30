// Keeps the car between the guardrails / rock faces at the road edges.

import type { Car } from '../sim/car';
import type { Chassis } from '../sim/chassis';
import type { Road, RoadLocation } from './touge';
import type { City } from './city';

export const CAR_HALF_WIDTH = 0.85;

/** Push the car back inside the road and bounce its velocity; returns the impact speed. */
export function collideWithEdges(road: Road, chassis: Chassis, car: Car, hint: number): { loc: RoadLocation; impact: number } {
  const loc = road.locate(chassis.x, chassis.z, hint);
  const side = Math.sign(loc.offset) || 1;
  // Lots widen the road on one side.
  const limit = road.wallOffset + road.lotDepth(loc.s, side) - CAR_HALF_WIDTH;
  if (Math.abs(loc.offset) <= limit) return { loc, impact: road.obstacles.length ? collideWithObstacles(road, chassis, car) : 0 };
  const nx = -Math.cos(loc.sample.yaw) * side; // outward normal: the left vector times the side
  const nz = Math.sin(loc.sample.yaw) * side;
  const push = Math.abs(loc.offset) - limit;
  chassis.x -= nx * push;
  chassis.z -= nz * push;
  let [vx, vz] = chassis.velocity(car.speed);
  const vn = vx * nx + vz * nz;
  if (vn <= 0) return { loc, impact: 0 };
  // Bounce a little off the rail and lose some speed scraping along it.
  vx -= 1.15 * vn * nx;
  vz -= 1.15 * vn * nz;
  const scrape = 1 - Math.min(0.5, vn * 0.06);
  vx *= scrape;
  vz *= scrape;
  car.setSpeed(chassis.setVelocity(vx, vz));
  chassis.yawRate *= 0.6;
  return { loc, impact: vn };
}

/** The car as two circles (front and back axle) against the parked cars and machines in the lots. */
function collideWithObstacles(road: Road, chassis: Chassis, car: Car) {
  let impact = 0;
  const [fx, fz] = chassis.forward();
  for (const o of road.obstacles) {
    if (Math.abs(o.x - chassis.x) > 6 || Math.abs(o.z - chassis.z) > 6) continue;
    for (const d of [-1.2, 1.2]) {
      const cx = chassis.x + fx * d;
      const cz = chassis.z + fz * d;
      const dx = cx - o.x;
      const dz = cz - o.z;
      const dist = Math.hypot(dx, dz);
      const min = o.r + CAR_HALF_WIDTH;
      if (dist >= min || dist < 1e-6) continue;
      const nx = dx / dist; // pointing away from the obstacle
      const nz = dz / dist;
      chassis.x += nx * (min - dist);
      chassis.z += nz * (min - dist);
      let [vx, vz] = chassis.velocity(car.speed);
      const vn = -(vx * nx + vz * nz);
      if (vn <= 0) continue;
      vx += 1.3 * vn * nx;
      vz += 1.3 * vn * nz;
      car.setSpeed(chassis.setVelocity(vx * 0.8, vz * 0.8));
      chassis.yawRate *= 0.5;
      impact = Math.max(impact, vn);
    }
  }
  return impact;
}

/**
 * The car as two circles (front and back axle) against the town: buildings, parked cars and
 * kerbs are rectangles, poles and trees are circles, and the wall round the edge keeps you in.
 * Returns the impact speed and how close the car came to hitting something (the gap, m).
 */
export function collideWithCity(city: City, chassis: Chassis, car: Car): { impact: number; gap: number } {
  let impact = 0;
  let gap = Infinity;
  const r = CAR_HALF_WIDTH;
  const B = city.bounds;
  const bounce = (nx: number, nz: number, pen: number) => {
    chassis.x += nx * pen;
    chassis.z += nz * pen;
    let [vx, vz] = chassis.velocity(car.speed);
    const vn = -(vx * nx + vz * nz); // speed into the surface
    if (vn <= 0) return;
    vx += 1.2 * vn * nx;
    vz += 1.2 * vn * nz;
    const scrape = 1 - Math.min(0.5, vn * 0.06);
    car.setSpeed(chassis.setVelocity(vx * scrape, vz * scrape));
    chassis.yawRate *= 0.6;
    impact = Math.max(impact, vn);
  };
  const [fx, fz] = chassis.forward();
  const { solids, obstacles } = city.near(chassis.x, chassis.z);
  for (const dd of [-1.2, 1.2]) {
    const cx = () => chassis.x + fx * dd;
    const cz = () => chassis.z + fz * dd;
    // The wall round the town.
    if (cx() < B.x0 - 1 + r) bounce(1, 0, B.x0 - 1 + r - cx());
    if (cx() > B.x1 + 1 - r) bounce(-1, 0, cx() - (B.x1 + 1 - r));
    if (cz() < B.z0 - 1 + r) bounce(0, 1, B.z0 - 1 + r - cz());
    if (cz() > B.z1 + 1 - r) bounce(0, -1, cz() - (B.z1 + 1 - r));
    for (const s of solids) {
      const x = cx();
      const z = cz();
      const px = Math.max(s.x0, Math.min(x, s.x1));
      const pz = Math.max(s.z0, Math.min(z, s.z1));
      let dx = x - px;
      let dz = z - pz;
      let dist = Math.hypot(dx, dz);
      if (dist - r < gap) gap = dist - r;
      if (dist >= r) continue;
      if (dist < 1e-6) {
        // Inside the rectangle: out through the nearest side.
        const o = [x - s.x0, s.x1 - x, z - s.z0, s.z1 - z];
        const m = o.indexOf(Math.min(...o));
        dx = [-1, 1, 0, 0][m];
        dz = [0, 0, -1, 1][m];
        dist = -o[m];
      } else {
        dx /= dist;
        dz /= dist;
      }
      bounce(dx, dz, r - dist);
    }
    for (const o of obstacles) {
      const x = cx();
      const z = cz();
      const dx = x - o.x;
      const dz = z - o.z;
      const dist = Math.hypot(dx, dz);
      const min = o.r + r;
      if (dist - min < gap) gap = dist - min;
      if (dist >= min || dist < 1e-6) continue;
      bounce(dx / dist, dz / dist, min - dist);
    }
  }
  return { impact, gap };
}
