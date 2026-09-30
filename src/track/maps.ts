// The roads you can pick from. Each one is the same touge generator with different settings,
// so they all share the game's look but drive very differently.

import { generateTouge, type Road, type TougeOptions } from './touge';

export interface MapInfo {
  id: string;
  name: string;
  /** One line on how it drives. */
  blurb: string;
  options: TougeOptions;
}

export const MAPS: MapInfo[] = [
  { id: 'koyo', name: 'Koyo Pass', blurb: 'The classic descent: hairpins, sweepers and a lot or two to rest in.', options: { seed: 7, length: 4200 } },
  { id: 'mizuhara', name: 'Mizuhara Hillclimb', blurb: 'Uphill all the way. Carry revs out of the hairpins or bog down.', options: { seed: 21, length: 3600, direction: 'up', twist: 0.1, grade: 0.055 } },
  { id: 'kurogane', name: 'Kurogane Switchbacks', blurb: 'Short, steep and tight. Heel-toe heaven, one hairpin after another.', options: { seed: 42, length: 2600, twist: 0.6, grade: 0.06 } },
  { id: 'shiroyama', name: 'Shiroyama Ridge', blurb: 'A long, fast run of sweepers. Fourth and fifth gear country.', options: { seed: 99, length: 6500, twist: -0.5, grade: 0.035 } },
];

export function mapById(id: string) {
  return MAPS.find((m) => m.id === id) ?? MAPS[0];
}

const cache = new Map<string, Road>();

/** The road for a map, generated once and kept. */
export function roadFor(id: string) {
  const m = mapById(id);
  let road = cache.get(m.id);
  if (!road) cache.set(m.id, (road = generateTouge(m.options)));
  return road;
}

/** Length, climb or drop, and hairpin count, for the map picker. */
export function mapStats(road: Road) {
  const first = road.sampleAt(road.startS);
  const last = road.sampleAt(road.finishS);
  let hairpins = 0;
  let inPin = false;
  for (const p of road.samples) {
    const tight = Math.abs(p.kappa) > 1 / 22;
    if (tight && !inPin) hairpins++;
    inPin = tight;
  }
  return { km: (road.finishS - road.startS) / 1000, rise: last.h - first.h, hairpins };
}

/** A top-down outline of the road as an SVG path, fitted into a `size` square. */
export function outlinePath(road: Road, size: number, pad = 6) {
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const p of road.samples) {
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    minZ = Math.min(minZ, p.z);
    maxZ = Math.max(maxZ, p.z);
  }
  const k = (size - 2 * pad) / Math.max(maxX - minX, maxZ - minZ);
  const ox = pad + (size - 2 * pad - (maxX - minX) * k) / 2;
  const oz = pad + (size - 2 * pad - (maxZ - minZ) * k) / 2;
  const pt = (x: number, z: number) => `${(ox + (x - minX) * k).toFixed(1)} ${(oz + (z - minZ) * k).toFixed(1)}`;
  let d = '';
  for (let i = 0; i < road.samples.length; i += 4) d += (i ? ' L' : 'M') + pt(road.samples[i].x, road.samples[i].z);
  const s = road.samples[0];
  const e = road.samples[road.samples.length - 1];
  return { d, start: pt(s.x, s.z).split(' ').map(Number), end: pt(e.x, e.z).split(' ').map(Number) };
}
