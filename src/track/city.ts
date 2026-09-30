// A procedural Japanese town for free roam: a grid of avenues, side streets and narrow
// lanes, with houses, shops, apartments and offices packed tight along them, corner
// stores, gas stations, coin parking and a shrine park. Pure data, no rendering, so it can
// be tested; cityScene.ts builds the meshes.

import type { Obstacle } from './touge';

export interface Rect {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
}

export type StreetKind = 'avenue' | 'street' | 'lane';

export interface Street {
  rect: Rect;
  kind: StreetKind;
  /** 'z' runs north-south (long in z), 'x' runs east-west. */
  axis: 'x' | 'z';
}

/** 0 = faces north (-z), 1 = east (+x), 2 = south (+z), 3 = west (-x). */
export type Facing = 0 | 1 | 2 | 3;

export type BuildingKind = 'house' | 'apartment' | 'shop' | 'konbini' | 'office' | 'tower' | 'kiosk' | 'shrine' | 'wall';

export interface Building {
  rect: Rect;
  kind: BuildingKind;
  floors: number;
  height: number; // to the top of the walls, m
  face: Facing;
  seed: number; // 0..1, for colours and details
}

export type PropKind = 'pole' | 'lamp' | 'signal' | 'tree' | 'sakura' | 'vending' | 'pump' | 'bench' | 'car' | 'torii' | 'lantern' | 'meter';

export interface Prop {
  kind: PropKind;
  x: number;
  z: number;
  yaw: number; // same convention as the chassis: 0 faces -z
  variant: number;
}

export type PadKind = 'gas' | 'parking' | 'park' | 'forecourt';

/** Open ground that isn't road: gas station aprons, coin parking, the park. */
export interface Pad {
  rect: Rect;
  kind: PadKind;
  face: Facing; // which street it opens onto
}

/** A painted marking: crossings, stop lines and "tomare" (stop) text. */
export interface Marking {
  kind: 'zebra' | 'stop' | 'tomare';
  x: number;
  z: number;
  w: number; // across the road
  d: number; // along the road
  axis: 'x' | 'z'; // the axis of the road it's painted on
  flip: boolean; // for text: which way it reads
}

export interface CityOptions {
  seed: number;
  blocks: number; // per side
}

export const FLOOR = 3.1; // storey height, m

const WIDTH: Record<StreetKind, number> = { avenue: 12, street: 7, lane: 4.6 };
const SIDEWALK: Record<StreetKind, number> = { avenue: 3, street: 1.6, lane: 0 };

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const w = (r: Rect) => r.x1 - r.x0;
const d = (r: Rect) => r.z1 - r.z0;
const rect = (x0: number, z0: number, x1: number, z1: number): Rect => ({ x0, z0, x1, z1 });

export class City {
  bounds: Rect;
  streets: Street[] = [];
  blocks: Rect[] = [];
  /** Block edges that are sidewalk, for drawing: the block minus its inner lot area. */
  inners: Rect[] = [];
  buildings: Building[] = [];
  props: Prop[] = [];
  pads: Pad[] = [];
  markings: Marking[] = [];
  /** Wires strung between neighbouring utility poles: [x, z] pairs. */
  wires: [number, number, number, number][] = [];
  /** Signal-controlled junctions. */
  signals: { x: number; z: number }[] = [];
  /** Each street between two junctions, for its lane markings. */
  stretches: { axis: 'x' | 'z'; at: number; kind: StreetKind; s0: number; s1: number }[] = [];
  solids: Rect[] = [];
  obstacles: Obstacle[] = [];
  spawn = { x: 0, z: 0, yaw: 0 };
  /** Lines of the street grid, for the minimap. */
  xLines: { at: number; kind: StreetKind }[] = [];
  zLines: { at: number; kind: StreetKind }[] = [];
  private cell = 16;
  private solidGrid = new Map<number, number[]>();
  private obstacleGrid = new Map<number, number[]>();

  constructor(opts: CityOptions) {
    const rand = rng(opts.seed);
    const n = opts.blocks;
    // Street lines across x (running along z) and across z, with blocks between.
    const lineKinds = (): StreetKind[] => {
      const out: StreetKind[] = [];
      for (let i = 0; i <= n; i++) {
        if (i === 0 || i === n || i === Math.round(n / 3) || i === Math.round((2 * n) / 3)) out.push('avenue');
        else out.push(rand() < 0.22 ? 'lane' : 'street');
      }
      return out;
    };
    const lay = (kinds: StreetKind[]) => {
      const lines: { at: number; kind: StreetKind; a: number; b: number }[] = [];
      let p = 0;
      kinds.forEach((kind, i) => {
        const half = WIDTH[kind] / 2;
        if (i > 0) p += 34 + rand() * 26 + half; // block
        lines.push({ at: p, kind, a: p - half, b: p + half });
        p += half;
      });
      const mid = p / 2;
      for (const l of lines) {
        l.at -= mid;
        l.a -= mid;
        l.b -= mid;
      }
      return lines;
    };
    const xs = lay(lineKinds());
    const zs = lay(lineKinds());
    this.xLines = xs.map((l) => ({ at: l.at, kind: l.kind }));
    this.zLines = zs.map((l) => ({ at: l.at, kind: l.kind }));
    const X0 = xs[0].a;
    const X1 = xs[xs.length - 1].b;
    const Z0 = zs[0].a;
    const Z1 = zs[zs.length - 1].b;
    this.bounds = rect(X0, Z0, X1, Z1);

    for (const l of xs) this.streets.push({ rect: rect(l.a, Z0, l.b, Z1), kind: l.kind, axis: 'z' });
    for (const l of zs) this.streets.push({ rect: rect(X0, l.a, X1, l.b), kind: l.kind, axis: 'x' });

    // A retaining wall just outside the ring avenue keeps you in town.
    const t = 2;
    this.addBuilding({ rect: rect(X0 - t - 1, Z0 - t - 1, X1 + t + 1, Z0 - 1), kind: 'wall', floors: 1, height: 3.2, face: 2, seed: 0 });
    this.addBuilding({ rect: rect(X0 - t - 1, Z1 + 1, X1 + t + 1, Z1 + t + 1), kind: 'wall', floors: 1, height: 3.2, face: 0, seed: 0 });
    this.addBuilding({ rect: rect(X0 - t - 1, Z0 - 1, X0 - 1, Z1 + 1), kind: 'wall', floors: 1, height: 3.2, face: 1, seed: 0 });
    this.addBuilding({ rect: rect(X1 + 1, Z0 - 1, X1 + t + 1, Z1 + 1), kind: 'wall', floors: 1, height: 3.2, face: 3, seed: 0 });

    const size = Math.max(X1 - X0, Z1 - Z0) / 2;
    let gas = 0;
    let parks = 0;
    for (let i = 0; i < xs.length - 1; i++)
      for (let j = 0; j < zs.length - 1; j++) {
        const block = rect(xs[i].b, zs[j].b, xs[i + 1].a, zs[j + 1].a);
        // Sides: north, east, south, west street kinds.
        const sides: StreetKind[] = [zs[j].kind, xs[i + 1].kind, zs[j + 1].kind, xs[i].kind];
        const cx = (block.x0 + block.x1) / 2;
        const cz = (block.z0 + block.z1) / 2;
        const r = Math.hypot(cx, cz) / size; // 0 downtown, ~1 at the edge
        // One or two shrine parks, a little off centre.
        if (parks < 2 && r > 0.25 && r < 0.6 && rand() < 0.07) {
          parks++;
          this.blocks.push(block);
          this.furnishPark(block, sides, rand);
          continue;
        }
        // Some blocks are split by a narrow lane through the middle.
        const parts: { r: Rect; sides: StreetKind[] }[] = [];
        if (rand() < 0.35 && Math.max(w(block), d(block)) > 44) {
          const half = WIDTH.lane / 2;
          if (w(block) > d(block)) {
            const m = cx + (rand() - 0.5) * w(block) * 0.2;
            const lane = rect(m - half, block.z0, m + half, block.z1);
            this.streets.push({ rect: lane, kind: 'lane', axis: 'z' });
            this.xLines.push({ at: m, kind: 'lane' });
            this.stretches.push({ axis: 'z', at: m, kind: 'lane', s0: block.z0, s1: block.z1 });
            parts.push({ r: rect(block.x0, block.z0, lane.x0, block.z1), sides: [sides[0], 'lane', sides[2], sides[3]] });
            parts.push({ r: rect(lane.x1, block.z0, block.x1, block.z1), sides: [sides[0], sides[1], sides[2], 'lane'] });
            this.tomare(m, block.z0, 'z', false);
            this.tomare(m, block.z1, 'z', true);
          } else {
            const m = cz + (rand() - 0.5) * d(block) * 0.2;
            const lane = rect(block.x0, m - half, block.x1, m + half);
            this.streets.push({ rect: lane, kind: 'lane', axis: 'x' });
            this.zLines.push({ at: m, kind: 'lane' });
            this.stretches.push({ axis: 'x', at: m, kind: 'lane', s0: block.x0, s1: block.x1 });
            parts.push({ r: rect(block.x0, block.z0, block.x1, lane.z0), sides: [sides[0], sides[1], 'lane', sides[3]] });
            parts.push({ r: rect(block.x0, lane.z1, block.x1, block.z1), sides: ['lane', sides[1], sides[2], sides[3]] });
            this.tomare(block.x0, m, 'x', false);
            this.tomare(block.x1, m, 'x', true);
          }
        } else parts.push({ r: block, sides });
        for (const p of parts) {
          this.blocks.push(p.r);
          const wantGas = gas < 5 && p.sides.includes('avenue') && rand() < 0.3;
          if (wantGas) gas++;
          this.furnishBlock(p.r, p.sides, r, rand, wantGas);
        }
      }

    this.lineStreets(xs, zs, rand);
    this.buildGrids();

    // Start on the southern avenue near the middle, facing north up a side street.
    // (Japan drives on the left.)
    const start = xs[Math.round(n / 3)];
    const sz = zs[zs.length - 1];
    this.spawn = { x: start.at - 3, z: sz.a - 12, yaw: 0 };
  }

  private addBuilding(b: Building) {
    this.buildings.push(b);
    this.solids.push(b.rect);
  }

  private tomare(x: number, z: number, axis: 'x' | 'z', flip: boolean) {
    // Just before the lane meets the street: a stop line and とまれ written on the road.
    const s = flip ? -1 : 1;
    if (axis === 'z') {
      this.markings.push({ kind: 'stop', x, z: z + s * 1.2, w: WIDTH.lane - 0.8, d: 0.35, axis, flip });
      this.markings.push({ kind: 'tomare', x, z: z + s * 4.2, w: WIDTH.lane - 1.2, d: 3.2, axis, flip });
    } else {
      this.markings.push({ kind: 'stop', x: x + s * 1.2, z, w: WIDTH.lane - 0.8, d: 0.35, axis, flip });
      this.markings.push({ kind: 'tomare', x: x + s * 4.2, z, w: WIDTH.lane - 1.2, d: 3.2, axis, flip });
    }
  }

  /** Sidewalks, parcels and what stands on them, for one block. */
  private furnishBlock(block: Rect, sides: StreetKind[], r: number, rand: () => number, wantGas: boolean) {
    const sw = sides.map((k) => SIDEWALK[k]);
    const inner = rect(block.x0 + sw[3], block.z0 + sw[0], block.x1 - sw[1], block.z1 - sw[2]);
    this.inners.push(inner);
    const regions: Rect[] = [inner];

    // A gas station on a corner that faces an avenue.
    if (wantGas) {
      const face = sides.indexOf('avenue') as Facing;
      const corner = this.carveCorner(regions, face, sides, 26, 22);
      if (corner) this.furnishGas(corner, face, rand);
    }
    // Coin parking on some corners.
    if (rand() < 0.3) {
      const face = this.bestSide(sides, rand);
      const lot = this.carveCorner(regions, face, sides, 12 + Math.floor(rand() * 2) * 5, 11);
      if (lot) this.furnishParking(lot, face, rand);
    }

    for (const reg of regions) {
      for (const parcel of split(reg, r < 0.35 ? 22 : 15, rand)) {
        // Which sides of the parcel are on the block's edge (and so on a street)?
        const touches: Facing[] = [];
        if (parcel.z0 <= inner.z0 + 0.01) touches.push(0);
        if (parcel.x1 >= inner.x1 - 0.01) touches.push(1);
        if (parcel.z1 >= inner.z1 - 0.01) touches.push(2);
        if (parcel.x0 <= inner.x0 + 0.01) touches.push(3);
        if (!touches.length) {
          // Hidden in the middle of the block: a low house or a tree in a yard.
          if (rand() < 0.6) this.addBuilding({ rect: shrink(parcel, 0.8), kind: 'house', floors: 2, height: 2 * FLOOR, face: 0, seed: rand() });
          else this.props.push({ kind: 'tree', x: (parcel.x0 + parcel.x1) / 2, z: (parcel.z0 + parcel.z1) / 2, yaw: rand() * 6.28, variant: 0 });
          continue;
        }
        const rank: Record<StreetKind, number> = { avenue: 3, street: 2, lane: 1 };
        const face = touches.reduce((a, b) => (rank[sides[b]] > rank[sides[a]] ? b : a));
        const kind = sides[face];
        const corner = touches.length >= 2;
        this.placeBuilding(parcel, face, kind, corner, r, rand);
      }
    }
  }

  private bestSide(sides: StreetKind[], rand: () => number): Facing {
    const order: StreetKind[] = ['street', 'avenue', 'lane'];
    for (const k of order) {
      const idx = sides.map((s, i) => (s === k ? i : -1)).filter((i) => i >= 0);
      if (idx.length) return idx[Math.floor(rand() * idx.length)] as Facing;
    }
    return 0;
  }

  /**
   * Take a `width` (along the street) by `depth` rectangle from a corner of the first region
   * on the `face` side, and replace the region with what's left of it.
   */
  private carveCorner(regions: Rect[], face: Facing, sides: StreetKind[], width: number, depth: number): Rect | null {
    const reg = regions[0];
    const along = face === 0 || face === 2 ? w(reg) : d(reg);
    const across = face === 0 || face === 2 ? d(reg) : w(reg);
    if (along < width + 10 || across < depth + 8) return null;
    // Pick the end of the side that's also on a street (every block corner is), preferring the busier one.
    const endA = sides[(face + 3) % 4];
    const endB = sides[(face + 1) % 4];
    const rank: Record<StreetKind, number> = { avenue: 3, street: 2, lane: 1 };
    const atStart = rank[endA] >= rank[endB]; // start = the west end of a north side, going clockwise
    let cut: Rect;
    let rest: Rect[];
    if (face === 0 || face === 2) {
      const x0 = atStart === (face === 0) ? reg.x0 : reg.x1 - width;
      const x1 = x0 + width;
      const z0 = face === 0 ? reg.z0 : reg.z1 - depth;
      cut = rect(x0, z0, x1, z0 + depth);
      const strip = x0 === reg.x0 ? rect(x1, reg.z0, reg.x1, reg.z1) : rect(reg.x0, reg.z0, x0, reg.z1);
      const behind = face === 0 ? rect(x0, cut.z1, x1, reg.z1) : rect(x0, reg.z0, x1, cut.z0);
      rest = [strip, behind];
    } else {
      const z0 = atStart === (face === 1) ? reg.z0 : reg.z1 - width;
      const z1 = z0 + width;
      const x0 = face === 3 ? reg.x0 : reg.x1 - depth;
      cut = rect(x0, z0, x0 + depth, z1);
      const strip = z0 === reg.z0 ? rect(reg.x0, z1, reg.x1, reg.z1) : rect(reg.x0, reg.z0, reg.x1, z0);
      const behind = face === 3 ? rect(cut.x1, z0, reg.x1, z1) : rect(reg.x0, z0, cut.x0, z1);
      rest = [strip, behind];
    }
    regions.splice(0, 1, ...rest.filter((q) => w(q) > 3 && d(q) > 3));
    return cut;
  }

  private placeBuilding(parcel: Rect, face: Facing, street: StreetKind, corner: boolean, r: number, rand: () => number) {
    const seed = rand();
    const pw = face === 0 || face === 2 ? w(parcel) : d(parcel); // frontage
    const pd = face === 0 || face === 2 ? d(parcel) : w(parcel);
    let kind: BuildingKind;
    let floors: number;
    if (street === 'avenue' && r < 0.4) {
      kind = rand() < 0.45 ? 'tower' : 'office';
      floors = kind === 'tower' ? 8 + Math.floor(rand() * 8) : 5 + Math.floor(rand() * 4);
    } else if (corner && street !== 'lane' && pw >= 11 && pd >= 14 && rand() < 0.3) {
      kind = 'konbini';
      floors = 1;
    } else if (street === 'avenue') {
      const x = rand();
      kind = x < 0.4 ? 'apartment' : x < 0.75 ? 'shop' : 'office';
      floors = kind === 'shop' ? 3 + Math.floor(rand() * 2) : 4 + Math.floor(rand() * 4);
    } else if (street === 'street') {
      const x = rand() + (0.4 - r) * 0.5;
      kind = x > 0.62 ? 'shop' : x > 0.38 ? 'apartment' : 'house';
      floors = kind === 'shop' ? 2 + Math.floor(rand() * 2) : kind === 'apartment' ? 3 + Math.floor(rand() * 3) : 2;
    } else {
      kind = rand() < 0.3 ? 'shop' : 'house';
      floors = 2;
    }
    if (kind === 'house' && rand() < 0.15) floors = 1;

    // Gaps between neighbours, a small setback for houses.
    const gap = 0.35 + rand() * 0.5;
    let b = shrink(parcel, gap);
    const setback = kind === 'house' ? 1.2 + rand() * 1.5 : kind === 'konbini' ? 7 : 0;
    // Pull the front back to the street edge (shrink took some off every side).
    b = moveFront(b, face, setback > 0 ? -setback + gap : gap);
    if (w(b) < 4 || d(b) < 4) return;
    const height = kind === 'konbini' ? 4.6 : floors * FLOOR + (kind === 'shop' ? 0.6 : 0);
    this.addBuilding({ rect: b, kind, floors, height, face, seed });

    // A konbini's car park and a vending machine or two out front.
    const fx = face === 1 ? 1 : face === 3 ? -1 : 0;
    const fz = face === 2 ? 1 : face === 0 ? -1 : 0;
    const frontX = face === 1 ? b.x1 : face === 3 ? b.x0 : (b.x0 + b.x1) / 2;
    const frontZ = face === 2 ? b.z1 : face === 0 ? b.z0 : (b.z0 + b.z1) / 2;
    const yaw = faceYaw(face);
    if (kind === 'konbini') {
      const apron = moveFront(b, face, 0);
      // The apron is the strip between the shop and the street.
      const pad: Rect =
        face === 0 ? rect(b.x0, parcel.z0, b.x1, b.z0) : face === 2 ? rect(b.x0, b.z1, b.x1, parcel.z1) : face === 1 ? rect(b.x1, b.z0, parcel.x1, b.z1) : rect(parcel.x0, b.z0, b.x0, b.z1);
      void apron;
      this.pads.push({ rect: pad, kind: 'forecourt', face });
    }
    const vend = kind === 'konbini' ? 1 : kind === 'shop' || kind === 'apartment' ? 0.25 : kind === 'house' ? 0.08 : 0;
    if (rand() < vend && pw > 7) {
      const along = (pw / 2 - 1.2) * (rand() < 0.5 ? -1 : 1);
      const ax = fz !== 0 ? along : 0;
      const az = fx !== 0 ? along : 0;
      const count = kind === 'konbini' ? 2 : 1 + (rand() < 0.4 ? 1 : 0);
      for (let k = 0; k < count; k++) {
        const off = k * 1.0;
        const x = frontX + ax + fx * 0.45 + (fz !== 0 ? off : 0);
        const z = frontZ + az + fz * 0.45 + (fx !== 0 ? off : 0);
        this.props.push({ kind: 'vending', x, z, yaw, variant: Math.floor(rand() * 4) });
        this.obstacles.push({ x, z, r: 0.55 });
      }
    }
    if (kind === 'shop' && rand() < 0.35) {
      // Paper lanterns either side of an izakaya's door.
      for (const s of [-1, 1]) {
        const along = s * 1.3;
        this.props.push({ kind: 'lantern', x: frontX + (fz !== 0 ? along : 0) + fx * 0.3, z: frontZ + (fx !== 0 ? along : 0) + fz * 0.3, yaw, variant: 0 });
      }
    }
  }

  private furnishGas(lot: Rect, face: Facing, rand: () => number) {
    this.pads.push({ rect: lot, kind: 'gas', face });
    const cx = (lot.x0 + lot.x1) / 2;
    const cz = (lot.z0 + lot.z1) / 2;
    const alongX = face === 0 || face === 2;
    // The kiosk sits at the back; pump islands under the canopy in the middle.
    const back = 5;
    const kiosk =
      face === 0 ? rect(lot.x0 + 2, lot.z1 - back, lot.x1 - 8, lot.z1 - 0.3) : face === 2 ? rect(lot.x0 + 8, lot.z0 + 0.3, lot.x1 - 2, lot.z0 + back) : face === 1 ? rect(lot.x0 + 0.3, lot.z0 + 2, lot.x0 + back, lot.z1 - 8) : rect(lot.x1 - back, lot.z0 + 8, lot.x1 - 0.3, lot.z1 - 2);
    this.addBuilding({ rect: kiosk, kind: 'kiosk', floors: 1, height: 3.6, face, seed: rand() });
    const fx = face === 1 ? 1 : face === 3 ? -1 : 0;
    const fz = face === 2 ? 1 : face === 0 ? -1 : 0;
    const mx = cx + fx * 2;
    const mz = cz + fz * 2;
    for (const s of [-1, 1]) {
      const px = mx + (alongX ? s * 4.5 : 0);
      const pz = mz + (alongX ? 0 : s * 4.5);
      // Island: a long kerb with two pumps.
      const half = alongX ? { x: 0.6, z: 2.4 } : { x: 2.4, z: 0.6 };
      this.solids.push(rect(px - half.x, pz - half.z, px + half.x, pz + half.z));
      for (const t of [-1, 1]) {
        this.props.push({ kind: 'pump', x: px + (alongX ? 0 : t * 1.2), z: pz + (alongX ? t * 1.2 : 0), yaw: alongX ? 0 : Math.PI / 2, variant: 0 });
      }
    }
    // A parked customer.
    if (rand() < 0.7) {
      const s = rand() < 0.5 ? -1 : 1;
      this.parkCar(mx + (alongX ? s * 2.2 : 0), mz + (alongX ? 0 : s * 2.2), alongX ? 0 : Math.PI / 2, rand);
    }
  }

  private furnishParking(lot: Rect, face: Facing, rand: () => number) {
    this.pads.push({ rect: lot, kind: 'parking', face });
    // Bays run from the back of the lot; a pay machine by the entrance.
    const alongX = face === 0 || face === 2;
    const bays = Math.floor((alongX ? w(lot) : d(lot)) / 2.6);
    for (let i = 0; i < bays; i++) {
      if (rand() > 0.45) continue;
      const t = (i + 0.5) * 2.6;
      const depthIn = 3.2;
      const x = alongX ? lot.x0 + t : face === 1 ? lot.x0 + depthIn : lot.x1 - depthIn;
      const z = alongX ? (face === 2 ? lot.z0 + depthIn : lot.z1 - depthIn) : lot.z0 + t;
      this.parkCar(x, z, alongX ? (face === 2 ? Math.PI : 0) : face === 1 ? -Math.PI / 2 : Math.PI / 2, rand);
    }
    const mx = face === 1 ? lot.x1 - 0.8 : face === 3 ? lot.x0 + 0.8 : lot.x0 + 0.8;
    const mz = face === 2 ? lot.z1 - 0.8 : face === 0 ? lot.z0 + 0.8 : lot.z0 + 0.8;
    this.props.push({ kind: 'meter', x: mx, z: mz, yaw: faceYaw(face), variant: 0 });
    this.obstacles.push({ x: mx, z: mz, r: 0.35 });
  }

  private parkCar(x: number, z: number, yaw: number, rand: () => number) {
    // Enough to make the car parks look used, not so many they cost frames.
    if (this.props.filter((p) => p.kind === 'car').length >= 60) return;
    this.props.push({ kind: 'car', x, z, yaw, variant: Math.floor(rand() * 24) });
    const along = Math.abs(Math.sin(yaw)) > 0.5; // pointing along x
    this.solids.push(along ? rect(x - 2.1, z - 0.85, x + 2.1, z + 0.85) : rect(x - 0.85, z - 2.1, x + 0.85, z + 2.1));
  }

  private furnishPark(block: Rect, sides: StreetKind[], rand: () => number) {
    const face = sides.indexOf('avenue') >= 0 ? (sides.indexOf('street') >= 0 ? (sides.indexOf('street') as Facing) : 0) : 0;
    const sw = sides.map((k) => SIDEWALK[k]);
    const inner = rect(block.x0 + sw[3], block.z0 + sw[0], block.x1 - sw[1], block.z1 - sw[2]);
    this.inners.push(inner);
    this.pads.push({ rect: inner, kind: 'park', face });
    const cx = (inner.x0 + inner.x1) / 2;
    const cz = (inner.z0 + inner.z1) / 2;
    const fx = face === 1 ? 1 : face === 3 ? -1 : 0;
    const fz = face === 2 ? 1 : face === 0 ? -1 : 0;
    // The shrine hall at the back of the park, a path to it through a torii.
    const hx = cx - fx * (w(inner) / 2 - 8);
    const hz = cz - fz * (d(inner) / 2 - 8);
    this.addBuilding({ rect: rect(hx - 4, hz - 4, hx + 4, hz + 4), kind: 'shrine', floors: 1, height: 3.4, face, seed: rand() });
    const yaw = faceYaw(face);
    const reach = (fx !== 0 ? w(inner) : d(inner)) / 2;
    for (const t of [0.35, 0.75]) {
      const tx = cx + fx * reach * t;
      const tz = cz + fz * reach * t;
      this.props.push({ kind: 'torii', x: tx, z: tz, yaw, variant: 0 });
      // The two pillars.
      const px = fz !== 0 ? 1 : 0;
      const pz = fx !== 0 ? 1 : 0;
      this.obstacles.push({ x: tx + px * 2.2, z: tz + pz * 2.2, r: 0.35 }, { x: tx - px * 2.2, z: tz - pz * 2.2, r: 0.35 });
    }
    for (const s of [-1, 1]) {
      const lx = hx + fx * 6 + (fz !== 0 ? s * 2.5 : 0);
      const lz = hz + fz * 6 + (fx !== 0 ? s * 2.5 : 0);
      this.props.push({ kind: 'lantern', x: lx, z: lz, yaw, variant: 1 });
      this.obstacles.push({ x: lx, z: lz, r: 0.4 });
    }
    // Trees around the edge, clear of the path; benches here and there.
    for (let i = 0; i < 40; i++) {
      const x = inner.x0 + 2 + rand() * (w(inner) - 4);
      const z = inner.z0 + 2 + rand() * (d(inner) - 4);
      const onPath = fx !== 0 ? Math.abs(z - cz) < 4.5 : Math.abs(x - cx) < 4.5;
      if (onPath || (Math.abs(x - hx) < 7 && Math.abs(z - hz) < 7)) continue;
      const sakura = rand() < 0.45;
      this.props.push({ kind: sakura ? 'sakura' : 'tree', x, z, yaw: rand() * 6.28, variant: Math.floor(rand() * 3) });
      this.obstacles.push({ x, z, r: 0.45 });
    }
    for (let i = 0; i < 4; i++) {
      const s = i % 2 ? 1 : -1;
      const t = 0.2 + Math.floor(i / 2) * 0.4;
      const bx = cx + fx * reach * t + (fz !== 0 ? s * 3.4 : 0);
      const bz = cz + fz * reach * t + (fx !== 0 ? s * 3.4 : 0);
      this.props.push({ kind: 'bench', x: bx, z: bz, yaw: yaw + (fx !== 0 ? (s > 0 ? Math.PI / 2 : -Math.PI / 2) : s > 0 ? 0 : Math.PI), variant: 0 });
    }
  }

  /** Poles, wires, lamps, trees and signals along the streets, and the crossings. */
  private lineStreets(xs: { at: number; kind: StreetKind; a: number; b: number }[], zs: { at: number; kind: StreetKind; a: number; b: number }[], rand: () => number) {
    const all = [
      ...xs.map((l) => ({ ...l, axis: 'z' as const })),
      ...zs.map((l) => ({ ...l, axis: 'x' as const })),
    ];
    const cross = (axis: 'x' | 'z') => (axis === 'z' ? zs : xs);
    for (const line of all) {
      const others = cross(line.axis);
      for (let k = 0; k < others.length - 1; k++) {
        // One stretch between two crossings.
        const s0 = others[k].b;
        const s1 = others[k + 1].a;
        const len = s1 - s0;
        this.stretches.push({ axis: line.axis, at: line.at, kind: line.kind, s0, s1 });
        const pt = (s: number, off: number) => (line.axis === 'z' ? { x: line.at + off, z: s } : { x: s, z: line.at + off });
        const half = WIDTH[line.kind] / 2;
        const sw = SIDEWALK[line.kind];
        if (line.kind === 'avenue') {
          // Street lamps both sides, ginkgo and cherry trees between them.
          for (const side of [-1, 1]) {
            const n = Math.max(1, Math.round(len / 28));
            for (let i = 0; i < n; i++) {
              const p = pt(s0 + ((i + 0.5) * len) / n, side * (half + 0.6));
              this.props.push({ kind: 'lamp', x: p.x, z: p.z, yaw: line.axis === 'z' ? (side > 0 ? Math.PI / 2 : -Math.PI / 2) : side > 0 ? Math.PI : 0, variant: side });
              this.obstacles.push({ x: p.x, z: p.z, r: 0.2 });
              if (i === n - 1) continue;
              const q = pt(s0 + ((i + 1) * len) / n, side * (half + sw - 1.1));
              this.props.push({ kind: rand() < 0.35 ? 'sakura' : 'tree', x: q.x, z: q.z, yaw: rand() * 6.28, variant: 1 + Math.floor(rand() * 2) });
              this.obstacles.push({ x: q.x, z: q.z, r: 0.35 });
            }
          }
          continue;
        }
        // Side streets and lanes: a line of concrete utility poles with wires between.
        if (len < 14) continue;
        const side = rand() < 0.5 ? -1 : 1;
        const off = side * (line.kind === 'lane' ? half - 0.3 : half + 0.35);
        const n = Math.max(1, Math.round(len / 26));
        let prev: { x: number; z: number } | null = null;
        for (let i = 0; i <= n; i++) {
          const s = s0 + 3 + ((len - 6) * i) / n;
          const p = pt(s, off);
          this.props.push({ kind: 'pole', x: p.x, z: p.z, yaw: line.axis === 'z' ? 0 : Math.PI / 2, variant: (i + k) % 3 === 0 ? 1 : 0 });
          this.obstacles.push({ x: p.x, z: p.z, r: 0.22 });
          if (prev) this.wires.push([prev.x, prev.z, p.x, p.z]);
          prev = p;
        }
      }
    }
    // Crossings: zebra stripes on every approach to an avenue junction, and a signal on its corners.
    for (const a of xs)
      for (const b of zs) {
        if (a.kind === 'lane' || b.kind === 'lane') continue;
        if (a.kind !== 'avenue' && b.kind !== 'avenue') continue;
        const edge = (l: typeof a) => l.b - l.at;
        this.signals.push({ x: a.at, z: b.at });
        // Zebra on the road running along z, just north and south of the junction.
        for (const s of [-1, 1]) {
          this.markings.push({ kind: 'zebra', x: a.at, z: b.at + s * (edge(b) + 2.2), w: WIDTH[a.kind] - 1, d: 3.4, axis: 'z', flip: false });
          this.markings.push({ kind: 'zebra', x: a.at + s * (edge(a) + 2.2), z: b.at, w: WIDTH[b.kind] - 1, d: 3.4, axis: 'x', flip: false });
          this.markings.push({ kind: 'stop', x: a.at - s * WIDTH[a.kind] * 0.25, z: b.at + s * (edge(b) + 4.4), w: WIDTH[a.kind] / 2 - 0.6, d: 0.4, axis: 'z', flip: false });
          this.markings.push({ kind: 'stop', x: a.at + s * (edge(a) + 4.4), z: b.at + s * WIDTH[b.kind] * 0.25, w: WIDTH[b.kind] / 2 - 0.6, d: 0.4, axis: 'x', flip: false });
        }
        for (const sx of [-1, 1])
          for (const sz of [-1, 1]) {
            if (sx !== sz) continue; // two opposite corners
            const x = a.at + sx * (edge(a) + 0.7);
            const z = b.at + sz * (edge(b) + 0.7);
            this.props.push({ kind: 'signal', x, z, yaw: sx > 0 ? Math.PI : 0, variant: 0 });
            this.obstacles.push({ x, z, r: 0.22 });
          }
      }
  }

  private key(cx: number, cz: number) {
    return cx * 4096 + cz;
  }

  private buildGrids() {
    const put = (grid: Map<number, number[]>, r: Rect, i: number) => {
      for (let cx = Math.floor(r.x0 / this.cell); cx <= Math.floor(r.x1 / this.cell); cx++)
        for (let cz = Math.floor(r.z0 / this.cell); cz <= Math.floor(r.z1 / this.cell); cz++) {
          const k = this.key(cx, cz);
          let list = grid.get(k);
          if (!list) grid.set(k, (list = []));
          list.push(i);
        }
    };
    this.solids.forEach((r, i) => {
      // The long boundary walls would fill a lot of cells; they're checked separately.
      if (w(r) > 200 || d(r) > 200) return;
      put(this.solidGrid, r, i);
    });
    this.obstacles.forEach((o, i) => put(this.obstacleGrid, rect(o.x - o.r, o.z - o.r, o.x + o.r, o.z + o.r), i));
  }

  /** Solids and obstacles near a point (within about one grid cell). */
  near(x: number, z: number) {
    const solids = new Set<number>();
    const obstacles = new Set<number>();
    const cx = Math.floor(x / this.cell);
    const cz = Math.floor(z / this.cell);
    for (let i = -1; i <= 1; i++)
      for (let j = -1; j <= 1; j++) {
        const k = this.key(cx + i, cz + j);
        for (const s of this.solidGrid.get(k) ?? []) solids.add(s);
        for (const o of this.obstacleGrid.get(k) ?? []) obstacles.add(o);
      }
    return { solids: [...solids].map((i) => this.solids[i]), obstacles: [...obstacles].map((i) => this.obstacles[i]) };
  }

  /** True when a point is on open ground (not inside anything solid or out of town). */
  isOpen(x: number, z: number, margin = 0) {
    const b = this.bounds;
    if (x < b.x0 + margin || x > b.x1 - margin || z < b.z0 + margin || z > b.z1 - margin) return false;
    const { solids, obstacles } = this.near(x, z);
    for (const r of solids) if (x > r.x0 - margin && x < r.x1 + margin && z > r.z0 - margin && z < r.z1 + margin) return false;
    for (const o of obstacles) if (Math.hypot(x - o.x, z - o.z) < o.r + margin) return false;
    return true;
  }

  /** The street a point is on, if any. */
  streetAt(x: number, z: number) {
    for (const s of this.streets) if (x >= s.rect.x0 && x <= s.rect.x1 && z >= s.rect.z0 && z <= s.rect.z1) return s;
    return null;
  }
}

/** Heading that faces out of a building's front. */
export function faceYaw(face: Facing) {
  return [0, -Math.PI / 2, Math.PI, Math.PI / 2][face];
}

function shrink(r: Rect, m: number): Rect {
  return rect(r.x0 + m, r.z0 + m, r.x1 - m, r.z1 - m);
}

/** Move a rectangle's front edge by `by` (positive pushes it out towards the street). */
function moveFront(r: Rect, face: Facing, by: number): Rect {
  const o = { ...r };
  if (face === 0) o.z0 -= by;
  else if (face === 1) o.x1 += by;
  else if (face === 2) o.z1 += by;
  else o.x0 -= by;
  return o;
}

/** Split a rectangle into parcels no bigger than about `max` on a side. */
function split(r: Rect, max: number, rand: () => number): Rect[] {
  const out: Rect[] = [];
  const go = (q: Rect) => {
    const qw = w(q);
    const qd = d(q);
    if (qw <= max && qd <= max) {
      out.push(q);
      return;
    }
    const t = 0.35 + rand() * 0.3;
    if (qw >= qd) {
      const m = q.x0 + qw * t;
      go(rect(q.x0, q.z0, m, q.z1));
      go(rect(m, q.z0, q.x1, q.z1));
    } else {
      const m = q.z0 + qd * t;
      go(rect(q.x0, q.z0, q.x1, m));
      go(rect(q.x0, m, q.x1, q.z1));
    }
  };
  go(r);
  return out;
}

const cache = new Map<number, City>();
export function cityFor(opts: CityOptions) {
  let c = cache.get(opts.seed);
  if (!c) cache.set(opts.seed, (c = new City(opts)));
  return c;
}
