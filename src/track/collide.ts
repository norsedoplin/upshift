// Keeps the car between the guardrails / rock faces at the road edges.

import type { Car } from '../sim/car';
import type { Chassis } from '../sim/chassis';
import type { Road, RoadLocation } from './touge';

export const CAR_HALF_WIDTH = 0.85;

/** Push the car back inside the road and bounce its velocity; returns the impact speed. */
export function collideWithEdges(road: Road, chassis: Chassis, car: Car, hint: number): { loc: RoadLocation; impact: number } {
  const loc = road.locate(chassis.x, chassis.z, hint);
  const limit = road.wallOffset - CAR_HALF_WIDTH;
  if (Math.abs(loc.offset) <= limit) return { loc, impact: 0 };
  const side = Math.sign(loc.offset);
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
