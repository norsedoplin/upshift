// The cars you can drive and the paints you can buy with creds.

import { HATCHBACK, type CarSpec } from './sim/car';
import { HATCHBACK_CHASSIS, type ChassisSpec } from './sim/chassis';

/** Which body the model builder draws; each has its own profile and details (see ui/carModel.ts). */
export type CarDesign = 'hatch' | 'ae86' | 's14' | 'fd';

export interface BodyShape {
  design: CarDesign;
  length: number;
  width: number;
  height: number; // lower body, from the underbody to the beltline
  cabinHeight: number;
  wheelRadius: number;
}

export type EngineSound = 4 | 6 | 'rotary';

/** What the driver sees from the seat. */
export interface InteriorSpec {
  seatDrop: number; // lower the whole cabin (and your eyes) relative to the hatch, m
  hoodLength: number;
  hoodBulge: boolean;
  trim: string; // dash and panels
  trimLight: string;
  accent: string; // stitching, stripes, trim inlays
  wheel: 'three' | 'dish' | 'four';
  cage: boolean;
  gaugePod: boolean; // extra gauges on the dash top
}

export interface CarModel {
  id: string;
  name: string;
  blurb: string;
  price: number; // creds; 0 = owned from the start
  spec: CarSpec;
  chassis: ChassisSpec;
  body: BodyShape;
  interior: InteriorSpec;
  defaultPaint: string;
  cylinders: EngineSound;
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
  { id: 'rosso', name: 'Rotary red', color: '#b5161c', price: 0 },
  { id: 'lime', name: 'Lime pearl', color: '#9fc23a', price: 300 },
  { id: 'bronze', name: 'Bronze', color: '#8a5a2b', price: 350 },
];

const HATCH: CarModel = {
  id: 'hatch',
  name: 'Hatch 1.6',
  blurb: 'Front-wheel drive and forgiving. The car you learned in.',
  price: 0,
  spec: HATCHBACK,
  chassis: HATCHBACK_CHASSIS,
  body: { design: 'hatch', length: 3.9, width: 1.7, height: 0.72, cabinHeight: 0.62, wheelRadius: 0.3 },
  interior: { seatDrop: 0, hoodLength: 1.3, hoodBulge: false, trim: '#2b2d33', trimLight: '#3a3d45', accent: '#5a5e68', wheel: 'three', cage: false, gaugePod: false },
  defaultPaint: 'coral',
  cylinders: 4,
  stats: { power: 0.45, weight: 0.55, grip: 0.55, drive: 'FWD' },
};

const KITSUNE: CarModel = {
  id: 'kitsune',
  name: 'Kitsune',
  blurb: 'The mountain-pass legend. Light rear-drive hatch, pop-up lights and a twin-cam four that sings to 7,600 rpm.',
  price: 1500,
  spec: {
    ...HATCHBACK,
    mass: 940,
    gears: { [-1]: -3.48, 1: 3.587, 2: 2.022, 3: 1.384, 4: 1.0, 5: 0.861 },
    finalDrive: 4.3,
    dragArea: 0.66,
    brakeForce: 8800,
    engineInertia: 0.13,
    torqueCurve: [
      [0, 0], [200, 22], [400, 50], [600, 66], [1000, 90], [2000, 110], [3000, 122],
      [4000, 134], [5000, 145], [5800, 149], [6600, 144], [7400, 130], [8200, 96],
    ],
    idleRpm: 900,
    revLimit: 7600,
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
  body: { design: 'ae86', length: 4.18, width: 1.63, height: 0.62, cabinHeight: 0.53, wheelRadius: 0.29 },
  interior: { seatDrop: 0.1, hoodLength: 1.75, hoodBulge: false, trim: '#222326', trimLight: '#303236', accent: '#c23b2e', wheel: 'dish', cage: true, gaugePod: false },
  defaultPaint: 'snow',
  cylinders: 4,
  stats: { power: 0.45, weight: 0.25, grip: 0.55, drive: 'RWD' },
};

const RONIN: CarModel = {
  id: 'ronin',
  name: 'Ronin',
  blurb: 'Turbo two-litre coupe, rear drive, five speeds. Waits for boost, then pulls hard. Built to slide.',
  price: 3000,
  spec: {
    ...HATCHBACK,
    mass: 1240,
    wheelRadius: 0.31,
    gears: { [-1]: -3.38, 1: 3.321, 2: 1.902, 3: 1.308, 4: 1.0, 5: 0.759 },
    finalDrive: 4.08,
    dragArea: 0.62,
    brakeForce: 12500,
    engineInertia: 0.17,
    torqueCurve: [
      [0, 0], [200, 26], [400, 60], [600, 82], [1000, 118], [2000, 165], [2800, 225],
      [3500, 268], [4000, 275], [5000, 268], [6000, 245], [7000, 205], [7800, 150],
    ],
    idleRpm: 800,
    revLimit: 7500,
    clutchMaxTorque: 420,
    biteStart: 0.3,
    biteEnd: 0.72,
    starterTorque: 70,
    turbo: { maxBoost: 0.9, lo: 0.62, hi: 1, spoolRpm: 3700, lag: 0.5 },
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
  body: { design: 's14', length: 4.52, width: 1.73, height: 0.64, cabinHeight: 0.49, wheelRadius: 0.31 },
  interior: { seatDrop: 0.06, hoodLength: 1.85, hoodBulge: false, trim: '#27292e', trimLight: '#3a3d44', accent: '#8a8f99', wheel: 'four', cage: false, gaugePod: true },
  defaultPaint: 'midnight',
  cylinders: 4,
  stats: { power: 0.72, weight: 0.6, grip: 0.72, drive: 'RWD' },
};

const RAIJIN: CarModel = {
  id: 'raijin',
  name: 'Raijin',
  blurb: 'Low, curvy and twin-turbo rotary. Revs to 8,000 with a brap all its own. Rewards a careful right foot.',
  price: 5500,
  spec: {
    ...HATCHBACK,
    mass: 1280,
    wheelRadius: 0.32,
    gears: { [-1]: -3.49, 1: 3.483, 2: 2.015, 3: 1.391, 4: 1.0, 5: 0.719 },
    finalDrive: 4.1,
    dragArea: 0.56,
    brakeForce: 13500,
    engineInertia: 0.12,
    torqueCurve: [
      [0, 0], [200, 24], [400, 55], [600, 78], [1000, 110], [2000, 170], [3000, 230],
      [4000, 280], [5000, 294], [6000, 290], [7000, 268], [7800, 230], [8600, 160],
    ],
    idleRpm: 850,
    revLimit: 8000,
    clutchMaxTorque: 460,
    biteStart: 0.32,
    biteEnd: 0.7,
    starterTorque: 60,
    // Sequential twins: the small one spools early, so less lag than the Ronin.
    turbo: { maxBoost: 0.8, lo: 0.66, hi: 1, spoolRpm: 3300, lag: 0.35 },
  },
  chassis: {
    ...HATCHBACK_CHASSIS,
    cgToFront: 1.2,
    cgToRear: 1.225,
    cgHeight: 0.44,
    yawInertia: 1750,
    mu: 1.08,
    frontBrakeBias: 0.63,
    rearGrip: 1.08,
    drivenAxle: 'rear',
  },
  body: { design: 'fd', length: 4.28, width: 1.76, height: 0.57, cabinHeight: 0.5, wheelRadius: 0.32 },
  interior: { seatDrop: 0.12, hoodLength: 1.8, hoodBulge: false, trim: '#1d1e21', trimLight: '#2c2d31', accent: '#b5161c', wheel: 'three', cage: false, gaugePod: false },
  defaultPaint: 'rosso',
  cylinders: 'rotary',
  stats: { power: 0.9, weight: 0.62, grip: 0.82, drive: 'RWD' },
};

export const CARS: CarModel[] = [HATCH, KITSUNE, RONIN, RAIJIN];

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
