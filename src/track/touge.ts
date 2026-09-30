// Procedural touge: a narrow mountain road of sweepers, tight corners and hairpins,
// descending from the summit. Pure data, no rendering, so it can be tested.

export interface RoadSample {
  s: number; // distance along the road, m
  x: number;
  z: number;
  h: number; // road surface height
  yaw: number; // heading, same convention as the chassis (0 = -z, CCW positive)
  kappa: number; // curvature, 1/m, left positive
}

export interface RoadLocation {
  index: number;
  s: number;
  offset: number; // lateral offset from the centreline, left positive
  sample: RoadSample; // interpolated
}

export const SAMPLE_STEP = 2;

/** A flat pull-off beside the road: somewhere to stop, park and take in the view. */
export interface Lot {
  s0: number; // where it opens off the road
  s1: number; // where it rejoins
  side: 1 | -1; // 1 = left of the direction of travel
  depth: number; // how far it reaches past the road's edge, m
}

/** Something standing in a lot: a parked car, a pair of vending machines, a lamp. */
export interface LotProp {
  kind: 'car' | 'vending' | 'lamp';
  x: number;
  z: number;
  h: number;
  yaw: number; // heading of the prop (the car's nose, the vending machine's front)
  variant: number; // which car and paint; for a lamp, the side of the road it stands on
}

/** Round things the car bumps into (the lots' parked cars and machines). */
export interface Obstacle {
  x: number;
  z: number;
  r: number;
}

/** Metres at each end of a lot where its edge angles in from the road. */
export const LOT_RAMP = 10;

interface Piece {
  length: number;
  kappa: number;
  kind: 'straight' | 'sweeper' | 'tight' | 'hairpin';
}

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

export class Road {
  samples: RoadSample[];
  halfWidth = 3.0; // lane edges: a narrow two-lane mountain road
  wallOffset = 4.1; // where the guardrail / rock face stops the car
  startS = 70;
  finishS: number;
  lots: Lot[] = [];
  props: LotProp[] = [];
  obstacles: Obstacle[] = [];
  private grid = new Map<string, number[]>();
  private cell = 32;

  constructor(samples: RoadSample[]) {
    this.samples = samples;
    this.finishS = samples[samples.length - 1].s - 40;
    for (let i = 0; i < samples.length; i += 2) {
      const k = this.key(samples[i].x, samples[i].z);
      let list = this.grid.get(k);
      if (!list) this.grid.set(k, (list = []));
      list.push(i);
    }
  }

  /** How far a lot widens the road on one side at distance s (0 where there is none). */
  lotDepth(s: number, side: number) {
    for (const l of this.lots) {
      if (l.side !== side || s <= l.s0 || s >= l.s1) continue;
      const t = Math.min(s - l.s0, l.s1 - s) / LOT_RAMP;
      return l.depth * Math.min(1, t);
    }
    return 0;
  }

  get length() {
    return this.samples[this.samples.length - 1].s;
  }

  private key(x: number, z: number) {
    return `${Math.floor(x / this.cell)},${Math.floor(z / this.cell)}`;
  }

  /** Indices of (every other) sample within roughly `radius` of a point. */
  near(x: number, z: number, radius: number) {
    const out: number[] = [];
    const r = Math.ceil(radius / this.cell);
    const cx = Math.floor(x / this.cell);
    const cz = Math.floor(z / this.cell);
    for (let i = -r; i <= r; i++)
      for (let j = -r; j <= r; j++) {
        const list = this.grid.get(`${cx + i},${cz + j}`);
        if (list) out.push(...list);
      }
    return out;
  }

  sampleAt(s: number): RoadSample {
    const n = this.samples.length;
    const f = Math.min(n - 1.001, Math.max(0, s / SAMPLE_STEP));
    const i = Math.floor(f);
    return lerpSample(this.samples[i], this.samples[i + 1], f - i);
  }

  /**
   * Nearest point on the centreline. With a hint (last known index) it searches
   * locally, which keeps the car on its own leg of a hairpin.
   */
  locate(x: number, z: number, hint?: number): RoadLocation {
    const n = this.samples.length;
    let best = -1;
    let bestD = Infinity;
    const consider = (i: number) => {
      const p = this.samples[i];
      const d = (p.x - x) ** 2 + (p.z - z) ** 2;
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    };
    if (hint !== undefined) {
      for (let i = Math.max(0, hint - 20); i <= Math.min(n - 1, hint + 20); i++) consider(i);
    }
    if (best < 0 || bestD > 30 * 30) {
      for (const i of this.near(x, z, 40)) consider(i);
      if (best < 0) for (let i = 0; i < n; i++) consider(i);
      for (let i = Math.max(0, best - 2); i <= Math.min(n - 1, best + 2); i++) consider(i);
    }
    // Project onto the segment on either side of the nearest sample.
    let bestLoc: RoadLocation | null = null;
    let bestDist = Infinity;
    for (const i0 of [best - 1, best]) {
      if (i0 < 0 || i0 + 1 >= n) continue;
      const a = this.samples[i0];
      const b = this.samples[i0 + 1];
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const len2 = dx * dx + dz * dz;
      const t = Math.min(1, Math.max(0, ((x - a.x) * dx + (z - a.z) * dz) / len2));
      const px = a.x + dx * t;
      const pz = a.z + dz * t;
      const dist = (x - px) ** 2 + (z - pz) ** 2;
      if (dist < bestDist) {
        bestDist = dist;
        const sample = lerpSample(a, b, t);
        // Left of heading (-sin, -cos) is (-cos, sin).
        const lx = -Math.cos(sample.yaw);
        const lz = Math.sin(sample.yaw);
        bestLoc = { index: i0 + (t > 0.5 ? 1 : 0), s: sample.s, offset: (x - px) * lx + (z - pz) * lz, sample };
      }
    }
    return bestLoc!;
  }
}

function lerpAngle(a: number, b: number, t: number) {
  let d = b - a;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return a + d * t;
}

function lerpSample(a: RoadSample, b: RoadSample, t: number): RoadSample {
  return {
    s: a.s + (b.s - a.s) * t,
    x: a.x + (b.x - a.x) * t,
    z: a.z + (b.z - a.z) * t,
    h: a.h + (b.h - a.h) * t,
    yaw: lerpAngle(a.yaw, b.yaw, t),
    kappa: a.kappa + (b.kappa - a.kappa) * t,
  };
}

/** Integrate pieces into centreline points (x, z, yaw, kappa) every metre, with eased curvature. */
function integrate(pieces: Piece[], start: { x: number; z: number; yaw: number }, startKappa = 0) {
  const pts: { x: number; z: number; yaw: number; kappa: number }[] = [];
  let { x, z, yaw } = start;
  let prevK = startKappa;
  for (let p = 0; p < pieces.length; p++) {
    const piece = pieces[p];
    const ramp = Math.min(18, piece.length / 2);
    for (let i = 0; i < piece.length; i++) {
      // Blend curvature in over `ramp` metres (a clothoid-ish transition).
      const k = i < ramp ? prevK + (piece.kappa - prevK) * (i / ramp) : piece.kappa;
      pts.push({ x, z, yaw, kappa: k });
      yaw += k;
      x += -Math.sin(yaw);
      z += -Math.cos(yaw);
    }
    prevK = piece.kappa;
  }
  pts.push({ x, z, yaw, kappa: prevK });
  return pts;
}

function randomPiece(r: () => number, lastTurn: number, towardsCentre: number | null): Piece {
  const u = r();
  let dir = r() < 0.7 ? -lastTurn || 1 : lastTurn || 1;
  if (towardsCentre !== null && r() < 0.8) dir = towardsCentre;
  const deg = Math.PI / 180;
  if (u < 0.22) return { kind: 'straight', length: Math.round(40 + r() * 120), kappa: 0 };
  if (u < 0.55) {
    const radius = 70 + r() * 150;
    const angle = (25 + r() * 55) * deg;
    return { kind: 'sweeper', length: Math.round(radius * angle), kappa: dir / radius };
  }
  if (u < 0.83) {
    const radius = 28 + r() * 22;
    const angle = (50 + r() * 60) * deg;
    return { kind: 'tight', length: Math.round(radius * angle), kappa: dir / radius };
  }
  const radius = 14 + r() * 4;
  const angle = (160 + r() * 25) * deg;
  return { kind: 'hairpin', length: Math.round(radius * angle), kappa: dir / radius };
}

export interface TougeOptions {
  seed?: number;
  length?: number;
  summit?: number;
}

export function generateTouge({ seed = 7, length = 4200, summit = 320 }: TougeOptions = {}): Road {
  // Try seeds until one produces a clean layout; each attempt is bounded.
  for (let attempt = 0; attempt < 50; attempt++) {
    const pts = layout(seed + attempt * 7919, length);
    if (pts) {
      const road = withElevation(pts, summit);
      road.lots = placeLots(road);
      furnishLots(road);
      return road;
    }
  }
  throw new Error('could not generate a touge layout');
}

function layout(seed: number, length: number) {
  const r = rng(seed);
  const start = { x: 0, z: 0, yaw: 0 };
  const pieces: Piece[] = [{ kind: 'straight', length: 90, kappa: 0 }];
  let pts = integrate(pieces, start);
  let lastTurn = 1;
  let failures = 0;
  const bound = 750;
  const clearance = 34;

  for (let iter = 0; iter < 4000 && pts.length < length; iter++) {
    const end = pts[pts.length - 1];
    let towards: number | null = null;
    if (Math.hypot(end.x, end.z) > bound * 0.6) {
      // Which way is the centre relative to our heading? Sign of the cross product.
      const fx = -Math.sin(end.yaw);
      const fz = -Math.cos(end.yaw);
      const cross = fx * -end.z - fz * -end.x;
      towards = cross < 0 ? 1 : -1;
    }
    const piece = randomPiece(r, lastTurn, towards);
    const tail = integrate([piece, { kind: 'straight', length: 25, kappa: 0 }], end, pieces[pieces.length - 1].kappa);
    if (isClear(pts, tail, clearance, bound)) {
      pieces.push(piece);
      pts = integrate(pieces, start);
      if (piece.kappa !== 0) lastTurn = Math.sign(piece.kappa);
      failures = 0;
    } else if (++failures > 25) {
      // Dead end: back up a couple of pieces and try something else.
      for (let k = 0; k < 2 && pieces.length > 1; k++) pieces.pop();
      pts = integrate(pieces, start);
      failures = 0;
    }
  }
  if (pts.length < length) return null;
  pieces.push({ kind: 'straight', length: 80, kappa: 0 });
  return integrate(pieces, start);
}

function withElevation(pts: { x: number; z: number; yaw: number; kappa: number }[], summit: number) {
  // Elevation: a descent with varying grade, flat at the start line.
  const samples: RoadSample[] = [];
  let h = summit;
  for (let i = 0; i < pts.length; i++) {
    const s = i;
    const ease = Math.min(1, Math.max(0, (s - 60) / 120));
    const grade = ease * (0.05 + 0.03 * Math.sin(s / 330 + 0.7) + 0.02 * Math.sin(s / 113 + 2.1));
    h -= grade;
    if (s % SAMPLE_STEP === 0) samples.push({ s, x: pts[i].x, z: pts[i].z, h, yaw: pts[i].yaw, kappa: pts[i].kappa });
  }
  return new Road(samples);
}

/** New points must stay inside the map and keep `clearance` from road more than 90 m back. */
function isClear(pts: { x: number; z: number }[], tail: { x: number; z: number }[], clearance: number, bound: number) {
  const c2 = clearance * clearance;
  const limit = pts.length - 90;
  for (let i = 0; i < tail.length; i += 2) {
    const p = tail[i];
    if (Math.hypot(p.x, p.z) > bound) return false;
    // Only the first stretch of the tail is close to the recent road; skip those too.
    const lim = limit + i;
    for (let j = 0; j < Math.min(lim, pts.length); j += 3) {
      const q = pts[j];
      if ((p.x - q.x) ** 2 + (p.z - q.z) ** 2 < c2) return false;
    }
  }
  return true;
}


/**
 * One lot by the start line, then more along the way on the gentler stretches, spaced out so
 * there's one every few minutes of driving.
 */
export function placeLots(road: Road): Lot[] {
  const lots: Lot[] = [{ s0: 6, s1: 62, side: -1, depth: 13 }];
  const len = 60;
  let s = 700;
  let n = 0;
  while (s < road.finishS - 300) {
    // Straightest window of track in the next 300 m.
    let best = -1;
    let bestK = Infinity;
    for (let c = s; c < s + 300; c += 10) {
      let k = 0;
      for (let d = -8; d <= len + 8; d += 4) k = Math.max(k, Math.abs(road.sampleAt(c + d).kappa));
      if (k < bestK) {
        bestK = k;
        best = c;
      }
    }
    const k = road.sampleAt(best + len / 2).kappa;
    // Open on the inside of a gentle curve (the outside is where the rail and the drop are).
    const side: 1 | -1 = Math.abs(k) > 1 / 1000 ? (k > 0 ? 1 : -1) : n % 2 ? 1 : -1;
    if (bestK < 1 / 120 && lotIsClear(road, best, best + len, side, 11)) {
      lots.push({ s0: best, s1: best + len, side, depth: 11 });
      n++;
      s = best + 700;
    } else s += 300;
  }
  return lots;
}

/** A lot's far edge must stay well clear of every other stretch of road. */
function lotIsClear(road: Road, s0: number, s1: number, side: number, depth: number) {
  for (let s = s0; s <= s1; s += 6) {
    const p = road.sampleAt(s);
    const off = side * (road.wallOffset + depth);
    const x = p.x - Math.cos(p.yaw) * off;
    const z = p.z + Math.sin(p.yaw) * off;
    for (const i of road.near(x, z, 30)) {
      const q = road.samples[i];
      if (Math.abs(q.s - s) > 60 && Math.hypot(q.x - x, q.z - z) < 22) return false;
    }
  }
  return true;
}

function hash01(a: number, b: number) {
  const s = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
  return s - Math.floor(s);
}

/** A point beside the road: `offset` metres to the left (negative = right) of the centreline at s. */
export function roadPoint(road: Road, s: number, offset: number) {
  const p = road.sampleAt(s);
  return { x: p.x - Math.cos(p.yaw) * offset, z: p.z + Math.sin(p.yaw) * offset, h: p.h, yaw: p.yaw };
}

/** Lamps along each lot's back edge, parked cars in some bays, vending machines in a few. */
function furnishLots(road: Road) {
  road.lots.forEach((lot, n) => {
    const side = lot.side;
    const outer = road.wallOffset + lot.depth;
    const a = lot.s0 + LOT_RAMP + 1;
    const b = lot.s1 - LOT_RAMP - 1;
    for (let s = a + 1; s < b; s += 18) {
      const p = roadPoint(road, s, side * (outer + 0.55));
      road.props.push({ kind: 'lamp', ...p, yaw: p.yaw, variant: side });
    }
    if (n % 2 === 0) {
      for (let k = 0; k < 2; k++) {
        const p = roadPoint(road, b - 1.2 - k * 1.05, side * (outer - 0.55));
        // Faces the road.
        road.props.push({ kind: 'vending', ...p, yaw: p.yaw - side * (Math.PI / 2), variant: k });
        road.obstacles.push({ x: p.x, z: p.z, r: 0.6 });
      }
    }
    const bays = Math.floor((b - 4 - a) / 3);
    const cars = n === 0 ? 2 : 1;
    for (let c = 0; c < cars; c++) {
      const bay = Math.floor(hash01(n, c + 1) * bays);
      const s = a + 1.5 + bay * 3 + (c > 0 && bay === Math.floor(hash01(n, 1) * bays) ? 3 : 0);
      const p = roadPoint(road, s, side * (outer - 2.6));
      // Nose in, towards the rail.
      const yaw = p.yaw + side * (Math.PI / 2);
      road.props.push({ kind: 'car', ...p, yaw, variant: Math.floor(hash01(n, c + 7) * 1000) });
      for (const d of [-1.2, 1.2]) road.obstacles.push({ x: p.x - Math.sin(yaw) * d, z: p.z - Math.cos(yaw) * d, r: 0.95 });
    }
  });
}
