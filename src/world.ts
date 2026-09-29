// Low-poly world: terrain, a long test road with a hill, trees, and the cockpit.

import * as THREE from 'three';

export const ROAD_LENGTH = 6000;
const ROAD_HALF_WIDTH = 4;

/** Road height as a function of distance along it (s = -z). Includes one hill. */
export function roadHeight(s: number) {
  const ramp = (a: number, b: number, x: number) => {
    const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
    return t * t * (3 - 2 * t);
  };
  // Flat start, climb ~22 m (about 9% at its steepest), plateau, descent, then gentle rollers.
  let h = 22 * ramp(220, 600, s) - 22 * ramp(1100, 1500, s);
  h += 3 * Math.sin(Math.max(0, s - 1700) / 140) * ramp(1700, 1900, s);
  return h;
}

export function roadSlope(s: number) {
  const e = 0.5;
  return (roadHeight(s + e) - roadHeight(s - e)) / (2 * e);
}

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

export function terrainHeight(x: number, z: number) {
  const base = roadHeight(-z);
  const away = Math.min(1, Math.max(0, (Math.abs(x) - ROAD_HALF_WIDTH - 3) / 40));
  const n = valueNoise(x / 60, z / 60) * 14 + valueNoise(x / 17, z / 17) * 3;
  return base - 0.15 + away * (n - 2);
}

export const COLORS = {
  skyTop: new THREE.Color('#7fb2d9'),
  skyHorizon: new THREE.Color('#f2dcc0'),
  grass: new THREE.Color('#9dbf6a'),
  grassDark: new THREE.Color('#7fa656'),
  road: new THREE.Color('#4a4d57'),
  line: new THREE.Color('#f4f1e8'),
  paint: new THREE.Color('#e4573d'),
  interior: new THREE.Color('#2b2d33'),
  interiorLight: new THREE.Color('#3a3d45'),
};

export function buildWorld(scene: THREE.Scene) {
  scene.background = COLORS.skyHorizon.clone();
  scene.fog = new THREE.Fog(COLORS.skyHorizon, 120, 900);

  const hemi = new THREE.HemisphereLight(COLORS.skyTop, new THREE.Color('#b59b74'), 1.6);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(new THREE.Color('#fff1dc'), 2.2);
  sun.position.set(-60, 100, 40);
  scene.add(sun);

  scene.add(buildSky());
  scene.add(buildTerrain());
  scene.add(buildRoad());
  scene.add(buildTrees());
  scene.add(buildPosts());
  scene.add(buildMountains());
}

function buildSky() {
  const geo = new THREE.SphereGeometry(1800, 16, 12);
  const pos = geo.attributes.position;
  const colors: number[] = [];
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i) / 1800;
    c.copy(COLORS.skyHorizon).lerp(COLORS.skyTop, Math.min(1, Math.max(0, y * 2.2)));
    colors.push(c.r, c.g, c.b);
  }
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  const mat = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false });
  const sky = new THREE.Mesh(geo, mat);
  sky.renderOrder = -1;
  sky.onBeforeRender = (_r, _s, camera) => sky.position.copy(camera.position);
  return sky;
}

function buildTerrain() {
  const width = 800;
  const length = ROAD_LENGTH + 800;
  const geo = new THREE.PlaneGeometry(width, length, 80, Math.round(length / 12)).toNonIndexed();
  geo.rotateX(-Math.PI / 2);
  geo.translate(0, 0, -length / 2 + 300);
  const pos = geo.attributes.position;
  const colors: number[] = [];
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    pos.setY(i, terrainHeight(x, z));
  }
  // Flat-shade per triangle with a little colour variation.
  for (let i = 0; i < pos.count; i += 3) {
    const cx = (pos.getX(i) + pos.getX(i + 1) + pos.getX(i + 2)) / 3;
    const cz = (pos.getZ(i) + pos.getZ(i + 1) + pos.getZ(i + 2)) / 3;
    c.copy(COLORS.grass).lerp(COLORS.grassDark, hash(Math.floor(cx), Math.floor(cz)) * 0.8);
    for (let k = 0; k < 3; k++) colors.push(c.r, c.g, c.b);
  }
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  return new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }));
}

function buildRoad() {
  const group = new THREE.Group();
  const step = 4;
  const n = Math.round((ROAD_LENGTH + 100) / step);
  const verts: number[] = [];
  for (let i = 0; i < n; i++) {
    const s0 = i * step - 60;
    const s1 = s0 + step;
    const h0 = roadHeight(s0);
    const h1 = roadHeight(s1);
    const w = ROAD_HALF_WIDTH;
    verts.push(-w, h0, -s0, w, h0, -s0, w, h1, -s1, -w, h0, -s0, w, h1, -s1, -w, h1, -s1);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  geo.computeVertexNormals();
  group.add(new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ color: COLORS.road })));

  // Dashed centre line and solid edge lines as instanced quads.
  const dash = new THREE.PlaneGeometry(0.15, 3).rotateX(-Math.PI / 2);
  const mat = new THREE.MeshLambertMaterial({ color: COLORS.line });
  const count = Math.floor(ROAD_LENGTH / 12);
  const dashes = new THREE.InstancedMesh(dash, mat, count);
  const edges = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.15, 4.05).rotateX(-Math.PI / 2), mat, n * 2);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const one = new THREE.Vector3(1, 1, 1);
  for (let i = 0; i < count; i++) {
    const s = i * 12;
    e.set(Math.atan(roadSlope(s)), 0, 0);
    q.setFromEuler(e);
    m.compose(new THREE.Vector3(0, roadHeight(s) + 0.02, -s), q, one);
    dashes.setMatrixAt(i, m);
  }
  for (let i = 0; i < n; i++) {
    const s = i * step - 58;
    e.set(Math.atan(roadSlope(s)), 0, 0);
    q.setFromEuler(e);
    for (const side of [-1, 1]) {
      m.compose(new THREE.Vector3(side * (ROAD_HALF_WIDTH - 0.35), roadHeight(s) + 0.02, -s), q, one);
      edges.setMatrixAt(i * 2 + (side > 0 ? 1 : 0), m);
    }
  }
  group.add(dashes, edges);
  return group;
}

function buildTrees() {
  const group = new THREE.Group();
  const trunkGeo = new THREE.CylinderGeometry(0.18, 0.25, 1.6, 5);
  const crownGeo = new THREE.ConeGeometry(1.6, 4.2, 6);
  const roundGeo = new THREE.IcosahedronGeometry(1.8, 0);
  const trunkMat = new THREE.MeshLambertMaterial({ color: '#7a5a3f', flatShading: true });
  const pineMat = new THREE.MeshLambertMaterial({ color: '#4f7f4a', flatShading: true });
  const leafMat = new THREE.MeshLambertMaterial({ color: '#6f9d4b', flatShading: true });
  const N = 2600;
  const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, N);
  const pines = new THREE.InstancedMesh(crownGeo, pineMat, N);
  const rounds = new THREE.InstancedMesh(roundGeo, leafMat, N);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  let p = 0;
  let r = 0;
  for (let i = 0; i < N; i++) {
    const side = hash(i, 1) > 0.5 ? 1 : -1;
    const x = side * (ROAD_HALF_WIDTH + 6 + hash(i, 2) ** 1.6 * 160);
    const z = 150 - hash(i, 3) * (ROAD_LENGTH + 300);
    const y = terrainHeight(x, z);
    const sc = 0.7 + hash(i, 4) * 0.8;
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), hash(i, 5) * 6.28);
    const s = new THREE.Vector3(sc, sc, sc);
    m.compose(new THREE.Vector3(x, y + 0.8 * sc, z), q, s);
    trunks.setMatrixAt(i, m);
    if (hash(i, 6) > 0.4) {
      m.compose(new THREE.Vector3(x, y + 3.4 * sc, z), q, s);
      pines.setMatrixAt(p++, m);
    } else {
      m.compose(new THREE.Vector3(x, y + 3 * sc, z), q, s);
      rounds.setMatrixAt(r++, m);
    }
  }
  pines.count = p;
  rounds.count = r;
  group.add(trunks, pines, rounds);
  return group;
}

function buildPosts() {
  // Reflector posts every 50 m give a strong sense of speed.
  const geo = new THREE.BoxGeometry(0.12, 1, 0.12);
  const mat = new THREE.MeshLambertMaterial({ color: '#f4f1e8' });
  const count = Math.floor(ROAD_LENGTH / 50) * 2;
  const posts = new THREE.InstancedMesh(geo, mat, count);
  const m = new THREE.Matrix4();
  let i = 0;
  for (let s = 0; s < ROAD_LENGTH; s += 50) {
    for (const side of [-1, 1]) {
      const x = side * (ROAD_HALF_WIDTH + 1.2);
      m.makeTranslation(x, roadHeight(s) + 0.5, -s);
      posts.setMatrixAt(i++, m);
    }
  }
  return posts;
}

function buildMountains() {
  const group = new THREE.Group();
  const mat = new THREE.MeshLambertMaterial({ color: '#9fb0c4', flatShading: true, fog: false });
  const snow = new THREE.MeshLambertMaterial({ color: '#eef0f2', flatShading: true, fog: false });
  for (let i = 0; i < 26; i++) {
    const a = (i / 26) * Math.PI * 2;
    const d = 1300 + hash(i, 9) * 200;
    const h = 120 + hash(i, 10) * 220;
    const geo = new THREE.ConeGeometry(h * 1.4, h, 5 + Math.floor(hash(i, 11) * 3));
    const mtn = new THREE.Mesh(geo, mat);
    mtn.position.set(Math.cos(a) * d, h / 2 - 20, Math.sin(a) * d - 1500);
    mtn.rotation.y = hash(i, 12) * 3;
    group.add(mtn);
    if (h > 220) {
      const cap = new THREE.Mesh(new THREE.ConeGeometry(h * 0.35, h * 0.25, geo.parameters.radialSegments), snow);
      cap.position.set(0, h * 0.375 + 0.5, 0);
      mtn.add(cap);
    }
  }
  return group;
}

export interface Cockpit {
  root: THREE.Group; // moves with the car
  camera: THREE.PerspectiveCamera;
  head: THREE.Group; // for head bob / shake
  wheel: THREE.Group;
  shifter: THREE.Group;
  cluster: THREE.CanvasTexture;
  clusterCanvas: HTMLCanvasElement;
  clutchPedal: THREE.Mesh;
  brakePedal: THREE.Mesh;
  throttlePedal: THREE.Mesh;
}

export function buildCockpit(): Cockpit {
  const root = new THREE.Group();
  const mat = (c: THREE.ColorRepresentation) => new THREE.MeshLambertMaterial({ color: c, flatShading: true });
  const interior = mat(COLORS.interior);
  const interiorLight = mat(COLORS.interiorLight);
  const paint = mat(COLORS.paint);
  const add = (geo: THREE.BufferGeometry, m: THREE.Material, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0) => {
    const mesh = new THREE.Mesh(geo, m);
    mesh.position.set(x, y, z);
    mesh.rotation.set(rx, ry, rz);
    root.add(mesh);
    return mesh;
  };

  // Hood, visible over the dashboard.
  add(new THREE.BoxGeometry(1.7, 0.06, 1.4), paint, 0, 0.84, -1.85, 0.06);
  // Dashboard top and face.
  add(new THREE.BoxGeometry(1.62, 0.06, 0.55), interior, 0, 0.9, -0.86, -0.08);
  add(new THREE.BoxGeometry(1.62, 0.3, 0.06), interiorLight, 0, 0.74, -0.6);
  // Instrument hood over the cluster.
  add(new THREE.BoxGeometry(0.5, 0.04, 0.16), interior, -0.37, 1.1, -0.8, -0.15);
  // A-pillars (leaning back towards the driver) and roof edge.
  add(new THREE.BoxGeometry(0.04, 0.8, 0.06), interior, -0.8, 1.28, -0.78, 0.72, 0, 0.04);
  add(new THREE.BoxGeometry(0.04, 0.8, 0.06), interior, 0.8, 1.28, -0.78, 0.72, 0, -0.04);
  add(new THREE.BoxGeometry(1.66, 0.06, 0.5), interiorLight, 0, 1.6, -0.25);
  // Rear-view mirror.
  add(new THREE.BoxGeometry(0.22, 0.06, 0.03), interior, 0.02, 1.5, -0.48);
  // Doors / window sills.
  add(new THREE.BoxGeometry(0.08, 0.1, 1.3), paint, -0.84, 0.97, 0.05);
  add(new THREE.BoxGeometry(0.08, 0.1, 1.3), paint, 0.84, 0.97, 0.05);
  // Centre console.
  add(new THREE.BoxGeometry(0.26, 0.3, 0.8), interior, 0, 0.47, -0.2);

  // Instrument cluster (canvas texture).
  const clusterCanvas = document.createElement('canvas');
  clusterCanvas.width = 512;
  clusterCanvas.height = 200;
  const cluster = new THREE.CanvasTexture(clusterCanvas);
  cluster.colorSpace = THREE.SRGBColorSpace;
  cluster.anisotropy = 4;
  add(new THREE.PlaneGeometry(0.46, 0.18), new THREE.MeshBasicMaterial({ map: cluster }), -0.37, 1.0, -0.72, -0.4);

  // Steering wheel.
  const wheel = new THREE.Group();
  const rim = new THREE.Mesh(new THREE.TorusGeometry(0.185, 0.018, 6, 20), interior);
  wheel.add(rim);
  for (const a of [0, (2 * Math.PI) / 3, (4 * Math.PI) / 3]) {
    const spoke = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.025, 0.02), interiorLight);
    spoke.position.set(Math.cos(a - Math.PI / 2) * 0.09, Math.sin(a - Math.PI / 2) * 0.09, 0);
    spoke.rotation.z = a - Math.PI / 2;
    wheel.add(spoke);
  }
  wheel.add(new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.03, 8).rotateX(Math.PI / 2), interiorLight));
  const wheelMount = new THREE.Group();
  wheelMount.position.set(-0.37, 0.76, -0.4);
  wheelMount.rotation.x = -0.45;
  wheelMount.add(wheel);
  root.add(wheelMount);

  // Gear lever: pivot at the console, knob on top.
  const shifter = new THREE.Group();
  shifter.position.set(0.02, 0.62, -0.12);
  const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.01, 0.2, 5), mat('#1c1d21'));
  stick.position.y = 0.1;
  const knob = new THREE.Mesh(new THREE.IcosahedronGeometry(0.03, 1), mat('#15161a'));
  knob.position.y = 0.21;
  shifter.add(stick, knob);
  root.add(shifter);

  // Pedals (mostly out of view, visible when looking down).
  const pedalGeo = new THREE.BoxGeometry(0.07, 0.1, 0.02);
  const clutchPedal = add(pedalGeo, interiorLight, -0.52, 0.35, -0.55);
  const brakePedal = add(pedalGeo, interiorLight, -0.38, 0.35, -0.55);
  const throttlePedal = add(new THREE.BoxGeometry(0.05, 0.14, 0.02), interiorLight, -0.24, 0.33, -0.55);

  const head = new THREE.Group();
  head.position.set(-0.37, 1.2, 0.1);
  const camera = new THREE.PerspectiveCamera(72, 1, 0.03, 3000);
  camera.rotation.x = -0.1;
  head.add(camera);
  root.add(head);

  return { root, camera, head, wheel, shifter, cluster, clusterCanvas, clutchPedal, brakePedal, throttlePedal };
}

/** Position of the shift knob for each gear in a 5+R H-pattern (x = across, z = fore/aft). */
export function shifterPose(gear: number): [number, number] {
  const col: Record<number, number> = { [-1]: 1.5, 0: 0, 1: -1, 2: -1, 3: 0, 4: 0, 5: 1, 6: 1 };
  const row: Record<number, number> = { [-1]: 1, 0: 0, 1: -1, 2: 1, 3: -1, 4: 1, 5: -1 };
  return [col[gear] ?? 0, row[gear] ?? 0];
}
