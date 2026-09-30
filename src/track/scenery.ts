// Terrain shaped around the touge, plus everything drawn along it: asphalt, lines,
// guardrails on the drop side, trees, start and finish gantries, sky and distant peaks.

import * as THREE from 'three';
import { COLORS } from '../cockpit';
import type { Road, RoadSample } from './touge';

function hash(x: number, y: number) {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return s - Math.floor(s);
}

function valueNoise(x: number, y: number) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const a = hash(xi, yi);
  const b = hash(xi + 1, yi);
  const c = hash(xi, yi + 1);
  const d = hash(xi + 1, yi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

const smooth = (t: number) => {
  const x = Math.min(1, Math.max(0, t));
  return x * x * (3 - 2 * x);
};

/** Terrain heights that hug the road and turn into hillside and valley away from it. */
export class Terrain {
  private coarse: RoadSample[];
  constructor(private road: Road) {
    this.coarse = road.samples.filter((_, i) => i % 25 === 0);
  }

  /** Smooth far-field height: inverse-distance blend of the whole road's elevation. */
  private farHeight(x: number, z: number) {
    let sw = 0;
    let sh = 0;
    for (const p of this.coarse) {
      const w = 1 / ((p.x - x) ** 2 + (p.z - z) ** 2 + 80 * 80);
      sw += w;
      sh += w * p.h;
    }
    return sh / sw;
  }

  nearest(x: number, z: number) {
    let best = Infinity;
    let h = 0;
    let sw = 0;
    let sh = 0;
    for (const i of this.road.near(x, z, 110)) {
      const p = this.road.samples[i];
      const d2 = (p.x - x) ** 2 + (p.z - z) ** 2;
      if (d2 < best) {
        best = d2;
        h = p.h;
      }
      const w = 1 / (d2 + 16) ** 1.5;
      sw += w;
      sh += w * p.h;
    }
    return { dist: Math.sqrt(best), h, blend: sw > 0 ? sh / sw : h };
  }

  height(x: number, z: number) {
    const n = this.nearest(x, z);
    const off = n.dist - (this.road.halfWidth + 1.6);
    if (off <= 0) return n.h - 0.25;
    const far = this.farHeight(x, z);
    const t = smooth(off / 20);
    const base = n.dist < Infinity ? n.h + (n.blend - n.h) * t : far;
    const towardFar = smooth((off - 60) / 80);
    // Some sides climb into the mountain, some drop into the valley.
    const side = valueNoise(x / 220 + 3.1, z / 220 - 1.7) * 2 - 1;
    const slope = Math.min(off, 90) * 0.5 * side;
    const bumps = (valueNoise(x / 48, z / 48) - 0.5) * 18 + (valueNoise(x / 14, z / 14) - 0.5) * 3;
    const shaped = base + (slope + bumps) * t - 0.25;
    return shaped + (far - 25 + bumps * 2 - shaped) * towardFar;
  }
}

export interface Scenery {
  terrain: Terrain;
}

export function buildScenery(scene: THREE.Scene, road: Road): Scenery {
  scene.background = COLORS.skyHorizon.clone();
  scene.fog = new THREE.Fog(COLORS.skyHorizon, 160, 1300);

  scene.add(new THREE.HemisphereLight(COLORS.skyTop, new THREE.Color('#b59b74'), 1.6));
  const sun = new THREE.DirectionalLight(new THREE.Color('#fff1dc'), 2.2);
  sun.position.set(-60, 100, 40);
  scene.add(sun);

  const terrain = new Terrain(road);
  const bounds = roadBounds(road, 320);
  scene.add(buildSky());
  scene.add(buildTerrainMesh(terrain, bounds));
  scene.add(buildFarGround(road, bounds));
  scene.add(buildRoadMesh(road));
  scene.add(buildRails(road, terrain));
  scene.add(buildTrees(road, terrain, bounds));
  scene.add(buildGantry(road, road.startS, 'START'));
  scene.add(buildGantry(road, road.finishS, 'FINISH'));
  scene.add(buildMountains(bounds));
  return { terrain };
}

interface Bounds {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

function roadBounds(road: Road, margin: number): Bounds {
  const b = { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity };
  for (const p of road.samples) {
    b.minX = Math.min(b.minX, p.x);
    b.maxX = Math.max(b.maxX, p.x);
    b.minZ = Math.min(b.minZ, p.z);
    b.maxZ = Math.max(b.maxZ, p.z);
  }
  return { minX: b.minX - margin, maxX: b.maxX + margin, minZ: b.minZ - margin, maxZ: b.maxZ + margin };
}

function buildSky() {
  const geo = new THREE.SphereGeometry(2600, 16, 12);
  const pos = geo.attributes.position;
  const colors: number[] = [];
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i) / 2600;
    c.copy(COLORS.skyHorizon).lerp(COLORS.skyTop, Math.min(1, Math.max(0, y * 2.2)));
    colors.push(c.r, c.g, c.b);
  }
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  const mat = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false });
  const sky = new THREE.Mesh(geo, mat);
  sky.renderOrder = -1;
  sky.frustumCulled = false;
  sky.onBeforeRender = (_r, _s, camera) => sky.position.copy(camera.position);
  return sky;
}

function buildTerrainMesh(terrain: Terrain, b: Bounds) {
  const cell = 9;
  const nx = Math.ceil((b.maxX - b.minX) / cell);
  const nz = Math.ceil((b.maxZ - b.minZ) / cell);
  const heights = new Float32Array((nx + 1) * (nz + 1));
  for (let j = 0; j <= nz; j++)
    for (let i = 0; i <= nx; i++) {
      // Jitter vertices a little so the grid doesn't read as a grid.
      const x = b.minX + i * cell + (hash(i, j) - 0.5) * cell * 0.5;
      const z = b.minZ + j * cell + (hash(j, i + 7) - 0.5) * cell * 0.5;
      heights[j * (nx + 1) + i] = terrain.height(x, z);
    }
  const pos: number[] = [];
  const col: number[] = [];
  const c = new THREE.Color();
  const vx = (i: number, j: number) => b.minX + i * cell + (hash(i, j) - 0.5) * cell * 0.5;
  const vz = (i: number, j: number) => b.minZ + j * cell + (hash(j, i + 7) - 0.5) * cell * 0.5;
  const tri = (a: number[], bb: number[], cc: number[]) => {
    const pts = [a, bb, cc].map(([i, j]) => [vx(i, j), heights[j * (nx + 1) + i], vz(i, j)]);
    pos.push(...pts[0], ...pts[1], ...pts[2]);
    // Colour by steepness: grass on gentle ground, rock on steep faces.
    const e1 = new THREE.Vector3(pts[1][0] - pts[0][0], pts[1][1] - pts[0][1], pts[1][2] - pts[0][2]);
    const e2 = new THREE.Vector3(pts[2][0] - pts[0][0], pts[2][1] - pts[0][1], pts[2][2] - pts[0][2]);
    const ny = Math.abs(e1.cross(e2).normalize().y);
    const cx = (pts[0][0] + pts[1][0] + pts[2][0]) / 3;
    const cz = (pts[0][2] + pts[1][2] + pts[2][2]) / 3;
    if (ny < 0.72) c.set('#8f8a80').lerp(new THREE.Color('#a39d92'), hash(cx, cz));
    else c.copy(COLORS.grass).lerp(COLORS.grassDark, hash(Math.floor(cx), Math.floor(cz)) * 0.8);
    for (let k = 0; k < 3; k++) col.push(c.r, c.g, c.b);
  };
  for (let j = 0; j < nz; j++)
    for (let i = 0; i < nx; i++) {
      tri([i, j], [i, j + 1], [i + 1, j]);
      tri([i + 1, j], [i, j + 1], [i + 1, j + 1]);
    }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.computeVertexNormals();
  return new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }));
}

function buildFarGround(road: Road, b: Bounds) {
  const minH = Math.min(...road.samples.map((p) => p.h));
  const geo = new THREE.PlaneGeometry(9000, 9000).rotateX(-Math.PI / 2);
  const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ color: COLORS.grassDark }));
  mesh.position.set((b.minX + b.maxX) / 2, minH - 60, (b.minZ + b.maxZ) / 2);
  return mesh;
}

/** A strip of the road surface between two lateral offsets, as triangles. */
function strip(road: Road, o1: number, o2: number, lift: number, include?: (s: number) => boolean) {
  const out: number[] = [];
  const s = road.samples;
  for (let i = 0; i < s.length - 1; i++) {
    if (include && !include(s[i].s)) continue;
    const a = s[i];
    const b = s[i + 1];
    const pa1 = at(a, o1, lift);
    const pa2 = at(a, o2, lift);
    const pb1 = at(b, o1, lift);
    const pb2 = at(b, o2, lift);
    out.push(...pa1, ...pb1, ...pa2, ...pa2, ...pb1, ...pb2);
  }
  return out;
}

function at(p: RoadSample, offset: number, lift: number) {
  return [p.x - Math.cos(p.yaw) * offset, p.h + lift, p.z + Math.sin(p.yaw) * offset];
}

function meshFrom(positions: number[], color: THREE.ColorRepresentation) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.computeVertexNormals();
  return new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ color, side: THREE.DoubleSide }));
}

function buildRoadMesh(road: Road) {
  const g = new THREE.Group();
  const w = road.halfWidth;
  g.add(meshFrom(strip(road, -w, w, 0), COLORS.road));
  g.add(meshFrom([...strip(road, w, road.wallOffset + 0.3, -0.02), ...strip(road, -road.wallOffset - 0.3, -w, -0.02)], '#8c8577'));
  g.add(meshFrom([...strip(road, w - 0.35, w - 0.2, 0.02), ...strip(road, -w + 0.2, -w + 0.35, 0.02)], COLORS.line));
  g.add(meshFrom(strip(road, -0.08, 0.08, 0.02, (s) => Math.floor(s / 6) % 2 === 0), COLORS.line));
  // Start and finish lines.
  for (const s0 of [road.startS, road.finishS]) {
    const sub = { ...road, samples: [road.sampleAt(s0), road.sampleAt(s0 + 1.2)] } as Road;
    g.add(meshFrom(strip(sub, -w, w, 0.025), COLORS.line));
  }
  return g;
}

function buildRails(road: Road, terrain: Terrain) {
  const postGeo = new THREE.BoxGeometry(0.1, 0.75, 0.1);
  const beamGeo = new THREE.BoxGeometry(0.06, 0.28, 1);
  const mat = new THREE.MeshLambertMaterial({ color: '#d9d6cf' });
  const posts: THREE.Matrix4[] = [];
  const beams: THREE.Matrix4[] = [];
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const off = road.wallOffset + 0.15;
  const s = road.samples;
  for (let i = 0; i + 2 < s.length; i += 2) {
    const a = s[i];
    const b = s[i + 2];
    for (const side of [-1, 1]) {
      // Rails where the ground falls away and on the outside of tighter corners.
      const [tx, , tz] = at(a, side * (road.halfWidth + 12), 0);
      const drop = terrain.height(tx, tz) < a.h - 1.5;
      const outside = side === -Math.sign(a.kappa) && Math.abs(a.kappa) > 1 / 70;
      if (!drop && !outside) continue;
      const pa = at(a, side * off, 0);
      const pb = at(b, side * off, 0);
      q.setFromAxisAngle(up, a.yaw);
      posts.push(new THREE.Matrix4().compose(new THREE.Vector3(pa[0], pa[1] + 0.37, pa[2]), q, new THREE.Vector3(1, 1, 1)));
      const dx = pb[0] - pa[0];
      const dy = pb[1] - pa[1];
      const dz = pb[2] - pa[2];
      const len = Math.hypot(dx, dy, dz);
      const beamQ = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), new THREE.Vector3(dx, dy, dz).normalize());
      beams.push(
        new THREE.Matrix4().compose(
          new THREE.Vector3((pa[0] + pb[0]) / 2, (pa[1] + pb[1]) / 2 + 0.6, (pa[2] + pb[2]) / 2),
          beamQ,
          new THREE.Vector3(1, 1, len + 0.05),
        ),
      );
    }
  }
  const g = new THREE.Group();
  const ip = new THREE.InstancedMesh(postGeo, mat, Math.max(1, posts.length));
  posts.forEach((m, i) => ip.setMatrixAt(i, m));
  ip.count = posts.length;
  const ib = new THREE.InstancedMesh(beamGeo, mat, Math.max(1, beams.length));
  beams.forEach((m, i) => ib.setMatrixAt(i, m));
  ib.count = beams.length;
  g.add(ip, ib);
  return g;
}

function buildTrees(road: Road, terrain: Terrain, b: Bounds) {
  const group = new THREE.Group();
  const trunkGeo = new THREE.CylinderGeometry(0.18, 0.25, 1.6, 5);
  const crownGeo = new THREE.ConeGeometry(1.6, 4.2, 6);
  const roundGeo = new THREE.IcosahedronGeometry(1.8, 0);
  const trunkMat = new THREE.MeshLambertMaterial({ color: '#7a5a3f', flatShading: true });
  const pineMat = new THREE.MeshLambertMaterial({ color: '#4f7f4a', flatShading: true });
  const leafMat = new THREE.MeshLambertMaterial({ color: '#6f9d4b', flatShading: true });
  const N = 5000;
  const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, N);
  const pines = new THREE.InstancedMesh(crownGeo, pineMat, N);
  const rounds = new THREE.InstancedMesh(roundGeo, leafMat, N);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  let t = 0;
  let p = 0;
  let r = 0;
  for (let i = 0; i < N * 3 && t < N; i++) {
    const x = b.minX + hash(i, 2) * (b.maxX - b.minX);
    const z = b.minZ + hash(i, 3) * (b.maxZ - b.minZ);
    // Forests come in clumps.
    if (valueNoise(x / 90, z / 90) < 0.45) continue;
    const near = terrain.nearest(x, z);
    if (near.dist < road.wallOffset + 4) continue;
    const y = terrain.height(x, z);
    const sc = 0.7 + hash(i, 4) * 0.8;
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), hash(i, 5) * 6.28);
    const s = new THREE.Vector3(sc, sc, sc);
    m.compose(new THREE.Vector3(x, y + 0.8 * sc, z), q, s);
    trunks.setMatrixAt(t++, m);
    if (hash(i, 6) > 0.35) {
      m.compose(new THREE.Vector3(x, y + 3.4 * sc, z), q, s);
      pines.setMatrixAt(p++, m);
    } else {
      m.compose(new THREE.Vector3(x, y + 3 * sc, z), q, s);
      rounds.setMatrixAt(r++, m);
    }
  }
  trunks.count = t;
  pines.count = p;
  rounds.count = r;
  group.add(trunks, pines, rounds);
  return group;
}

function buildGantry(road: Road, s: number, label: string) {
  const p = road.sampleAt(s);
  const g = new THREE.Group();
  const mat = new THREE.MeshLambertMaterial({ color: '#2b2d33', flatShading: true });
  const span = road.wallOffset + 0.6;
  for (const side of [-1, 1]) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.25, 5.2, 0.25), mat);
    post.position.set(side * span, 2.6, 0);
    g.add(post);
  }
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 64;
  const ctx = canvas.getContext('2d')!;
  for (let i = 0; i < 32; i++) {
    ctx.fillStyle = i % 2 ? '#16171b' : '#f4f1e8';
    ctx.fillRect(i * 16, 0, 16, 10);
    ctx.fillStyle = i % 2 ? '#f4f1e8' : '#16171b';
    ctx.fillRect(i * 16, 54, 16, 10);
  }
  ctx.fillStyle = '#e4573d';
  ctx.fillRect(0, 10, 512, 44);
  ctx.fillStyle = '#f4f1e8';
  ctx.font = '700 34px Inter, system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, 256, 33);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const banner = new THREE.Mesh(
    new THREE.BoxGeometry(span * 2 + 0.25, 1.1, 0.12),
    new THREE.MeshLambertMaterial({ map: tex }),
  );
  banner.position.set(0, 5.1, 0);
  g.add(banner);
  g.position.set(p.x, p.h, p.z);
  g.rotation.y = p.yaw;
  return g;
}

function buildMountains(b: Bounds) {
  const group = new THREE.Group();
  const mat = new THREE.MeshLambertMaterial({ color: '#9fb0c4', flatShading: true, fog: false });
  const snow = new THREE.MeshLambertMaterial({ color: '#eef0f2', flatShading: true, fog: false });
  const cx = (b.minX + b.maxX) / 2;
  const cz = (b.minZ + b.maxZ) / 2;
  for (let i = 0; i < 30; i++) {
    const a = (i / 30) * Math.PI * 2 + hash(i, 8) * 0.2;
    const d = 2100 + hash(i, 9) * 300;
    const h = 260 + hash(i, 10) * 420;
    const geo = new THREE.ConeGeometry(h * 1.3, h, 5 + Math.floor(hash(i, 11) * 3));
    const mtn = new THREE.Mesh(geo, mat);
    mtn.position.set(cx + Math.cos(a) * d, h / 2 - 40, cz + Math.sin(a) * d);
    mtn.rotation.y = hash(i, 12) * 3;
    group.add(mtn);
    if (h > 450) {
      const cap = new THREE.Mesh(new THREE.ConeGeometry(h * 0.33, h * 0.25, geo.parameters.radialSegments), snow);
      cap.position.set(0, h * 0.375 + 0.5, 0);
      mtn.add(cap);
    }
  }
  return group;
}
