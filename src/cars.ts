// The cars you can drive and the paints you can buy with creds.

import { HATCHBACK, type CarSpec } from './sim/car';
import { HATCHBACK_CHASSIS, type ChassisSpec } from './sim/chassis';

export interface BodyShape {
  length: number;
  width: number;
  height: number; // lower body
  cabinLength: number;
  cabinHeight: number;
  cabinOffset: number; // + towards the rear
  wheelRadius: number;
  style: 'hatch' | 'coupe' | 'sedan';
  spoiler?: 'roof' | 'ducktail' | 'wing';
  flares?: boolean;
  exhausts: 1 | 2;
}

export interface CarModel {
  id: string;
  name: string;
  blurb: string;
  price: number; // creds; 0 = owned from the start
  spec: CarSpec;
  chassis: ChassisSpec;
  body: BodyShape;
  defaultPaint: string;
  cylinders: 4 | 6;
  stats: { power: number; weight: number; grip: number; drive: 'FWD' | 'RWD' };
}

export interface Paint {
  id: string;
  name: string;
  color: string;
  price: number;
}

export const PAINTS: Paint[] = [
  { id: 'coral', name: 'Coral', color: '#e4573d', price: 0 },
  { id: 'snow', name: 'Snow', color: '#eceae4', price: 0 },
  { id: 'midnight', name: 'Midnight', color: '#23324d', price: 0 },
  { id: 'gunmetal', name: 'Gunmetal', color: '#55595f', price: 150 },
  { id: 'green', name: 'Racing green', color: '#1f5a3d', price: 200 },
  { id: 'sun', name: 'Sunburst', color: '#f2b233', price: 250 },
  { id: 'ice', name: 'Ice blue', color: '#8ec9e8', price: 300 },
  { id: 'black', name: 'Gloss black', color: '#15161a', price: 350 },
  { id: 'candy', name: 'Candy purple', color: '#6b2f8f', price: 400 },
];

const HATCH: CarModel = {
  id: 'hatch',
  name: 'Hatch 1.6',
  blurb: 'Front-wheel drive and forgiving. The car you learned in.',
  price: 0,
  spec: HATCHBACK,
  chassis: HATCHBACK_CHASSIS,
  body: { length: 3.9, width: 1.7, height: 0.72, cabinLength: 2.1, cabinHeight: 0.62, cabinOffset: 0.45, wheelRadius: 0.3, style: 'hatch', spoiler: 'roof', exhausts: 1 },
  defaultPaint: 'coral',
  cylinders: 4,
  stats: { power: 0.45, weight: 0.55, grip: 0.55, drive: 'FWD' },
};

const KITSUNE: CarModel = {
  id: 'kitsune',
  name: 'Kitsune',
  blurb: 'Light rear-drive coupe with a screaming 8,000 rpm four. Heel-toe heaven.',
  price: 1500,
  spec: {
    ...HATCHBACK,
    mass: 950,
    gears: { [-1]: -3.48, 1: 3.587, 2: 2.022, 3: 1.384, 4: 1.0, 5: 0.861 },
    finalDrive: 4.3,
    dragArea: 0.66,
    brakeForce: 8800,
    engineInertia: 0.13,
    torqueCurve: [
      [0, 0], [200, 22], [400, 50], [600, 66], [1000, 92], [2000, 112], [3000, 124],
      [4000, 134], [5000, 144], [6000, 150], [6800, 148], [7600, 136], [8400, 100],
    ],
    idleRpm: 900,
    revLimit: 7800,
    clutchMaxTorque: 250,
    biteStart: 0.36,
    biteEnd: 0.74,
  },
  chassis: {
    ...HATCHBACK_CHASSIS,
    cgToFront: 1.15,
    cgToRear: 1.25,
    cgHeight: 0.45,
    yawInertia: 1300,
    frontBrakeBias: 0.66,
    rearGrip: 1.06,
    drivenAxle: 'rear',
  },
  body: { length: 4.2, width: 1.63, height: 0.66, cabinLength: 1.9, cabinHeight: 0.56, cabinOffset: 0.2, wheelRadius: 0.29, style: 'coupe', spoiler: 'ducktail', exhausts: 1 },
  defaultPaint: 'snow',
  cylinders: 4,
  stats: { power: 0.55, weight: 0.3, grip: 0.6, drive: 'RWD' },
};

const RONIN: CarModel = {
  id: 'ronin',
  name: 'Ronin',
  blurb: 'Turbo straight-six, six speeds, rear drive. Big torque, needs respect.',
  price: 4000,
  spec: {
    ...HATCHBACK,
    mass: 1260,
    wheelRadius: 0.32,
    gears: { [-1]: -3.4, 1: 3.63, 2: 2.19, 3: 1.54, 4: 1.21, 5: 1.0, 6: 0.79 },
    finalDrive: 3.7,
    dragArea: 0.62,
    brakeForce: 12500,
    engineInertia: 0.2,
    torqueCurve: [
      [0, 0], [200, 30], [400, 70], [600, 95], [1000, 140], [2000, 210], [2800, 290],
      [3500, 310], [4500, 305], [5500, 285], [6500, 250], [7200, 200], [7800, 150],
    ],
    idleRpm: 800,
    revLimit: 7000,
    clutchMaxTorque: 480,
    biteStart: 0.3,
    biteEnd: 0.72,
    starterTorque: 70,
  },
  chassis: {
    ...HATCHBACK_CHASSIS,
    cgToFront: 1.28,
    cgToRear: 1.3,
    cgHeight: 0.48,
    yawInertia: 2000,
    mu: 1.05,
    frontBrakeBias: 0.64,
    rearGrip: 1.08,
    drivenAxle: 'rear',
  },
  body: { length: 4.5, width: 1.8, height: 0.68, cabinLength: 2.0, cabinHeight: 0.58, cabinOffset: 0.3, wheelRadius: 0.33, style: 'sedan', spoiler: 'wing', flares: true, exhausts: 2 },
  defaultPaint: 'midnight',
  cylinders: 6,
  stats: { power: 0.9, weight: 0.7, grip: 0.75, drive: 'RWD' },
};

export const CARS: CarModel[] = [HATCH, KITSUNE, RONIN];

export function carById(id: string) {
  return CARS.find((c) => c.id === id) ?? HATCH;
}

export function paintById(id: string) {
  return PAINTS.find((p) => p.id === id) ?? PAINTS[0];
}

/** Forward gears available on a car, e.g. [1, 2, 3, 4, 5]. */
export function forwardGears(spec: CarSpec) {
  return Object.keys(spec.gears)
    .map(Number)
    .filter((g) => g > 0)
    .sort((a, b) => a - b);
}
