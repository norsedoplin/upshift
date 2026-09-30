// The car interior the player sits in: dash, gauges, wheel, shifter, pedals and camera.

import * as THREE from 'three';

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
