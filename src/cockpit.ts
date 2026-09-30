// The car interior the player sits in: hood, dash, gauges, wheel, shifter and pedals.
// Each car has its own interior (see InteriorSpec in cars.ts): seat height, hood,
// trim colours, steering wheel, a roll cage or extra gauges.

import * as THREE from 'three';
import type { InteriorSpec } from './cars';

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
  head: THREE.Group; // the driver's eyes; the camera attaches here in cockpit view
  eye: THREE.Vector3; // resting head position inside head's parent
  wheel: THREE.Group;
  shifter: THREE.Group;
  cluster: THREE.CanvasTexture;
  clusterCanvas: HTMLCanvasElement;
  clutchPedal: THREE.Mesh;
  brakePedal: THREE.Mesh;
  throttlePedal: THREE.Mesh;
  paint: THREE.MeshLambertMaterial;
  dispose(): void;
}

export function buildCockpit(spec: InteriorSpec): Cockpit {
  const root = new THREE.Group();
  const cabin = new THREE.Group();
  cabin.position.y = -spec.seatDrop;
  root.add(cabin);

  const mat = (c: THREE.ColorRepresentation, emissive?: THREE.ColorRepresentation) =>
    new THREE.MeshLambertMaterial({ color: c, flatShading: true, emissive: emissive ?? 0x000000 });
  const interior = mat(spec.trim);
  const interiorLight = mat(spec.trimLight);
  const accent = mat(spec.accent);
  const dark = mat('#141518');
  const metal = mat('#9ea2a8');
  const paint = mat(COLORS.paint);
  const add = (geo: THREE.BufferGeometry, m: THREE.Material, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0, parent: THREE.Object3D = cabin) => {
    const mesh = new THREE.Mesh(geo, m);
    mesh.position.set(x, y, z);
    mesh.rotation.set(rx, ry, rz);
    parent.add(mesh);
    return mesh;
  };
  const box = (w: number, h: number, d: number, m: THREE.Material, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0) =>
    add(new THREE.BoxGeometry(w, h, d), m, x, y, z, rx, ry, rz);
  /** A round bar between two points (roll cage, stalks). */
  const bar = (a: THREE.Vector3, b: THREE.Vector3, r: number, m: THREE.Material) => {
    const len = a.distanceTo(b);
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 6), m);
    mesh.position.copy(a).add(b).multiplyScalar(0.5);
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
    cabin.add(mesh);
    return mesh;
  };
  const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

  // ---- Outside the glass: hood, cowl, wipers, door mirrors ----
  const hl = spec.hoodLength;
  box(1.66, 0.06, hl, paint, 0, 0.84, -1.15 - hl / 2, 0.06);
  if (spec.hoodBulge) box(0.62, 0.05, hl * 0.8, paint, 0, 0.88, -1.2 - hl * 0.4, 0.06);
  box(1.6, 0.03, 0.16, dark, 0, 0.885, -1.1); // cowl
  box(0.56, 0.012, 0.02, dark, -0.34, 0.905, -1.1, 0, 0.14);
  box(0.5, 0.012, 0.02, dark, 0.3, 0.905, -1.1, 0, 0.14);
  for (const side of [-1, 1]) {
    box(0.1, 0.09, 0.14, paint, side * 0.98, 1.0, -0.72);
    box(0.085, 0.07, 0.005, mat('#8fa3b8'), side * 0.98, 1.0, -0.648); // mirror glass, facing back
    box(0.1, 0.02, 0.04, dark, side * 0.9, 0.98, -0.72);
  }

  // ---- Dashboard ----
  box(1.62, 0.06, 0.55, interior, 0, 0.9, -0.86, -0.08);
  box(1.62, 0.3, 0.06, interiorLight, 0, 0.74, -0.6);
  box(1.6, 0.012, 0.012, accent, 0, 0.885, -0.585); // trim line along the dash
  for (const x of [-0.72, -0.1, 0.14, 0.72]) {
    box(0.13, 0.055, 0.02, dark, x, 0.81, -0.565);
    for (const dy of [-0.013, 0.013]) box(0.12, 0.006, 0.01, interiorLight, x, 0.81 + dy, -0.552);
  }
  box(0.004, 0.14, 0.004, dark, 0.45, 0.7, -0.568); // glovebox seam
  box(0.36, 0.004, 0.004, dark, 0.62, 0.77, -0.568);
  // Centre stack: radio with a lit display, climate knobs, hazard button.
  box(0.3, 0.26, 0.05, interior, 0.02, 0.64, -0.55);
  box(0.24, 0.06, 0.01, dark, 0.02, 0.7, -0.522);
  box(0.12, 0.025, 0.005, mat('#7fd1a8', '#2f6b52'), 0.0, 0.703, -0.516);
  for (const x of [-0.07, 0.02, 0.11]) add(new THREE.CylinderGeometry(0.022, 0.022, 0.02, 10).rotateX(Math.PI / 2), interiorLight, x, 0.6, -0.52);
  box(0.035, 0.02, 0.02, mat('#c8261f', '#3a0906'), 0.02, 0.755, -0.53);

  // Instrument hood over the cluster, with a stitched edge.
  box(0.5, 0.04, 0.16, interior, -0.37, 1.1, -0.8, -0.15);
  box(0.5, 0.008, 0.008, accent, -0.37, 1.093, -0.722, -0.15);

  // Instrument cluster (canvas texture).
  const clusterCanvas = document.createElement('canvas');
  clusterCanvas.width = 512;
  clusterCanvas.height = 200;
  const cluster = new THREE.CanvasTexture(clusterCanvas);
  cluster.colorSpace = THREE.SRGBColorSpace;
  cluster.anisotropy = 4;
  add(new THREE.PlaneGeometry(0.46, 0.18), new THREE.MeshBasicMaterial({ map: cluster }), -0.37, 1.0, -0.72, -0.4);

  // Extra gauges: a triple pod on the dash top and a boost gauge on the pillar.
  const gauge = (x: number, y: number, z: number, rx: number, ry: number, needle: number) => {
    const g = new THREE.Group();
    g.position.set(x, y, z);
    g.rotation.set(rx, ry, 0);
    add(new THREE.CylinderGeometry(0.036, 0.04, 0.05, 12).rotateX(Math.PI / 2), interior, 0, 0, 0, 0, 0, 0, g);
    add(new THREE.CircleGeometry(0.03, 14), mat('#101114'), 0, 0, 0.026, 0, 0, 0, g);
    add(new THREE.BoxGeometry(0.004, 0.024, 0.002), mat('#ff8a4c', '#7a3510'), 0, 0.009, 0.028, 0, 0, needle, g).geometry.translate(0, 0.003, 0);
    cabin.add(g);
  };
  if (spec.gaugePod) {
    for (let i = 0; i < 3; i++) gauge(-0.01 + i * 0.085, 0.965, -0.68, -0.35, 0.18, -0.6 + i * 0.5);
    gauge(-0.74, 1.14, -0.72, -0.2, 0.5, 0.4);
  }

  // ---- Pillars, roof, mirror, visors ----
  box(0.05, 0.8, 0.07, interior, -0.8, 1.28, -0.78, 0.72, 0, 0.04);
  box(0.05, 0.8, 0.07, interior, 0.8, 1.28, -0.78, 0.72, 0, -0.04);
  box(1.66, 0.06, 0.5, interiorLight, 0, 1.6, -0.25);
  box(0.02, 0.06, 0.02, dark, 0.02, 1.55, -0.47);
  box(0.24, 0.07, 0.03, dark, 0.02, 1.5, -0.48);
  box(0.2, 0.05, 0.005, mat('#8fa3b8'), 0.02, 1.5, -0.464);
  for (const x of [-0.42, 0.42]) box(0.5, 0.02, 0.2, interiorLight, x, 1.565, -0.46, 0.25);

  // ---- Doors ----
  for (const side of [-1, 1]) {
    box(0.08, 0.1, 1.3, paint, side * 0.84, 0.97, 0.05); // painted sill at the window line
    box(0.05, 0.42, 1.2, interior, side * 0.86, 0.72, 0.05);
    box(0.09, 0.05, 0.4, interiorLight, side * 0.81, 0.8, 0.12); // armrest
    box(0.02, 0.03, 0.09, metal, side * 0.83, 0.88, -0.2); // handle
    box(0.012, 0.012, 1.1, accent, side * 0.835, 0.915, 0.05);
  }

  // ---- Console, handbrake, shifter ----
  box(0.26, 0.3, 0.8, interior, 0, 0.47, -0.2);
  box(0.03, 0.03, 0.22, interiorLight, 0.08, 0.66, 0.12, 0.22); // handbrake lever
  box(0.04, 0.04, 0.05, dark, 0.08, 0.69, 0.22, 0.22);

  const shifter = new THREE.Group();
  shifter.position.set(0.02, 0.62, -0.12);
  const tall = spec.wheel === 'four';
  const stickLen = spec.wheel === 'dish' ? 0.15 : tall ? 0.22 : 0.2;
  const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.01, stickLen, 5), mat('#1c1d21'));
  stick.position.y = stickLen / 2;
  const knobMat = spec.wheel === 'dish' ? mat('#e8e6df') : dark;
  const knob = new THREE.Mesh(spec.wheel === 'dish' ? new THREE.SphereGeometry(0.03, 8, 6) : new THREE.IcosahedronGeometry(0.03, 1), knobMat);
  knob.position.y = stickLen + 0.01;
  shifter.add(stick, knob);
  cabin.add(shifter);
  // Leather boot around the lever's base.
  add(new THREE.ConeGeometry(tall ? 0.07 : 0.055, tall ? 0.1 : 0.05, 8), tall ? accent : dark, 0.02, 0.645, -0.12);

  // ---- Steering wheel ----
  const wheel = new THREE.Group();
  const radius = spec.wheel === 'dish' ? 0.17 : spec.wheel === 'four' ? 0.19 : 0.185;
  const grip = spec.wheel === 'dish' ? 0.021 : 0.018;
  wheel.add(new THREE.Mesh(new THREE.TorusGeometry(radius, grip, 6, 22), interior));
  const spokeMat = spec.wheel === 'dish' ? metal : interiorLight;
  const spokeAngles =
    spec.wheel === 'four' ? [Math.PI * 0.2, Math.PI * 0.8, Math.PI * 1.3, Math.PI * 1.7] : [0, (2 * Math.PI) / 3, (4 * Math.PI) / 3].map((a) => a - Math.PI / 2);
  for (const a of spokeAngles) {
    const len = radius * 0.9;
    const spoke = new THREE.Mesh(new THREE.BoxGeometry(len, 0.024, 0.015), spokeMat);
    spoke.position.set(Math.cos(a) * len * 0.5, Math.sin(a) * len * 0.5, spec.wheel === 'dish' ? 0.03 : 0);
    spoke.rotation.z = a;
    wheel.add(spoke);
  }
  const hubR = spec.wheel === 'four' ? 0.06 : 0.045;
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(hubR, hubR, 0.035, 10).rotateX(Math.PI / 2), interiorLight);
  hub.position.z = spec.wheel === 'dish' ? 0.04 : 0.005;
  wheel.add(hub);
  if (spec.wheel === 'dish') {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.035, 0.006, 4, 12), accent);
    ring.position.z = 0.058;
    wheel.add(ring);
  }
  // Top-centre marker so you can see how far the wheel is turned.
  const marker = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.012, grip * 2.2), spec.wheel === 'four' ? accent : mat(spec.cage ? '#e8e6df' : spec.accent));
  marker.position.y = radius;
  wheel.add(marker);
  const wheelMount = new THREE.Group();
  wheelMount.position.set(-0.37, 0.76, -0.4);
  wheelMount.rotation.x = -0.45;
  wheelMount.add(wheel);
  cabin.add(wheelMount);
  // Steering column and indicator/wiper stalks.
  add(new THREE.CylinderGeometry(0.04, 0.05, 0.22, 8).rotateX(Math.PI / 2 - 0.45), interior, -0.37, 0.72, -0.5);
  bar(v(-0.4, 0.73, -0.47), v(-0.55, 0.72, -0.47), 0.006, dark);
  bar(v(-0.34, 0.73, -0.47), v(-0.19, 0.72, -0.47), 0.006, dark);

  // ---- Roll cage ----
  if (spec.cage) {
    const tube = mat('#56595f');
    for (const s of [-1, 1]) {
      bar(v(s * 0.74, 0.55, -0.62), v(s * 0.74, 1.54, -0.34), 0.022, tube); // along the A-pillar
      bar(v(s * 0.74, 1.54, -0.34), v(s * 0.74, 1.54, 0.55), 0.022, tube); // roof rail
      bar(v(s * 0.76, 0.62, -0.55), v(s * 0.76, 1.0, 0.5), 0.02, tube); // door bar
    }
    bar(v(-0.74, 1.54, -0.34), v(0.74, 1.54, -0.34), 0.022, tube);
  }

  // ---- Pedals (visible when looking down) ----
  const pedalMat = spec.cage ? metal : interiorLight;
  const pedalGeo = new THREE.BoxGeometry(0.07, 0.1, 0.02);
  const clutchPedal = add(pedalGeo, pedalMat, -0.52, 0.35, -0.55);
  const brakePedal = add(pedalGeo, pedalMat, -0.38, 0.35, -0.55);
  const throttlePedal = add(new THREE.BoxGeometry(0.05, 0.14, 0.02), pedalMat, -0.24, 0.33, -0.55);

  const eye = new THREE.Vector3(-0.37, 1.2, 0.1);
  const head = new THREE.Group();
  head.position.copy(eye);
  cabin.add(head);

  const dispose = () => {
    root.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        o.geometry.dispose();
        const m = o.material as THREE.Material;
        if (m !== paint) m.dispose();
      }
    });
    paint.dispose();
    cluster.dispose();
  };

  return { root, head, eye, wheel, shifter, cluster, clusterCanvas, clutchPedal, brakePedal, throttlePedal, paint, dispose };
}

/** Position of the shift knob for each gear in a 5+R H-pattern (x = across, z = fore/aft). */
export function shifterPose(gear: number): [number, number] {
  const col: Record<number, number> = { [-1]: 1.5, 0: 0, 1: -1, 2: -1, 3: 0, 4: 0, 5: 1, 6: 1 };
  const row: Record<number, number> = { [-1]: 1, 0: 0, 1: -1, 2: 1, 3: -1, 4: 1, 5: -1, 6: 1 };
  return [col[gear] ?? 0, row[gear] ?? 0];
}
