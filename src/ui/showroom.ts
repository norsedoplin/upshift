// A small showroom scene: the selected car on a turntable, for the garage screen.

import * as THREE from 'three';
import type { BodyShape } from '../cars';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { buildCarModel } from './carModel';

export class Showroom {
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(32, 1, 0.1, 100);
  private holder = new THREE.Group();
  private paintMat: THREE.MeshStandardMaterial | null = null;
  private angle = 0.6;

  constructor() {
    this.scene.background = new THREE.Color('#1d1f24');
    this.scene.fog = new THREE.Fog('#1d1f24', 12, 26);
    this.scene.environmentIntensity = 0.55;
    this.scene.add(new THREE.HemisphereLight('#dfe8f5', '#3a3024', 0.5));
    const key = new THREE.DirectionalLight('#fff3e0', 2.6);
    key.position.set(4, 7, 3);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.bias = -0.0005;
    key.shadow.normalBias = 0.02;
    const sc = key.shadow.camera;
    sc.left = sc.bottom = -4;
    sc.right = sc.top = 4;
    sc.near = 1;
    sc.far = 20;
    this.scene.add(key);
    const rim = new THREE.DirectionalLight('#8fb6ff', 1.6);
    rim.position.set(-5, 3, -4);
    this.scene.add(rim);
    const floor = new THREE.Mesh(
      new THREE.CylinderGeometry(3.4, 3.6, 0.12, 48),
      new THREE.MeshStandardMaterial({ color: '#2b2d33', roughness: 0.3, metalness: 0.2 }),
    );
    floor.position.y = -0.06;
    floor.receiveShadow = true;
    // A thin lit ring round the turntable's edge.
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(3.42, 0.02, 4, 64).rotateX(Math.PI / 2),
      new THREE.MeshStandardMaterial({ color: '#ff7a3d', emissive: '#ff7a3d', emissiveIntensity: 1.2 }),
    );
    ring.position.y = 0.0;
    this.scene.add(floor, ring, this.holder);
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
    // Soft studio reflections for the paint, baked once.
    if (!this.scene.environment) {
      const pm = new THREE.PMREMGenerator(renderer);
      this.scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture;
      pm.dispose();
    }
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
