// A small showroom scene: the selected car on a turntable, for the garage screen.

import * as THREE from 'three';
import type { BodyShape } from '../cars';

export function buildCarModel(body: BodyShape, paint: THREE.Color) {
  const g = new THREE.Group();
  const flat = (c: THREE.ColorRepresentation) => new THREE.MeshLambertMaterial({ color: c, flatShading: true });
  const paintMat = flat(paint);
  const glass = flat('#1c2330');
  const dark = flat('#1a1b1f');
  const trim = flat('#2b2d33');
  const { length: L, width: W, height: H, cabinLength: CL, cabinHeight: CH, cabinOffset: CO, wheelRadius: R } = body;
  const rideHeight = R * 0.55;

  // Lower body: a box with its nose and tail chamfered by squashing the top vertices inwards.
  const lower = new THREE.BoxGeometry(W, H, L, 1, 1, 1);
  const pos = lower.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    const z = pos.getZ(i);
    if (y > 0) pos.setZ(i, z * 0.93);
  }
  lower.computeVertexNormals();
  const lowerMesh = new THREE.Mesh(lower, paintMat);
  lowerMesh.position.y = rideHeight + H / 2;
  g.add(lowerMesh);

  // Cabin: a tapered block (narrower roof), glass all round with a painted roof panel.
  const cabin = new THREE.BoxGeometry(W * 0.9, CH, CL, 1, 1, 1);
  const cp = cabin.attributes.position;
  for (let i = 0; i < cp.count; i++) {
    if (cp.getY(i) > 0) {
      cp.setX(i, cp.getX(i) * 0.86);
      // Raked windscreen at the front (-z), steeper rear window.
      cp.setZ(i, cp.getZ(i) < 0 ? cp.getZ(i) * 0.55 : cp.getZ(i) * 0.8);
    }
  }
  cabin.computeVertexNormals();
  const cabinMesh = new THREE.Mesh(cabin, glass);
  cabinMesh.position.set(0, rideHeight + H + CH / 2, CO);
  g.add(cabinMesh);
  const roof = new THREE.Mesh(new THREE.BoxGeometry(W * 0.9 * 0.86 + 0.02, 0.04, CL * 0.6), paintMat);
  roof.position.set(0, rideHeight + H + CH + 0.02, CO + CL * 0.06);
  g.add(roof);

  // Wheels.
  const tyre = new THREE.CylinderGeometry(R, R, 0.22, 10).rotateZ(Math.PI / 2);
  const hub = new THREE.CylinderGeometry(R * 0.55, R * 0.55, 0.23, 6).rotateZ(Math.PI / 2);
  const wheelbase = L * 0.62;
  for (const zs of [-1, 1])
    for (const xs of [-1, 1]) {
      const t = new THREE.Mesh(tyre, dark);
      t.position.set(xs * (W / 2 - 0.08), R, (zs * wheelbase) / 2 + L * 0.02);
      const h = new THREE.Mesh(hub, flat('#9a9ca1'));
      h.position.copy(t.position);
      h.position.x += xs * 0.01;
      g.add(t, h);
    }

  // Lights, grille and bumpers.
  const lamp = new THREE.BoxGeometry(0.34, 0.1, 0.04);
  for (const xs of [-1, 1]) {
    const head = new THREE.Mesh(lamp, flat('#fff6d8'));
    head.position.set(xs * (W / 2 - 0.3), rideHeight + H * 0.7, -L / 2 - 0.01);
    const tail = new THREE.Mesh(lamp, flat('#d8322b'));
    tail.position.set(xs * (W / 2 - 0.3), rideHeight + H * 0.72, L / 2 + 0.01);
    g.add(head, tail);
  }
  const grille = new THREE.Mesh(new THREE.BoxGeometry(W * 0.4, 0.12, 0.04), trim);
  grille.position.set(0, rideHeight + H * 0.45, -L / 2 - 0.01);
  g.add(grille);
  for (const zs of [-1, 1]) {
    const bumper = new THREE.Mesh(new THREE.BoxGeometry(W * 1.01, 0.14, 0.12), trim);
    bumper.position.set(0, rideHeight + 0.1, (zs * L) / 2);
    g.add(bumper);
  }
  return { group: g, paintMat };
}

export class Showroom {
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(32, 1, 0.1, 100);
  private holder = new THREE.Group();
  private paintMat: THREE.MeshLambertMaterial | null = null;
  private angle = 0.6;

  constructor() {
    this.scene.background = new THREE.Color('#1d1f24');
    this.scene.fog = new THREE.Fog('#1d1f24', 12, 26);
    this.scene.add(new THREE.HemisphereLight('#dfe8f5', '#3a3024', 1.4));
    const key = new THREE.DirectionalLight('#fff3e0', 2.4);
    key.position.set(4, 7, 3);
    this.scene.add(key);
    const rim = new THREE.DirectionalLight('#8fb6ff', 1.2);
    rim.position.set(-5, 3, -4);
    this.scene.add(rim);
    const floor = new THREE.Mesh(
      new THREE.CylinderGeometry(3.4, 3.6, 0.12, 24),
      new THREE.MeshLambertMaterial({ color: '#2b2d33', flatShading: true }),
    );
    floor.position.y = -0.06;
    this.scene.add(floor, this.holder);
  }

  show(body: BodyShape, paint: string) {
    this.holder.clear();
    const { group, paintMat } = buildCarModel(body, new THREE.Color(paint));
    this.paintMat = paintMat;
    this.holder.add(group);
  }

  setPaint(paint: string) {
    this.paintMat?.color.set(paint);
  }

  render(renderer: THREE.WebGLRenderer, dt: number, aspect: number) {
    this.angle += dt * 0.35;
    this.holder.rotation.y = this.angle;
    // On wide screens the menu sits on the left, so aim left of the car to push it right.
    const wide = aspect > 1.1;
    this.camera.aspect = aspect;
    this.camera.fov = wide ? 30 : 42;
    this.camera.position.set(0, 2.5, 10.5);
    this.camera.lookAt(wide ? -2 : 0, wide ? 0.6 : -2.6, 0);
    this.camera.updateProjectionMatrix();
    renderer.render(this.scene, this.camera);
  }
}
