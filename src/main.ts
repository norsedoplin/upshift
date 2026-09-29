import * as THREE from 'three';
import './style.css';
import { Car, RPM } from './sim/car';
import { Input } from './input';
import { Haptics } from './haptics';
import { EngineAudio } from './audio';
import { buildCockpit, buildWorld, shifterPose, terrainHeight } from './world';
import { drawCluster, gearLabel } from './gauges';

const SIM_DT = 0.001;
const START_S = 5;

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
document.getElementById('app')!.appendChild(renderer.domElement);

const scene = new THREE.Scene();
buildWorld(scene);
const cockpit = buildCockpit();
scene.add(cockpit.root);

const car = new Car();
const input = new Input();
const haptics = new Haptics();
const audio = new EngineAudio();

// Car pose in the world. Heading 0 = driving along -z (down the road).
const pose = { x: 0, z: -START_S, yaw: 0, pitch: 0, steer: 0 };

const $ = (id: string) => document.getElementById(id)!;
const overlay = $('overlay');
const message = $('message');
const debug = $('debug');
const debugText = $('debug-text');
const biteCanvas = $('bite') as HTMLCanvasElement;
const padStatus = $('pad-status');
const pedals = { clutch: $('bar-clutch'), brake: $('bar-brake'), throttle: $('bar-throttle') };
const hint = $('hint');

let started = false;
const debugState: { inputs?: unknown } = {};
let debugOn = false;
let flash = { text: '', until: 0 };

overlay.addEventListener('click', () => {
  audio.start();
  overlay.classList.add('hidden');
  started = true;
});

function reset() {
  car.gear = 0;
  car.engineOmega = 0;
  car.outputOmega = 0;
  car.speed = 0;
  car.stopEngine();
  car.locked = false;
  pose.x = 0;
  pose.z = -START_S;
  pose.yaw = 0;
}

function resize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  renderer.setSize(w, h);
  cockpit.camera.aspect = w / h;
  // Wider screens see more of the road; narrow ones keep the dashboard in view.
  cockpit.camera.fov = w / h < 1 ? 80 : 60;
  cockpit.camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

function showFlash(text: string, seconds = 1.6) {
  flash = { text, until: performance.now() + seconds * 1000 };
}

let last = performance.now();
let simAccumulator = 0;
let time = 0;

function frame(now: number) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  time += dt;

  const c = input.read(dt);
  const pad = input.gamepad();

  if (c.toggleDebug) {
    debugOn = !debugOn;
    debug.classList.toggle('hidden', !debugOn);
  }
  if (c.reset) reset();
  if (c.ignition) {
    if (car.running) car.stopEngine();
    else car.crank();
  }
  const sequence = [-1, 0, 1, 2, 3, 4, 5];
  if (c.shiftUp || c.shiftDown) {
    const idx = sequence.indexOf(car.gear) + (c.shiftUp ? 1 : -1);
    if (idx >= 0 && idx < sequence.length) car.shiftTo(sequence[idx], c.clutch);
  }

  // Slope along the car's heading, from the terrain under it.
  const fx = -Math.sin(pose.yaw);
  const fz = -Math.cos(pose.yaw);
  const h0 = terrainHeight(pose.x - fx * 1.2, pose.z - fz * 1.2);
  const h1 = terrainHeight(pose.x + fx * 1.2, pose.z + fz * 1.2);
  const grade = (h1 - h0) / 2.4;
  const slope = grade / Math.sqrt(1 + grade * grade);

  simAccumulator += dt;
  const steps = Math.floor(simAccumulator / SIM_DT);
  simAccumulator -= steps * SIM_DT;
  const inputs = { throttle: c.throttle, brake: c.brake, clutch: c.clutch, handbrake: c.handbrake, slope };
  for (let i = 0; i < steps; i++) car.step(SIM_DT, inputs);
  debugState.inputs = inputs;

  for (const e of car.drainEvents()) {
    if (e.type === 'stall') {
      haptics.stall();
      showFlash('Stalled', 2);
    } else if (e.type === 'grind') {
      haptics.grind();
      audio.grind();
      showFlash('Clutch in to change gear');
    } else if (e.type === 'lock') {
      haptics.lock(e.slip);
    }
  }

  // Kinematic steering: fine for a straight test road, real tyres come later.
  pose.steer += (c.steer - pose.steer) * Math.min(1, dt * 10);
  const v = car.speed;
  const steerAngle = pose.steer * 0.5 / (1 + Math.abs(v) / 18);
  pose.yaw -= (v * Math.tan(steerAngle) / 2.5) * dt;
  pose.x += fx * v * dt;
  pose.z += fz * v * dt;
  const ground = terrainHeight(pose.x, pose.z) + 0.15;
  pose.pitch += (Math.atan(grade) - pose.pitch) * Math.min(1, dt * 8);

  const root = cockpit.root;
  root.position.set(pose.x, ground, pose.z);
  root.rotation.set(pose.pitch, pose.yaw, 0, 'YXZ');

  // Cockpit animation.
  cockpit.wheel.rotation.z = -pose.steer * 2.4;
  const [col, row] = shifterPose(car.gear);
  cockpit.shifter.rotation.set(row * 0.22, 0, -col * 0.2);
  cockpit.clutchPedal.rotation.x = -c.clutch * 0.5;
  cockpit.brakePedal.rotation.x = -c.brake * 0.4;
  cockpit.throttlePedal.rotation.x = -c.throttle * 0.4;

  haptics.update(dt, car, pad);
  audio.update(car);

  // Head: lean with acceleration and shake with vibration.
  const shake = haptics.strong * 0.004 + (car.running ? 0.0004 + (car.rpm / 7000) * 0.0006 : 0);
  cockpit.head.position.set(
    -0.37 + (Math.random() - 0.5) * shake,
    1.2 + (Math.random() - 0.5) * shake,
    0.1 + Math.max(-0.05, Math.min(0.05, car.accel * 0.006)),
  );
  cockpit.head.rotation.x = Math.max(-0.04, Math.min(0.04, car.accel * 0.004));

  drawCluster(cockpit.clusterCanvas, car, time);
  cockpit.cluster.needsUpdate = true;

  updateHud(c.clutch, c.brake, c.throttle, pad);
  renderer.render(scene, cockpit.camera);
}

function updateHud(clutch: number, brake: number, throttle: number, pad: Gamepad | null) {
  pedals.clutch.style.height = `${clutch * 100}%`;
  pedals.brake.style.height = `${brake * 100}%`;
  pedals.throttle.style.height = `${throttle * 100}%`;
  const inBite = car.clutchCapacity > 0 && car.clutchCapacity < car.spec.clutchMaxTorque * 0.95;
  pedals.clutch.classList.toggle('bite', inBite);

  const gp = pad ? '△' : 'I';
  let msg = '';
  if (performance.now() < flash.until) msg = flash.text;
  else if (!car.running && !car.cranking)
    msg = car.gear !== 0 ? `Clutch in (or neutral), then ${gp} to start` : `Press ${gp} to start the engine`;
  message.textContent = msg;
  message.classList.toggle('visible', msg !== '');

  const hasRumble = !!(pad as unknown as { vibrationActuator?: unknown } | null)?.vibrationActuator;
  padStatus.textContent = pad
    ? `${shortPadName(pad.id)}${hasRumble ? '' : ' · no rumble in this browser'}`
    : 'No controller: press any button on it';
  hint.classList.toggle('hidden', started && time > 25);

  if (debugOn) {
    debugText.textContent = [
      `rpm        ${car.rpm.toFixed(0)}`,
      `speed      ${(car.speed * 3.6).toFixed(1)} km/h`,
      `gear       ${gearLabel(car.gear)}`,
      `clutch     ${(clutch * 100).toFixed(0)}%  cap ${car.clutchCapacity.toFixed(0)} Nm`,
      `clutch Tq  ${car.clutchTorque.toFixed(0)} Nm  ${car.locked ? 'LOCKED' : 'slipping'}`,
      `slip       ${car.slipRpm.toFixed(0)} rpm`,
      `throttle   ${(car.throttleEff * 100).toFixed(0)}%  load ${(car.load * 100).toFixed(0)}%`,
      `out shaft  ${(car.outputOmega * RPM).toFixed(0)} rpm`,
      `rumble     S ${haptics.strong.toFixed(2)}  W ${haptics.weak.toFixed(2)}`,
    ].join('\n');
    drawBite(clutch);
  }
}

function shortPadName(id: string) {
  if (/dualsense|0ce6/i.test(id)) return 'DualSense';
  if (/dualshock|05c4|09cc/i.test(id)) return 'DualShock 4';
  if (/xbox|xinput|045e/i.test(id)) return 'Xbox controller';
  return id.split('(')[0].trim().slice(0, 32) || 'Controller';
}

function drawBite(pedal: number) {
  const ctx = biteCanvas.getContext('2d')!;
  const W = biteCanvas.width;
  const H = biteCanvas.height;
  ctx.clearRect(0, 0, W, H);
  ctx.strokeStyle = 'rgba(255,255,255,0.15)';
  ctx.strokeRect(0.5, 0.5, W - 1, H - 1);
  ctx.strokeStyle = '#ff7a3d';
  ctx.lineWidth = 2;
  ctx.beginPath();
  for (let i = 0; i <= 100; i++) {
    const p = 1 - i / 100; // x axis: pedal released to the right
    const y = H - (car.clutchCapacityFor(p) / car.spec.clutchMaxTorque) * (H - 6) - 3;
    if (i === 0) ctx.moveTo(0, y);
    else ctx.lineTo((i / 100) * W, y);
  }
  ctx.stroke();
  const x = (1 - pedal) * W;
  ctx.fillStyle = '#f4f1e8';
  ctx.fillRect(x - 1, 0, 2, H);
}

requestAnimationFrame(frame);

// Let automated tests and the console poke at the sim.
(window as unknown as { upshift: unknown }).upshift = { car, pose, haptics, debugState };
