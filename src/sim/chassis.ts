// Planar chassis dynamics: a bicycle model with Pacejka-style tyres, weight transfer
// and a friction circle. The drivetrain (Car) owns the longitudinal speed; this owns
// sideways velocity, yaw and position, and feeds cornering forces back to the drivetrain.
//
// Body frame: x forward, y left. Yaw is counter-clockwise seen from above, matching
// Three.js rotation.y, so at yaw 0 the car drives along -z.

import type { Car } from './car';

export interface ChassisSpec {
  cgToFront: number; // m
  cgToRear: number; // m
  cgHeight: number; // m
  yawInertia: number; // kg m^2
  maxSteer: number; // rad at the road wheels
  frontBrakeBias: number;
  mu: number; // tyre-road friction
  tyreB: number; // Pacejka stiffness, front
  tyreBRear: number;
  rearGrip: number; // rear grip multiplier; >1 keeps the car stable (mild understeer)
  tyreC: number; // Pacejka shape
  drivenAxle: 'front' | 'rear';
}

export const HATCHBACK_CHASSIS: ChassisSpec = {
  cgToFront: 0.98,
  cgToRear: 1.47,
  cgHeight: 0.46,
  yawInertia: 1600,
  maxSteer: 0.6,
  frontBrakeBias: 0.7,
  mu: 1.0,
  tyreB: 8,
  tyreBRear: 9,
  rearGrip: 1.12,
  tyreC: 1.6,
  drivenAxle: 'front',
};

const G = 9.81;

export interface ChassisInputs {
  steer: number; // -1 (left) .. 1 (right), as read from the stick
  handbrake: boolean;
}

export class Chassis {
  spec: ChassisSpec;
  x = 0;
  z = 0;
  yaw = 0;
  vy = 0; // sideways velocity, m/s (left positive)
  yawRate = 0; // rad/s
  steerAngle = 0; // rad at the road wheels, left positive
  slipFront = 0; // slip angles, rad (for audio / feedback)
  slipRear = 0;
  latAccel = 0; // m/s^2, filtered
  /** Longitudinal force to hand back to the drivetrain on its next step. */
  extraForce = 0;

  constructor(spec: ChassisSpec = HATCHBACK_CHASSIS) {
    this.spec = spec;
  }

  get wheelbase() {
    return this.spec.cgToFront + this.spec.cgToRear;
  }

  forward(): [number, number] {
    return [-Math.sin(this.yaw), -Math.cos(this.yaw)];
  }

  left(): [number, number] {
    return [-Math.cos(this.yaw), Math.sin(this.yaw)];
  }

  /** World-space velocity. */
  velocity(vx: number): [number, number] {
    const [fx, fz] = this.forward();
    const [lx, lz] = this.left();
    return [fx * vx + lx * this.vy, fz * vx + lz * this.vy];
  }

  /** Set the world-space velocity; returns the new forward speed for the drivetrain. */
  setVelocity(wx: number, wz: number) {
    const [fx, fz] = this.forward();
    const [lx, lz] = this.left();
    this.vy = wx * lx + wz * lz;
    return wx * fx + wz * fz;
  }

  place(x: number, z: number, yaw: number) {
    this.x = x;
    this.z = z;
    this.yaw = yaw;
    this.vy = 0;
    this.yawRate = 0;
    this.steerAngle = 0;
    this.extraForce = 0;
  }

  step(dt: number, car: Car, inp: ChassisInputs) {
    const s = this.spec;
    const m = car.spec.mass;
    const a = s.cgToFront;
    const b = s.cgToRear;
    const L = a + b;
    const vx = car.speed;
    const speed = Math.hypot(vx, this.vy);

    // Speed-sensitive steering so a thumbstick stays controllable at speed.
    const target = -inp.steer * s.maxSteer / (1 + Math.abs(vx) / 10);
    this.steerAngle += (target - this.steerAngle) * Math.min(1, dt / 0.06);
    const d = this.steerAngle;

    // Axle loads with longitudinal weight transfer.
    // car.accel is d(vx)/dt in the rotating body frame; remove the kinematic vy*r term
    // to get the real acceleration of the body that loads the tyres.
    const ax = car.accel - this.vy * this.yawRate;
    const transfer = (m * ax * s.cgHeight) / L;
    const fzF = Math.max(0, (m * G * b) / L - transfer);
    const fzR = Math.max(0, (m * G * a) / L + transfer);

    // Longitudinal demand on each axle eats into the grip left for cornering.
    const brake = car.brakeForceNow;
    let fxF = brake * s.frontBrakeBias;
    let fxR = brake * (1 - s.frontBrakeBias);
    if (s.drivenAxle === 'front') fxF += Math.abs(car.driveForce);
    else fxR += Math.abs(car.driveForce);
    const handbrakeSliding = inp.handbrake && Math.abs(vx) > 1;
    const muR = handbrakeSliding ? s.mu * 0.45 : s.mu * s.rearGrip;
    // Brake assists: ABS keeps the fronts steering, EBD stops the rears locking.
    fxF = Math.min(fxF, 0.9 * s.mu * fzF);
    fxR = Math.min(fxR, 0.5 * muR * fzR);
    const latMaxF = Math.sqrt(Math.max(0, (s.mu * fzF) ** 2 - fxF * fxF));
    const latMaxR = handbrakeSliding ? muR * fzR * 0.8 : Math.sqrt(Math.max(0, (muR * fzR) ** 2 - fxR * fxR));

    // Slip angles in each wheel's own frame (works in reverse too).
    const vyF = this.vy + a * this.yawRate;
    const vyR = this.vy - b * this.yawRate;
    const cosD = Math.cos(d);
    const sinD = Math.sin(d);
    const latF = -vx * sinD + vyF * cosD;
    const lonF = vx * cosD + vyF * sinD;
    const alphaF = Math.atan2(latF, Math.max(Math.abs(lonF), 0.5));
    const alphaR = Math.atan2(vyR, Math.max(Math.abs(vx), 0.5));
    this.slipFront = alphaF;
    this.slipRear = alphaR;

    const tyre = (alpha: number, B: number) => Math.sin(s.tyreC * Math.atan(B * alpha));
    const fyFw = -latMaxF * tyre(alphaF, s.tyreB); // in the wheel frame
    const fyR = -latMaxR * tyre(alphaR, s.tyreBRear);
    const fyF = fyFw * cosD;

    // Integrate.
    const ay = (fyF + fyR) / m - vx * this.yawRate;
    this.vy += ay * dt;
    this.yawRate += ((a * fyF - b * fyR) / s.yawInertia) * dt;

    // At walking pace tyre models misbehave; blend towards pure rolling geometry.
    const w = Math.min(1, Math.max(0, (Math.abs(vx) - 1) / 3));
    if (w < 1) {
      const rKin = (vx * Math.tan(d)) / L;
      this.yawRate = w * this.yawRate + (1 - w) * rKin;
      this.vy = w * this.vy + (1 - w) * rKin * b;
    }
    if (speed < 0.05 && Math.abs(vx) < 0.05) {
      this.vy = 0;
      this.yawRate = 0;
    }

    // Cornering drag from the steered wheels plus the rotating-frame term.
    this.extraForce = -fyFw * sinD + m * this.vy * this.yawRate;
    this.latAccel += ((fyF + fyR) / m - this.latAccel) * Math.min(1, dt / 0.1);

    this.yaw += this.yawRate * dt;
    const [wx, wz] = this.velocity(vx);
    this.x += wx * dt;
    this.z += wz * dt;
  }
}
