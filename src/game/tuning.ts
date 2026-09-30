// Tuning parts: bought per car with creds, then fitted or taken off in the garage.
// Pure functions over a car's spec so they can be tested.

import type { CarModel } from '../cars';
import type { CarSpec, TurboSpec } from '../sim/car';
import type { Progress } from './progress';

export type PartId = 'turbo' | 'ecu' | 'exhaust' | 'clutch' | 'weight';

export interface Part {
  id: PartId;
  name: string;
  /** Level names; level 0 is stock and free. */
  levels: string[];
  prices: number[]; // per level, [0] is always 0
  blurb: string;
}

export const PARTS: Part[] = [
  {
    id: 'turbo',
    name: 'Turbo',
    levels: ['Stock', 'Street turbo', 'Big single'],
    prices: [0, 1800, 4200],
    blurb: 'More boost, more lag. The big single does nothing low down, then hits like a truck.',
  },
  { id: 'ecu', name: 'ECU tune', levels: ['Stock', 'Stage 1', 'Stage 2'], prices: [0, 600, 1500], blurb: 'Sharper fuel and timing, and a higher rev limit.' },
  { id: 'exhaust', name: 'Exhaust', levels: ['Stock', 'Sport', 'Straight pipe'], prices: [0, 400, 1000], blurb: 'Freer flow for a little power and a lot more noise.' },
  {
    id: 'clutch',
    name: 'Clutch',
    levels: ['Stock', 'Stage 1', 'Stage 2 puck'],
    prices: [0, 700, 1600],
    blurb: 'Holds more torque, with a shorter, grabbier bite. Big power needs one or the clutch slips.',
  },
  { id: 'weight', name: 'Weight', levels: ['Stock', 'Stripped', 'Race shell'], prices: [0, 800, 1900], blurb: 'Out go the rear seats, sound deadening and spare wheel.' },
];

export type Tune = Partial<Record<PartId, number>>;

const key = (carId: string, part: PartId) => `${carId}:${part}`;

/** Highest level of a part bought for a car (buying a level includes the ones below it). */
export function ownedLevel(p: Progress, carId: string, part: PartId) {
  return p.partsOwned[key(carId, part)] ?? 0;
}

/** The levels fitted to a car right now. */
export function tuneFor(p: Progress, carId: string): Tune {
  const t: Tune = {};
  for (const part of PARTS) {
    const lvl = Math.min(p.partsFitted[key(carId, part.id)] ?? 0, ownedLevel(p, carId, part.id));
    if (lvl) t[part.id] = lvl;
  }
  return t;
}

export type TuneResult = 'bought' | 'fitted' | 'too-poor';

/** Fit a part level to a car, buying it first if needed and affordable. */
export function fitPart(p: Progress, carId: string, part: PartId, level: number): TuneResult {
  const info = PARTS.find((x) => x.id === part)!;
  const k = key(carId, part);
  if (level > ownedLevel(p, carId, part)) {
    const price = info.prices[level];
    if (p.creds < price) return 'too-poor';
    p.creds -= price;
    p.partsOwned[k] = level;
    p.partsFitted[k] = level;
    return 'bought';
  }
  p.partsFitted[k] = level;
  return 'fitted';
}

/** Turbo for each turbo level, on a car that did or didn't come with one. */
function turboFor(stock: TurboSpec | undefined, level: number): TurboSpec | undefined {
  if (level === 0) return stock;
  if (stock) {
    return level === 1
      ? { ...stock, maxBoost: stock.maxBoost + 0.35, lo: stock.lo * 0.97, hi: 1.28, spoolRpm: stock.spoolRpm + 300, lag: stock.lag * 1.2 }
      : { ...stock, maxBoost: stock.maxBoost + 0.9, lo: stock.lo * 0.9, hi: 1.7, spoolRpm: stock.spoolRpm + 1000, lag: stock.lag * 1.9 };
  }
  // A bolt-on kit for a car that never had one: the engine loses a little compression.
  return level === 1
    ? { maxBoost: 0.7, lo: 0.95, hi: 1.5, spoolRpm: 3800, lag: 0.55 }
    : { maxBoost: 1.3, lo: 0.9, hi: 2.05, spoolRpm: 4700, lag: 0.95 };
}

/** The car's spec with its fitted parts. */
export function tunedSpec(spec: CarSpec, t: Tune): CarSpec {
  const ecu = t.ecu ?? 0;
  const ex = t.exhaust ?? 0;
  const cl = t.clutch ?? 0;
  const wt = t.weight ?? 0;
  const torqueK = [1, 1.05, 1.1][ecu] * [1, 1.03, 1.06][ex];
  const bite = spec.biteEnd - spec.biteStart;
  const mid = (spec.biteEnd + spec.biteStart) / 2;
  const biteK = [1, 0.8, 0.58][cl];
  return {
    ...spec,
    torqueCurve: spec.torqueCurve.map(([r, tq]) => [r, tq * torqueK] as [number, number]),
    revLimit: spec.revLimit + [0, 300, 550][ecu],
    mass: spec.mass * [1, 0.95, 0.9][wt],
    clutchMaxTorque: spec.clutchMaxTorque * [1, 1.4, 1.9][cl],
    biteStart: mid - (bite * biteK) / 2,
    biteEnd: mid + (bite * biteK) / 2,
    turbo: turboFor(spec.turbo, t.turbo ?? 0),
  };
}

/** Peak engine torque with full boost, Nm. */
export function peakTorque(spec: CarSpec) {
  return Math.max(...spec.torqueCurve.map(([, t]) => t)) * (spec.turbo?.hi ?? 1);
}

/** Peak power with full boost, hp. */
export function peakPower(spec: CarSpec) {
  let best = 0;
  for (const [rpm, tq] of spec.torqueCurve) if (rpm <= spec.revLimit) best = Math.max(best, (tq * (spec.turbo?.hi ?? 1) * rpm) / 7121);
  return Math.round(best);
}

/** True when the engine can make more torque than the clutch can hold. */
export function clutchWillSlip(spec: CarSpec) {
  return peakTorque(spec) > spec.clutchMaxTorque * 0.95;
}

export function specFor(p: Progress, model: CarModel) {
  return tunedSpec(model.spec, tuneFor(p, model.id));
}
