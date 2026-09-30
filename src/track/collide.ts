// Keeps the car between the guardrails / rock faces at the road edges.

import type { Car } from '../sim/car';
import type { Chassis } from '../sim/chassis';
import type { Road, RoadLocation } from './touge';

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
