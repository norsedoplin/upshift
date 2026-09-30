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
  // Player camera: pitch above the floor and distance, plus how long since they last touched it.
  private pitch = 0.23;
  private dist = 10.8;
  private idle = 99;

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
    const { group, paintMat } = buildCarModel(body, new THREE.Color(paint), { lightsUp: true });
    this.paintMat = paintMat;
    this.holder.add(group);
  }

  setPaint(paint: string) {
    this.paintMat?.color.set(paint);
  }

  /** Turn the car (dx), tilt the camera (dy) and zoom (dz, positive = closer). */
  orbit(dx: number, dy: number, dz = 0) {
    if (dx === 0 && dy === 0 && dz === 0) return;
    this.angle += dx;
    this.pitch = Math.min(1.2, Math.max(0.05, this.pitch + dy));
    this.dist = Math.min(14, Math.max(7, this.dist * Math.exp(-dz)));
    this.idle = 0;
  }

  /** Right stick turns and tilts, L2/R2 zoom. Call once a frame while the garage is open. */
  control(pad: Gamepad | null, dt: number) {
    if (!pad) return;
    const dz = (v: number) => (Math.abs(v) < 0.15 ? 0 : v);
    const rx = dz(pad.axes[2] ?? 0);
    const ry = dz(pad.axes[3] ?? 0);
    const zoom = (pad.buttons[7]?.value ?? 0) - (pad.buttons[6]?.value ?? 0);
    this.orbit(rx * 2.2 * dt, -ry * 1.2 * dt, dz(zoom) * 1.2 * dt);
  }

  /** Soft studio reflections for the paint, baked once. */
  private ensureEnvironment(renderer: THREE.WebGLRenderer) {
    if (this.scene.environment) return;
    const pm = new THREE.PMREMGenerator(renderer);
    this.scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture;
    pm.dispose();
  }

  render(renderer: THREE.WebGLRenderer, dt: number, aspect: number) {
    this.ensureEnvironment(renderer);
    // The turntable spins on its own until you take the camera, and again after a few idle seconds.
    this.idle += dt;
    if (this.idle > 4) this.angle += dt * 0.35 * Math.min(1, (this.idle - 4) / 1.5);
    this.holder.rotation.y = this.angle;
    // On wide screens the menu sits on the left, so aim left of the car to push it right.
    const wide = aspect > 1.1;
    this.camera.aspect = aspect;
    this.camera.fov = wide ? 30 : 42;
    // Zooming in brings the car to the middle of the free space; the framing offset shrinks with distance.
    const f = this.dist / 10.8;
    const target = new THREE.Vector3(wide ? -2 * f : 0, wide ? 0.6 : -2.6 * f + 0.6 * (1 - f), 0);
    this.camera.position.set(0, Math.sin(this.pitch) * this.dist, Math.cos(this.pitch) * this.dist);
    this.camera.lookAt(target);
    this.camera.updateProjectionMatrix();
    renderer.render(this.scene, this.camera);
  }

  /** Draw the car, centred, into one rectangle of the screen (CSS pixels): the main menu's ride tile. */
  renderInto(renderer: THREE.WebGLRenderer, dt: number, rect: { left: number; top: number; width: number; height: number }) {
    if (rect.width < 2 || rect.height < 2) return;
    this.ensureEnvironment(renderer);
    this.idle += dt;
    this.angle += dt * 0.3;
    this.holder.rotation.y = this.angle;
    const h = renderer.domElement.clientHeight;
    const y = h - rect.top - rect.height;
    this.camera.aspect = rect.width / rect.height;
    // Fit the car's length (about 4.5 m) to the narrower side of the tile.
    this.camera.fov = this.camera.aspect > 1.2 ? 26 : 26 * Math.min(1.8, 1.2 / this.camera.aspect);
    this.camera.position.set(0, Math.sin(0.22) * 9.5, Math.cos(0.22) * 9.5);
    this.camera.lookAt(0, 0.55, 0);
    this.camera.updateProjectionMatrix();
    renderer.setScissorTest(true);
    renderer.setScissor(rect.left, y, rect.width, rect.height);
    renderer.setViewport(rect.left, y, rect.width, rect.height);
    renderer.render(this.scene, this.camera);
    renderer.setScissorTest(false);
    renderer.setViewport(0, 0, renderer.domElement.clientWidth, h);
  }
}
