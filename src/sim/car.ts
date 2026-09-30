// Longitudinal drivetrain simulation: engine -> clutch -> gearbox -> wheels -> car body.
// Runs at a fixed timestep (1 ms). All rotational speeds are rad/s, torques Nm.

export interface CarSpec {
  mass: number; // kg
  wheelRadius: number; // m
  wheelInertia: number; // kg m^2, all four wheels combined
  gears: Record<number, number>; // -1 = reverse, 1..n forward
  finalDrive: number;
  dragArea: number; // Cd * A
  rollingResistance: number; // Crr
  brakeForce: number; // N at full brake
  handbrakeForce: number; // N
  engineInertia: number;
  inputShaftInertia: number;
  torqueCurve: [number, number][]; // [rpm, Nm] at full throttle
  idleRpm: number;
  revLimit: number;
  stallRpm: number;
  clutchMaxTorque: number;
  biteStart: number; // engagement (0 = pedal down, 1 = released) where the clutch starts to grab
  biteEnd: number; // engagement where it reaches full clamp force
  starterTorque: number;
}

export const HATCHBACK: CarSpec = {
  mass: 1100,
  wheelRadius: 0.3,
  wheelInertia: 4,
  gears: { [-1]: -3.5, 1: 3.6, 2: 2.1, 3: 1.4, 4: 1.03, 5: 0.82 },
  finalDrive: 4.1,
  dragArea: 0.7,
  rollingResistance: 0.012,
  brakeForce: 9500,
  handbrakeForce: 5000,
  engineInertia: 0.16,
  inputShaftInertia: 0.02,
  torqueCurve: [
    [0, 0], [200, 25], [400, 55], [600, 72], [1000, 104], [2000, 126], [3000, 139],
    [4000, 146], [5000, 142], [6000, 132], [6800, 118], [7500, 90],
  ],
  idleRpm: 850,
  revLimit: 6800,
  stallRpm: 380,
  clutchMaxTorque: 260,
  biteStart: 0.32,
  biteEnd: 0.78,
  starterTorque: 48,
};

export const RPM = 60 / (2 * Math.PI); // rad/s -> rpm
const G = 9.81;
const AIR_DENSITY = 1.2;

export interface CarInputs {
  throttle: number; // 0..1
  brake: number; // 0..1
  clutch: number; // 0..1, 1 = pedal fully pressed (disengaged)
  handbrake: boolean;
  slope: number; // sin of road grade along the car's heading, positive = uphill
  extraForce?: number; // N along the heading from the chassis (cornering drag, etc.)
}

export type CarEvent =
  | { type: 'stall' }
  | { type: 'start' }
  | { type: 'grind' }
  | { type: 'shift'; gear: number }
  | { type: 'lock'; slip: number } // clutch locked up; slip in rad/s just before
  | { type: 'wall'; impact: number }; // hit the road edge; impact speed in m/s

export class Car {
  spec: CarSpec;
  gear = 0;
  engineOmega = 0;
  outputOmega = 0; // clutch output (gearbox input shaft) speed
  speed = 0; // m/s along heading
  running = false;
  locked = false;

  // Values exposed for feedback, audio and debugging.
  clutchCapacity = 0;
  clutchTorque = 0;
  combustionTorque = 0;
  load = 0; // 0..1 how hard the engine is working
  throttleEff = 0;
  accel = 0; // m/s^2, filtered
  driveForce = 0; // N pushed through the driven wheels (negative = engine braking)
  brakeForceNow = 0; // N of service brake currently applied
  cranking = false;

  private crankTime = 0;
  private startGrace = 0;
  private starterRequest = 0;
  private idleIntegral = 0.05;
  private fuelCut = false;
  private throttleLag = 0;
  private events: CarEvent[] = [];

  constructor(spec: CarSpec = HATCHBACK) {
    this.spec = spec;
  }

  get rpm() {
    return this.engineOmega * RPM;
  }

  get slipRpm() {
    return (this.engineOmega - this.outputOmega) * RPM;
  }

  /** Overall ratio between the clutch output shaft and the wheels (signed). */
  ratio(gear = this.gear) {
    return gear === 0 ? 0 : this.spec.gears[gear] * this.spec.finalDrive;
  }

  private outputInertia(gear = this.gear) {
    const s = this.spec;
    const r = this.ratio(gear);
    if (r === 0) return s.inputShaftInertia;
    return (s.mass * s.wheelRadius ** 2 + s.wheelInertia) / (r * r) + s.inputShaftInertia;
  }

  clutchCapacityFor(pedal: number) {
    const s = this.spec;
    const e = 1 - pedal;
    const x = Math.min(1, Math.max(0, (e - s.biteStart) / (s.biteEnd - s.biteStart)));
    return s.clutchMaxTorque * x * x;
  }

  /** Press the starter. It keeps cranking until the engine catches or gives up. */
  crank() {
    if (!this.running) this.starterRequest = 1.4;
  }

  stopEngine() {
    this.running = false;
  }

  /** Request a gear. Only works when the clutch is (almost) fully disengaged. */
  shiftTo(gear: number, clutchPedal: number) {
    if (!(gear in this.spec.gears) && gear !== 0) return false;
    if (gear === this.gear) return false;
    const cap = this.clutchCapacityFor(clutchPedal);
    const wrongWayReverse =
      (gear === -1 && this.speed > 1.0) || (gear > 0 && this.speed < -1.0);
    if (cap > 4 || wrongWayReverse) {
      this.events.push({ type: 'grind' });
      return false;
    }
    this.gear = gear;
    this.locked = false;
    // Synchros spin the input shaft up/down to match the wheels.
    const r = this.ratio();
    if (r !== 0) this.outputOmega = (this.speed / this.spec.wheelRadius) * r;
    this.events.push({ type: 'shift', gear });
    return true;
  }

  /** Force a new road speed (e.g. after hitting a wall), keeping the drivetrain consistent. */
  setSpeed(v: number) {
    this.speed = v;
    const r = this.ratio();
    if (r === 0) return;
    this.outputOmega = (v / this.spec.wheelRadius) * r;
    if (this.locked) this.engineOmega = Math.max(0, this.outputOmega);
  }

  pushEvent(e: CarEvent) {
    this.events.push(e);
  }

  reset() {
    this.gear = 0;
    this.engineOmega = 0;
    this.outputOmega = 0;
    this.speed = 0;
    this.accel = 0;
    this.running = false;
    this.locked = false;
    this.starterRequest = 0;
  }

  drainEvents() {
    const e = this.events;
    this.events = [];
    return e;
  }

  private curveTorque(rpm: number) {
    const c = this.spec.torqueCurve;
    if (rpm <= c[0][0]) return c[0][1];
    for (let i = 1; i < c.length; i++) {
      if (rpm <= c[i][0]) {
        const [r0, t0] = c[i - 1];
        const [r1, t1] = c[i];
        return t0 + ((t1 - t0) * (rpm - r0)) / (r1 - r0);
      }
    }
    return c[c.length - 1][1];
  }

  private frictionTorque(rpm: number) {
    return 8 + 0.0025 * rpm + 0.8e-6 * rpm * rpm;
  }

  step(dt: number, inp: CarInputs) {
    const s = this.spec;
    const rpm = this.rpm;

    // --- Engine torque -------------------------------------------------
    // Intake manifold lag makes blips feel physical instead of instant.
    this.throttleLag += (inp.throttle - this.throttleLag) * Math.min(1, dt / 0.045);

    let idle = 0;
    if (this.running) {
      const err = s.idleRpm - rpm;
      this.idleIntegral = Math.min(0.25, Math.max(0, this.idleIntegral + err * 0.00012 * dt));
      idle = Math.min(0.55, Math.max(0, err * 0.0015 + this.idleIntegral));
    }
    const throttle = Math.max(this.throttleLag, idle);
    if (rpm > s.revLimit) this.fuelCut = true;
    else if (rpm < s.revLimit - 250) this.fuelCut = false;

    this.throttleEff = this.running && !this.fuelCut ? throttle : 0;
    this.combustionTorque = this.curveTorque(rpm) * this.throttleEff;

    let starter = 0;
    this.cranking = false;
    if (this.starterRequest > 0 && !this.running) {
      this.starterRequest -= dt;
      this.cranking = true;
      starter = s.starterTorque * Math.max(0, 1 - rpm / 450);
      if (rpm > 200) this.crankTime += dt;
      if (this.crankTime > 0.35) {
        this.running = true;
        this.starterRequest = 0;
        this.idleIntegral = 0.12;
        this.startGrace = 0.6;
        this.events.push({ type: 'start' });
      }
    } else {
      this.crankTime = 0;
      this.starterRequest = 0;
    }

    const friction = this.engineOmega > 0.01 ? this.frictionTorque(rpm) : 0;
    const engineTorque = this.combustionTorque + starter - friction;
    this.load = this.running ? Math.min(1, this.combustionTorque / 146) : 0;

    // --- External forces on the car ------------------------------------
    const v = this.speed;
    const drive = -s.mass * G * inp.slope - 0.5 * AIR_DENSITY * s.dragArea * v * Math.abs(v) + (inp.extraForce ?? 0);
    this.brakeForceNow = inp.brake * s.brakeForce;
    const frictionForce =
      inp.brake * s.brakeForce +
      (inp.handbrake ? s.handbrakeForce : 0) +
      s.rollingResistance * s.mass * G;

    // --- Clutch + gearbox ----------------------------------------------
    const cap = this.clutchCapacityFor(inp.clutch);
    this.clutchCapacity = cap;
    const Je = s.engineInertia;
    const r = this.ratio();
    const Jo = this.outputInertia();
    // External torque reflected to the clutch output shaft.
    const Text = r === 0 ? -0.3 * Math.sign(this.outputOmega) : (drive * s.wheelRadius) / r;
    const Tfric = r === 0 ? 0 : (frictionForce * s.wheelRadius) / Math.abs(r);

    if (this.locked) {
      const J = Je + Jo;
      const alpha = (engineTorque + Text) / J;
      const needed = engineTorque - Je * alpha;
      if (Math.abs(needed) > cap) {
        this.locked = false;
      } else {
        this.clutchTorque = needed;
        let w = this.engineOmega + alpha * dt;
        w = applyFriction(w, Tfric / J, dt);
        if (w < 0) w = 0; // engine can't spin backwards: compression holds the car
        this.engineOmega = w;
        this.outputOmega = w;
      }
    }

    if (!this.locked) {
      const slip = this.engineOmega - this.outputOmega;
      const Tc = slip === 0 ? 0 : cap * Math.sign(slip);
      this.clutchTorque = Tc;
      this.engineOmega = Math.max(0, this.engineOmega + ((engineTorque - Tc) / Je) * dt);
      let wo = this.outputOmega + ((Tc + Text) / Jo) * dt;
      if (r !== 0) wo = applyFriction(wo, Tfric / Jo, dt);
      this.outputOmega = wo;

      const newSlip = this.engineOmega - this.outputOmega;
      if (cap > 0 && (Math.sign(newSlip) !== Math.sign(slip) || Math.abs(newSlip) < 0.3)) {
        // Speeds met: can the clutch hold them together?
        const J = Je + Jo;
        const alpha = (engineTorque + Text) / J;
        const needed = engineTorque - Je * alpha;
        if (Math.abs(needed) <= cap) {
          const w = (Je * this.engineOmega + Jo * this.outputOmega) / J;
          this.engineOmega = Math.max(0, w);
          this.outputOmega = this.engineOmega;
          this.locked = true;
          this.events.push({ type: 'lock', slip: Math.abs(slip) });
        }
      }
    }

    // --- Car body --------------------------------------------------------
    const prev = this.speed;
    if (r !== 0) {
      this.speed = (this.outputOmega / r) * s.wheelRadius;
    } else {
      let nv = v + (drive / s.mass) * dt;
      nv = applyFriction(nv, frictionForce / s.mass, dt);
      this.speed = nv;
    }
    this.driveForce = r === 0 ? 0 : (this.clutchTorque * r) / s.wheelRadius;
    const a = (this.speed - prev) / dt;
    this.accel += (a - this.accel) * Math.min(1, dt / 0.08);

    // --- Stall -------------------------------------------------------------
    this.startGrace = Math.max(0, this.startGrace - dt);
    if (this.running && this.rpm < (this.startGrace > 0 ? 150 : s.stallRpm)) {
      this.running = false;
      this.events.push({ type: 'stall' });
    }
  }
}

/** Apply a friction deceleration that can stop motion but never reverse it. */
function applyFriction(x: number, decel: number, dt: number) {
  const d = decel * dt;
  if (Math.abs(x) <= d) return 0;
  return x - Math.sign(x) * d;
}
