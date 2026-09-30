// Terrain shaped around the touge, plus everything drawn along it: asphalt, lines,
// guardrails on the drop side, trees, start and finish gantries, sky and distant peaks.

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { COLORS } from '../cockpit';
import { LOT_RAMP, type Road, type RoadSample } from './touge';
import type { DayTargets } from './daylight';
import { CARS } from '../cars';
import { buildCarModel } from '../ui/carModel';

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

const ROCK = new THREE.Color('#8b867c');
const ROCK_LIGHT = new THREE.Color('#a8a296');
const GRASS = new THREE.Color('#8dbd58');
const GRASS_DARK = new THREE.Color('#679a45');
const DRY_GRASS = new THREE.Color('#aeb162');

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
    let bestI = -1;
    let h = 0;
    let sw = 0;
    let sh = 0;
    for (const i of this.road.near(x, z, 110)) {
      const p = this.road.samples[i];
      const d2 = (p.x - x) ** 2 + (p.z - z) ** 2;
      if (d2 < best) {
        best = d2;
        bestI = i;
        h = p.h;
      }
      const w = 1 / (d2 + 16) ** 1.5;
      sw += w;
      sh += w * p.h;
    }
    return { dist: Math.sqrt(best), h, blend: sw > 0 ? sh / sw : h, index: bestI };
  }

  /** Which side of the road a point is on (1 = left), and how far a lot widens the flat there. */
  lotAt(x: number, z: number, index: number) {
    if (index < 0) return 0;
    const p = this.road.samples[index];
    const side = (x - p.x) * -Math.cos(p.yaw) + (z - p.z) * Math.sin(p.yaw) > 0 ? 1 : -1;
    return this.road.lotDepth(p.s, side);
  }

  height(x: number, z: number) {
    const n = this.nearest(x, z);
    const off = n.dist - (this.road.halfWidth + 1.6) - this.lotAt(x, z, n.index);
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
  sun: THREE.DirectionalLight;
  /** Sky and ground only, baked into reflections. */
  envScene: THREE.Scene;
  day: DayTargets;
}

/** Direction from the ground towards the sun: a warm mid-afternoon sun, low enough for long shadows. */
export const SUN_DIR = new THREE.Vector3(-0.55, 0.62, 0.42).normalize();
const SUN_COLOR = new THREE.Color('#ffe6c4');

export function buildScenery(scene: THREE.Scene, road: Road): Scenery {
  scene.background = COLORS.skyHorizon.clone();
  scene.fog = new THREE.Fog(COLORS.skyHorizon, 220, 1500);

  // The sky is also baked into an environment map (see bakeEnvironment), so the
  // hemisphere light only has to fill in a little.
  const hemi = new THREE.HemisphereLight(COLORS.skyTop, new THREE.Color('#9c8a66'), 1.0);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(SUN_COLOR, 3.1);
  sun.position.copy(SUN_DIR).multiplyScalar(200);
  scene.add(sun);

  const terrain = new Terrain(road);
  const bounds = roadBounds(road, 320);
  const sky = buildSky();
  const env = buildEnvironmentScene();
  const mountains = buildMountains(bounds);
  const clouds = buildClouds(bounds);
  const lots = buildLots(road);
  scene.add(sky);
  scene.add(buildTerrainMesh(terrain, bounds));
  scene.add(buildFarGround(road, bounds));
  scene.add(buildRoadMesh(road));
  scene.add(lots.group);
  scene.add(buildRails(road, terrain));
  scene.add(buildDelineators(road, terrain));
  scene.add(buildChevrons(road));
  scene.add(buildTrees(road, terrain, bounds));
  scene.add(buildRocks(road, terrain, bounds));
  scene.add(buildGantry(road, road.startS, 'START'));
  scene.add(buildGantry(road, road.finishS, 'FINISH'));
  scene.add(mountains.group);
  scene.add(clouds);
  return {
    terrain,
    sun,
    envScene: env.scene,
    day: {
      scene,
      sun,
      hemi,
      skies: [sky.material as THREE.ShaderMaterial, env.sky],
      haze: mountains.haze,
      clouds: clouds.material as THREE.MeshStandardMaterial,
      lamps: [lots.lamp, REFLECTOR, CHEVRON],
      pools: [lots.pool],
      envGround: env.ground,
    },
  };
}

/** A small scene of just sky and ground, baked into reflections and ambient light. */
function buildEnvironmentScene() {
  const scene = new THREE.Scene();
  const sky = skyMaterial();
  scene.add(new THREE.Mesh(new THREE.SphereGeometry(100, 32, 16), sky));
  const ground = new THREE.MeshBasicMaterial({ color: '#5e5d4c' });
  const disc = new THREE.Mesh(new THREE.CircleGeometry(100, 24).rotateX(-Math.PI / 2), ground);
  disc.position.y = -2;
  scene.add(disc);
  return { scene, sky, ground };
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

/** Sky gradient with a haze band at the horizon, a glow around the sun and the sun's disc. */
function skyMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: {
      top: { value: new THREE.Color('#5d9bd0') },
      horizon: { value: COLORS.skyHorizon.clone() },
      sunDir: { value: SUN_DIR.clone() },
      sunColor: { value: SUN_COLOR.clone() },
      stars: { value: 0 },
    },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 top;
      uniform vec3 horizon;
      uniform vec3 sunDir;
      uniform vec3 sunColor;
      uniform float stars;
      varying vec3 vDir;
      float starHash(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
      void main() {
        vec3 d = normalize(vDir);
        float y = max(d.y, 0.0);
        vec3 col = mix(horizon, top, pow(min(1.0, y * 2.4), 0.65));
        float s = max(dot(d, sunDir), 0.0);
        col += sunColor * (pow(s, 6.0) * 0.18 + pow(s, 48.0) * 0.45);
        col += sunColor * smoothstep(0.9993, 0.9997, s) * 6.0;
        if (stars > 0.01) {
          vec3 g = d * 260.0;
          vec3 cell = floor(g);
          float h = starHash(cell);
          float spot = smoothstep(0.32, 0.08, length(fract(g) - 0.5));
          float twinkle = 0.5 + 0.5 * starHash(cell + 3.0);
          col += vec3(0.9, 0.93, 1.0) * step(0.997, h) * spot * twinkle * stars * smoothstep(0.02, 0.2, d.y) * 1.6;
        }
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
  });
}

function buildSky() {
  const sky = new THREE.Mesh(new THREE.SphereGeometry(2600, 32, 16), skyMaterial());
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
    const jitter = 0.94 + hash(Math.floor(cx * 3), Math.floor(cz * 3)) * 0.1;
    if (ny < 0.72) {
      c.copy(ROCK).lerp(ROCK_LIGHT, hash(cx, cz));
    } else {
      // Meadows in patches: lush, darker and sun-dried grass blend over tens of metres.
      c.copy(GRASS).lerp(GRASS_DARK, smooth((valueNoise(cx / 70, cz / 70) - 0.35) * 2.5));
      c.lerp(DRY_GRASS, smooth((valueNoise(cx / 45 + 9, cz / 45 - 4) - 0.6) * 3) * 0.55);
      // Steeper grass fades towards rock.
      c.lerp(ROCK, smooth((0.9 - ny) / 0.18) * 0.35);
    }
    c.multiplyScalar(jitter);
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
  const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.95 }));
  mesh.receiveShadow = true;
  mesh.castShadow = true;
  return mesh;
}

function buildFarGround(road: Road, b: Bounds) {
  const minH = Math.min(...road.samples.map((p) => p.h));
  const geo = new THREE.PlaneGeometry(9000, 9000).rotateX(-Math.PI / 2);
  const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: COLORS.grassDark, roughness: 1 }));
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

function meshFrom(positions: number[], color: THREE.ColorRepresentation, roughness = 0.9) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color, roughness, side: THREE.DoubleSide }));
  mesh.receiveShadow = true;
  return mesh;
}

/**
 * The asphalt, split into lanes across its width so it can be shaded: darker, smoother
 * wheel tracks where cars run, lighter patches of repair, and a worn crown.
 */
function asphalt(road: Road) {
  const w = road.halfWidth;
  // Laid out for a 3.6 m half-width and scaled to the actual road.
  const k = w / 3.6;
  const offsets = [-3.6, -3.0, -2.55, -2.1, -1.35, -0.9, -0.45, 0, 0.45, 0.9, 1.35, 2.1, 2.55, 3.0, 3.6].map((o) => o * k);
  const wheelTrack = (o: number) => {
    const a = Math.abs(o) / k;
    // Each lane's two wheel paths sit about 0.75 m either side of its centre (1.8 m).
    return Math.max(0, 1 - Math.abs(a - 1.05) / 0.4) + Math.max(0, 1 - Math.abs(a - 2.55) / 0.4);
  };
  const pos: number[] = [];
  const col: number[] = [];
  const s = road.samples;
  const c = new THREE.Color();
  const shade = (p: RoadSample, o: number) => {
    const patch = smooth((valueNoise(p.s / 26, o / 2.2 + 5) - 0.62) * 5) * 0.14;
    const grain = (hash(Math.floor(p.s / 2), Math.floor(o * 2)) - 0.5) * 0.04;
    c.copy(COLORS.road).multiplyScalar(1 - wheelTrack(o) * 0.12 + patch + grain);
    return [c.r, c.g, c.b];
  };
  for (let i = 0; i < s.length - 1; i++) {
    const a = s[i];
    const b = s[i + 1];
    for (let k = 0; k < offsets.length - 1; k++) {
      const o1 = offsets[k];
      const o2 = offsets[k + 1];
      pos.push(...at(a, o1, 0), ...at(b, o1, 0), ...at(a, o2, 0), ...at(a, o2, 0), ...at(b, o1, 0), ...at(b, o2, 0));
      col.push(...shade(a, o1), ...shade(b, o1), ...shade(a, o2), ...shade(a, o2), ...shade(b, o1), ...shade(b, o2));
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.82, side: THREE.DoubleSide }));
  mesh.receiveShadow = true;
  return mesh;
}

function buildRoadMesh(road: Road) {
  const g = new THREE.Group();
  const w = road.halfWidth;
  g.add(asphalt(road));
  g.add(meshFrom([...strip(road, w, road.wallOffset + 0.3, -0.02), ...strip(road, -road.wallOffset - 0.3, -w, -0.02)], '#8c8577', 1));
  // A darker gutter where the asphalt meets the gravel.
  g.add(meshFrom([...strip(road, w, w + 0.35, -0.01), ...strip(road, -w - 0.35, -w, -0.01)], '#5f5a52', 1));
  g.add(meshFrom([...strip(road, w - 0.35, w - 0.2, 0.02), ...strip(road, -w + 0.2, -w + 0.35, 0.02)], COLORS.line, 0.55));
  g.add(meshFrom(strip(road, -0.08, 0.08, 0.02, (s) => Math.floor(s / 6) % 2 === 0), COLORS.line, 0.55));
  // Start and finish lines.
  for (const s0 of [road.startS, road.finishS]) {
    const sub = { ...road, samples: [road.sampleAt(s0), road.sampleAt(s0 + 1.2)] } as Road;
    g.add(meshFrom(strip(sub, -w, w, 0.025), COLORS.line, 0.55));
  }
  return g;
}

function buildRails(road: Road, terrain: Terrain) {
  const postGeo = new THREE.BoxGeometry(0.1, 0.75, 0.1);
  const beamGeo = new THREE.BoxGeometry(0.06, 0.28, 1);
  const mat = new THREE.MeshStandardMaterial({ color: '#d4d6d8', metalness: 0.65, roughness: 0.38 });
  const posts: THREE.Matrix4[] = [];
  const beams: THREE.Matrix4[] = [];
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const off = road.wallOffset + 0.15;
  const refl: THREE.Matrix4[] = [];
  const s = road.samples;
  for (let i = 0; i + 2 < s.length; i += 2) {
    const a = s[i];
    const b = s[i + 2];
    for (const side of [-1, 1]) {
      // Rails where the ground falls away, on the outside of corners, and round every lot.
      const lotA = road.lotDepth(a.s, side);
      const lotB = road.lotDepth(b.s, side);
      if (!lotA && !lotB && !hasRail(road, terrain, a, side)) continue;
      const pa = at(a, side * (off + lotA), 0);
      const pb = at(b, side * (off + lotB), 0);
      q.setFromAxisAngle(up, a.yaw);
      posts.push(new THREE.Matrix4().compose(new THREE.Vector3(pa[0], pa[1] + 0.37, pa[2]), q, new THREE.Vector3(1, 1, 1)));
      // A reflector on every other post catches the headlights.
      if (i % 4 === 0) refl.push(new THREE.Matrix4().compose(new THREE.Vector3(pa[0] - Math.cos(a.yaw) * side * -0.06, pa[1] + 0.6, pa[2] + Math.sin(a.yaw) * side * -0.06), q, new THREE.Vector3(1, 1, 1)));
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
  for (const m of [ip, ib]) {
    m.castShadow = true;
    m.receiveShadow = true;
  }
  const ir = new THREE.InstancedMesh(new THREE.BoxGeometry(0.02, 0.1, 0.16), REFLECTOR, Math.max(1, refl.length));
  refl.forEach((m, i) => ir.setMatrixAt(i, m));
  ir.count = refl.length;
  g.add(ip, ib, ir);
  return g;
}

/** Amber reflectors: they glow a little by day and brightly at night. */
const REFLECTOR = new THREE.MeshStandardMaterial({ color: '#ff9a2e', emissive: '#ff7a10', emissiveIntensity: 0.9, roughness: 0.3 });

/** Rails where the ground falls away and on the outside of tighter corners. */
function hasRail(road: Road, terrain: Terrain, a: RoadSample, side: number) {
  const [tx, , tz] = at(a, side * (road.halfWidth + 12), 0);
  const drop = terrain.height(tx, tz) < a.h - 0.8;
  const outside = side === -Math.sign(a.kappa) && Math.abs(a.kappa) > 1 / 110;
  return drop || outside;
}

/**
 * The lots: a paved apron off the road with parking bays, lamps along the back and, in some,
 * a parked car or a pair of vending machines.
 */
function buildLots(road: Road) {
  const g = new THREE.Group();
  const surface: number[] = [];
  const lines: number[] = [];
  const quad = (out: number[], a: number[], b: number[], c: number[], d: number[]) => out.push(...a, ...b, ...c, ...c, ...b, ...d);
  for (const lot of road.lots) {
    const side = lot.side;
    const outer = (p: RoadSample) => road.wallOffset + road.lotDepth(p.s, side) + 0.3;
    for (let i = 0; i < road.samples.length - 1; i++) {
      const a = road.samples[i];
      const b = road.samples[i + 1];
      if (b.s < lot.s0 || a.s > lot.s1) continue;
      const inner = road.halfWidth + 0.3;
      quad(surface, at(a, side * inner, 0.01), at(b, side * inner, 0.01), at(a, side * outer(a), 0.01), at(b, side * outer(b), 0.01));
    }
    // Bays: short lines out from the back edge every 3 m, and one along their fronts.
    const full = road.wallOffset + lot.depth;
    const s0 = lot.s0 + LOT_RAMP + 1;
    const s1 = lot.s1 - LOT_RAMP - 1;
    for (let s = s0; s <= s1 - 4 + 0.01; s += 3) {
      const p = road.sampleAt(s);
      const q = road.sampleAt(s + 0.12);
      quad(lines, at(p, side * (full - 5.2), 0.02), at(q, side * (full - 5.2), 0.02), at(p, side * (full - 0.2), 0.02), at(q, side * (full - 0.2), 0.02));
    }
    for (let s = s0; s < s1 - 4; s += 1) {
      const p = road.sampleAt(s);
      const q = road.sampleAt(Math.min(s + 1, s1 - 4));
      quad(lines, at(p, side * (full - 5.3), 0.02), at(q, side * (full - 5.3), 0.02), at(p, side * (full - 5.18), 0.02), at(q, side * (full - 5.18), 0.02));
    }
  }
  const pave = meshFrom(surface, new THREE.Color(COLORS.road).multiplyScalar(1.12), 0.85);
  pave.renderOrder = 1;
  g.add(pave, meshFrom(lines, COLORS.line, 0.55));

  const lamp = new THREE.MeshStandardMaterial({ color: '#fff4d6', emissive: '#ffd89a', emissiveIntensity: 0.15, roughness: 0.4 });
  // A soft round glow texture, so each pool fades out at its edge.
  const glow = document.createElement('canvas');
  glow.width = glow.height = 64;
  const gctx = glow.getContext('2d')!;
  const grad = gctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  // Drawn white-to-black: with additive blending black adds nothing, so the edge fades away.
  grad.addColorStop(0, '#ffffff');
  grad.addColorStop(0.4, '#6a6a6a');
  grad.addColorStop(1, '#000000');
  gctx.fillStyle = grad;
  gctx.fillRect(0, 0, 64, 64);
  const glowTex = new THREE.CanvasTexture(glow);
  glowTex.colorSpace = THREE.SRGBColorSpace;
  const pool = new THREE.MeshBasicMaterial({ color: '#ffc27a', map: glowTex, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending });
  const steel = new THREE.MeshStandardMaterial({ color: '#8d9297', metalness: 0.6, roughness: 0.45 });
  const machineBody = [new THREE.MeshStandardMaterial({ color: '#c8302c', roughness: 0.5 }), new THREE.MeshStandardMaterial({ color: '#2d6fc2', roughness: 0.5 })];
  const poolGeo = new THREE.PlaneGeometry(11, 11).rotateX(-Math.PI / 2);
  const paints = ['#e8e4dc', '#1d1f24', '#b8342c', '#8a9aa6', '#2f5d8a', '#d9b43a'];
  for (const prop of road.props) {
    const o = new THREE.Group();
    o.position.set(prop.x, prop.h, prop.z);
    o.rotation.y = prop.yaw;
    if (prop.kind === 'lamp') {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.1, 5.4, 6), steel);
      post.position.y = 2.7;
      // The arm reaches back over the lot (towards the road side).
      // Local +x is the road's right; the lamp leans out towards the road.
      const reach = prop.variant;
      const arm = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.08, 0.08), steel);
      arm.position.set(reach * 0.75, 5.35, 0);
      const head = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.12, 0.3), lamp);
      head.position.set(reach * 1.45, 5.28, 0);
      const light = new THREE.Mesh(poolGeo, pool);
      light.position.set(reach * 3, 0.04, 0);
      light.renderOrder = 2;
      o.add(post, arm, head, light);
    } else if (prop.kind === 'vending') {
      // Front faces local -z (the prop's heading).
      const body = new THREE.Mesh(new THREE.BoxGeometry(0.95, 1.85, 0.75), machineBody[prop.variant % 2]);
      body.position.y = 0.925;
      const front = new THREE.Mesh(new THREE.BoxGeometry(0.78, 1.1, 0.02), lamp);
      front.position.set(0, 1.2, -0.38);
      const slot = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.2, 0.03), new THREE.MeshStandardMaterial({ color: '#15161a' }));
      slot.position.set(0, 0.35, -0.38);
      o.add(body, front, slot);
    } else {
      const model = CARS[prop.variant % CARS.length];
      const car = buildCarModel(model.body, new THREE.Color(paints[prop.variant % paints.length]));
      o.add(car.group);
    }
    o.traverse((m) => {
      if (m instanceof THREE.Mesh && m.material !== pool) {
        m.castShadow = true;
        m.receiveShadow = true;
      }
    });
    g.add(o);
  }
  return { group: g, lamp, pool };
}

/** Yellow-and-black chevron boards on the outside of the tight corners. */
const CHEVRON = new THREE.MeshStandardMaterial({ roughness: 0.6, emissive: '#ffffff', emissiveIntensity: 0.15, side: THREE.DoubleSide });
function buildChevrons(road: Road) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 64;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#f2c230';
  ctx.fillRect(0, 0, 64, 64);
  ctx.fillStyle = '#16171b';
  // An arrow pointing right: the corner turns that way (mirrored for left-handers).
  ctx.beginPath();
  ctx.moveTo(16, 6);
  ctx.lineTo(40, 32);
  ctx.lineTo(16, 58);
  ctx.lineTo(28, 58);
  ctx.lineTo(52, 32);
  ctx.lineTo(28, 6);
  ctx.closePath();
  ctx.fill();
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  CHEVRON.map = tex;
  CHEVRON.emissiveMap = tex;
  const board = new THREE.BoxGeometry(0.7, 0.7, 0.04);
  const postGeo = new THREE.BoxGeometry(0.07, 1.25, 0.07);
  const post = new THREE.MeshStandardMaterial({ color: '#6a6d72', roughness: 0.6 });
  const boards: THREE.Matrix4[] = [];
  const posts: THREE.Matrix4[] = [];
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  for (let i = 0; i < road.samples.length; i += 5) {
    const a = road.samples[i];
    if (Math.abs(a.kappa) < 1 / 45) continue;
    const turn = Math.sign(a.kappa); // 1 = left-hander
    const side = -turn; // the outside
    if (road.lotDepth(a.s, side) > 0) continue;
    const [x, y, z] = at(a, side * (road.wallOffset + 0.55), 0);
    q.setFromAxisAngle(up, a.yaw);
    // Face back down the road; mirror the arrow for left-handers.
    boards.push(new THREE.Matrix4().compose(new THREE.Vector3(x, y + 1.25, z), q, new THREE.Vector3(-turn, 1, 1)));
    posts.push(new THREE.Matrix4().compose(new THREE.Vector3(x, y + 0.62, z + 0), q, new THREE.Vector3(1, 1, 1)));
  }
  const g = new THREE.Group();
  const ib = new THREE.InstancedMesh(board, CHEVRON, Math.max(1, boards.length));
  boards.forEach((m, i) => ib.setMatrixAt(i, m));
  ib.count = boards.length;
  const ip = new THREE.InstancedMesh(postGeo, post, Math.max(1, posts.length));
  posts.forEach((m, i) => ip.setMatrixAt(i, m));
  ip.count = posts.length;
  ib.castShadow = ip.castShadow = true;
  g.add(ib, ip);
  return g;
}

/** White marker posts with amber reflectors along the verge wherever there's no rail. */
function buildDelineators(road: Road, terrain: Terrain) {
  const postGeo = new THREE.BoxGeometry(0.1, 0.95, 0.1);
  const capGeo = new THREE.BoxGeometry(0.105, 0.14, 0.105);
  const reflGeo = new THREE.BoxGeometry(0.06, 0.12, 0.112);
  const post = new THREE.MeshStandardMaterial({ color: '#f1efe9', roughness: 0.6 });
  const cap = new THREE.MeshStandardMaterial({ color: '#1c1d20', roughness: 0.6 });
  const refl = REFLECTOR;
  const mats: THREE.Matrix4[] = [];
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  // Close together, so they flick past and you feel the speed.
  for (let i = 0; i < road.samples.length; i += 6) {
    const a = road.samples[i];
    for (const side of [-1, 1]) {
      if (road.lotDepth(a.s, side) > 0 || hasRail(road, terrain, a, side)) continue;
      const p = at(a, side * (road.wallOffset + 0.05), 0);
      q.setFromAxisAngle(up, a.yaw);
      mats.push(new THREE.Matrix4().compose(new THREE.Vector3(p[0], p[1], p[2]), q, new THREE.Vector3(1, 1, 1)));
    }
  }
  const g = new THREE.Group();
  const parts: [THREE.BufferGeometry, THREE.Material, number][] = [
    [postGeo, post, 0.47],
    [capGeo, cap, 0.88],
    [reflGeo, refl, 0.84],
  ];
  const m = new THREE.Matrix4();
  for (const [geo, mat, y] of parts) {
    const im = new THREE.InstancedMesh(geo, mat, Math.max(1, mats.length));
    const lift = new THREE.Matrix4().makeTranslation(0, y, 0);
    mats.forEach((base, i) => im.setMatrixAt(i, m.multiplyMatrices(base, lift)));
    im.count = mats.length;
    im.castShadow = true;
    g.add(im);
  }
  return g;
}

/** A pine as three stacked cones, so it reads as a tree rather than a single spike. */
function pineGeometry() {
  const tiers = [
    [1.6, 2.1, -1.1],
    [1.25, 1.9, 0.05],
    [0.85, 1.7, 1.15],
  ].map(([r, h, y]) => new THREE.ConeGeometry(r, h, 7).translate(0, y, 0).toNonIndexed());
  const geo = mergeGeometries(tiers)!;
  geo.computeVertexNormals();
  return geo;
}

function buildTrees(road: Road, terrain: Terrain, b: Bounds) {
  const group = new THREE.Group();
  const trunkGeo = new THREE.CylinderGeometry(0.18, 0.25, 1.6, 5);
  const crownGeo = pineGeometry();
  const roundGeo = new THREE.IcosahedronGeometry(1.8, 1);
  // Squash the broadleaf crowns a little and rough them up so each facet catches light differently.
  const rp = roundGeo.attributes.position;
  for (let i = 0; i < rp.count; i++) {
    const x = rp.getX(i);
    const y = rp.getY(i);
    const z = rp.getZ(i);
    const k = 0.88 + hash(Math.round(x * 10), Math.round(y * 10 + z * 7)) * 0.24;
    rp.setXYZ(i, x * k, y * k * 0.85, z * k);
  }
  roundGeo.computeVertexNormals();
  const trunkMat = new THREE.MeshStandardMaterial({ color: '#7a5a3f', flatShading: true, roughness: 1 });
  const pineMat = new THREE.MeshStandardMaterial({ color: '#ffffff', flatShading: true, roughness: 0.9 });
  const leafMat = new THREE.MeshStandardMaterial({ color: '#ffffff', flatShading: true, roughness: 0.9 });
  const N = 11000;
  const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, N);
  const pines = new THREE.InstancedMesh(crownGeo, pineMat, N);
  const rounds = new THREE.InstancedMesh(roundGeo, leafMat, N);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const c = new THREE.Color();
  const PINE = [new THREE.Color('#3f7043'), new THREE.Color('#557f45'), new THREE.Color('#35603f')];
  const LEAF = [new THREE.Color('#6f9d4b'), new THREE.Color('#86a84c'), new THREE.Color('#5d8c45'), new THREE.Color('#a3a549')];
  const pick = (list: THREE.Color[], h: number, h2: number) => c.copy(list[Math.floor(h * list.length)]).lerp(list[Math.floor(h2 * list.length)], 0.5);
  let t = 0;
  let p = 0;
  let r = 0;
  const clear = (x: number, z: number, margin: number) => {
    const near = terrain.nearest(x, z);
    return near.dist >= road.wallOffset + margin + terrain.lotAt(x, z, near.index);
  };
  const spots: [number, number][] = [];
  // Rows of trees right behind the verge, so the roadside rushes past.
  for (let i = 0; i < road.samples.length; i += 3) {
    const a = road.samples[i];
    for (const side of [-1, 1]) {
      if (hash(i, side + 90) < 0.3 || valueNoise(a.s / 60, side * 7) < 0.3) continue;
      const [x, , z] = at(a, side * (road.wallOffset + 2.2 + hash(i, side + 91) * 6), 0);
      if (clear(x, z, 2)) spots.push([x, z]);
    }
  }
  for (let i = 0; i < N * 3 && spots.length < N; i++) {
    const x = b.minX + hash(i, 2) * (b.maxX - b.minX);
    const z = b.minZ + hash(i, 3) * (b.maxZ - b.minZ);
    // Forests come in clumps, thicker near the road.
    if (valueNoise(x / 90, z / 90) < 0.36) continue;
    if (clear(x, z, 2.5)) spots.push([x, z]);
  }
  for (let i = 0; i < spots.length && t < N; i++) {
    const [x, z] = spots[i];
    const y = terrain.height(x, z);
    const sc = 0.7 + hash(i, 4) * 0.8;
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), hash(i, 5) * 6.28);
    const s = new THREE.Vector3(sc, sc * (0.9 + hash(i, 7) * 0.25), sc);
    m.compose(new THREE.Vector3(x, y + 0.8 * sc, z), q, s);
    trunks.setMatrixAt(t++, m);
    if (hash(i, 6) > 0.35) {
      m.compose(new THREE.Vector3(x, y + 3.4 * sc, z), q, s);
      pines.setColorAt(p, pick(PINE, hash(i, 13), hash(i, 14)));
      pines.setMatrixAt(p++, m);
    } else {
      m.compose(new THREE.Vector3(x, y + 3 * sc, z), q, s);
      rounds.setColorAt(r, pick(LEAF, hash(i, 13), hash(i, 14)));
      rounds.setMatrixAt(r++, m);
    }
  }
  trunks.count = t;
  pines.count = p;
  rounds.count = r;
  for (const im of [trunks, pines, rounds]) {
    im.castShadow = true;
    im.receiveShadow = true;
  }
  group.add(trunks, pines, rounds);
  return group;
}

/** Boulders scattered on the hillsides, a few close to the verge. */
function buildRocks(road: Road, terrain: Terrain, b: Bounds) {
  const geo = new THREE.DodecahedronGeometry(1, 0);
  const mat = new THREE.MeshStandardMaterial({ color: '#ffffff', flatShading: true, roughness: 0.95 });
  const N = 900;
  const rocks = new THREE.InstancedMesh(geo, mat, N);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const c = new THREE.Color();
  let n = 0;
  for (let i = 0; i < N * 6 && n < N; i++) {
    const x = b.minX + hash(i, 21) * (b.maxX - b.minX);
    const z = b.minZ + hash(i, 22) * (b.maxZ - b.minZ);
    const near = terrain.nearest(x, z);
    if (near.dist < road.wallOffset + 1.5 + terrain.lotAt(x, z, near.index) || near.dist > 140) continue;
    const y = terrain.height(x, z);
    const sc = 0.25 + hash(i, 23) ** 2 * 1.6;
    e.set(hash(i, 24) * 3, hash(i, 25) * 6, hash(i, 26) * 3);
    q.setFromEuler(e);
    m.compose(new THREE.Vector3(x, y + sc * 0.25, z), q, new THREE.Vector3(sc * (1 + hash(i, 27) * 0.6), sc * 0.7, sc));
    rocks.setMatrixAt(n, m);
    rocks.setColorAt(n, c.copy(ROCK).lerp(ROCK_LIGHT, hash(i, 28)));
    n++;
  }
  rocks.count = n;
  rocks.castShadow = true;
  rocks.receiveShadow = true;
  return rocks;
}

function buildGantry(road: Road, s: number, label: string) {
  const p = road.sampleAt(s);
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: '#2b2d33', flatShading: true, roughness: 0.5, metalness: 0.4 });
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
    new THREE.MeshStandardMaterial({ map: tex, roughness: 0.7 }),
  );
  banner.position.set(0, 5.1, 0);
  g.add(banner);
  g.position.set(p.x, p.h, p.z);
  g.rotation.y = p.yaw;
  g.traverse((o) => (o.castShadow = true));
  return g;
}

function buildMountains(b: Bounds) {
  const group = new THREE.Group();
  const cx = (b.minX + b.maxX) / 2;
  const cz = (b.minZ + b.maxZ) / 2;
  // Two rings: forested ridges in the middle distance, snowy peaks behind them, each
  // hazier and bluer with distance.
  // Fog would hide them completely, so the haze is faked with a glow in the horizon colour.
  const haze = COLORS.skyHorizon;
  const hazeMats: { mat: THREE.MeshStandardMaterial; amount: number }[] = [];
  const hazy = (color: string, amount: number) => {
    const mat = new THREE.MeshStandardMaterial({ color, flatShading: true, fog: false, roughness: 1, emissive: haze, emissiveIntensity: amount, envMapIntensity: 0.4 });
    hazeMats.push({ mat, amount });
    return mat;
  };
  const ridge = hazy('#6f8f78', 0.12);
  const rock = hazy('#ffffff', 0.15);
  rock.vertexColors = true;
  for (let i = 0; i < 26; i++) {
    const a = (i / 26) * Math.PI * 2 + hash(i, 30) * 0.2;
    const d = 1500 + hash(i, 31) * 200;
    const h = 120 + hash(i, 32) * 160;
    const mtn = new THREE.Mesh(craggy(new THREE.ConeGeometry(h * 2, h, 7, 2), i), ridge);
    mtn.position.set(cx + Math.cos(a) * d, h / 2 - 60, cz + Math.sin(a) * d);
    mtn.rotation.y = hash(i, 33) * 3;
    group.add(mtn);
  }
  const ROCK_COLOR = new THREE.Color('#8193a8');
  const SNOW_COLOR = new THREE.Color('#f3f5f7');
  const c = new THREE.Color();
  for (let i = 0; i < 30; i++) {
    const a = (i / 30) * Math.PI * 2 + hash(i, 8) * 0.2;
    const d = 2100 + hash(i, 9) * 300;
    const h = 260 + hash(i, 10) * 420;
    const segs = 5 + Math.floor(hash(i, 11) * 3);
    const geo = craggy(new THREE.ConeGeometry(h * 1.3, h, segs, 4), i + 50);
    // Snow on the upper faces of the tall peaks, with a ragged snowline.
    const p = geo.attributes.position;
    const col: number[] = [];
    for (let f = 0; f < p.count; f += 3) {
      const y = (p.getY(f) + p.getY(f + 1) + p.getY(f + 2)) / 3 / h + 0.5; // 0 at the foot, 1 at the tip
      const line = 0.62 + (hash(f, i) - 0.5) * 0.12;
      c.copy(h > 420 && y > line ? SNOW_COLOR : ROCK_COLOR).multiplyScalar(0.95 + hash(i, f) * 0.1);
      for (let k = 0; k < 3; k++) col.push(c.r, c.g, c.b);
    }
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    const mtn = new THREE.Mesh(geo, rock);
    mtn.position.set(cx + Math.cos(a) * d, h / 2 - 40, cz + Math.sin(a) * d);
    mtn.rotation.y = hash(i, 12) * 3;
    group.add(mtn);
  }
  return { group, haze: hazeMats };
}

/** Nudge a cone's inner vertices about so peaks look weathered rather than machined. */
function craggy(geo: THREE.BufferGeometry, seed: number, amount = 0.12) {
  const g = geo.toNonIndexed();
  const p = g.attributes.position;
  g.computeBoundingBox();
  const h = g.boundingBox!.max.y - g.boundingBox!.min.y;
  const key = (x: number, y: number, z: number) => `${x.toFixed(3)},${y.toFixed(3)},${z.toFixed(3)}`;
  const moved = new Map<string, [number, number, number]>();
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const y = p.getY(i);
    const z = p.getZ(i);
    const k = key(x, y, z);
    let v = moved.get(k);
    if (!v) {
      const top = y > g.boundingBox!.max.y - 1e-3;
      const bottom = y < g.boundingBox!.min.y + 1e-3;
      const r = hash(x * 0.37 + seed, z * 0.53 - seed);
      const s = top || bottom ? 1 : 1 + (r - 0.5) * amount * 3;
      v = [x * s, top ? y : y + (hash(z + seed, x) - 0.5) * h * amount, z * s];
      moved.set(k, v);
    }
    p.setXYZ(i, ...v);
  }
  g.computeVertexNormals();
  return g;
}

/** Soft low-poly clouds drifting high over the far hills. */
function buildClouds(b: Bounds) {
  const geo = new THREE.IcosahedronGeometry(1, 1);
  const mat = new THREE.MeshStandardMaterial({ color: '#ffffff', emissive: '#dfe6ee', emissiveIntensity: 0.3, flatShading: true, fog: false, roughness: 1, envMapIntensity: 0.3 });
  const puffs: THREE.Matrix4[] = [];
  const cx = (b.minX + b.maxX) / 2;
  const cz = (b.minZ + b.maxZ) / 2;
  const q = new THREE.Quaternion();
  for (let i = 0; i < 18; i++) {
    const a = hash(i, 40) * Math.PI * 2;
    const d = 1500 + hash(i, 41) * 800;
    const y = 620 + hash(i, 42) * 320;
    const size = 50 + hash(i, 43) * 60;
    const heading = hash(i, 44) * Math.PI;
    for (let k = 0; k < 5; k++) {
      const along = (k - 2) * size * 0.7 + (hash(i, k + 45) - 0.5) * size * 0.4;
      const r = size * (k === 2 ? 1 : 0.55 + hash(i, k + 50) * 0.35);
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), hash(i, k + 55) * 6);
      puffs.push(
        new THREE.Matrix4().compose(
          new THREE.Vector3(cx + Math.cos(a) * d + Math.cos(heading) * along, y + (k === 2 ? r * 0.15 : 0), cz + Math.sin(a) * d + Math.sin(heading) * along),
          q,
          new THREE.Vector3(r, r * 0.45, r * 0.8),
        ),
      );
    }
  }
  const clouds = new THREE.InstancedMesh(geo, mat, puffs.length);
  puffs.forEach((m, i) => clouds.setMatrixAt(i, m));
  clouds.frustumCulled = false;
  return clouds;
}
