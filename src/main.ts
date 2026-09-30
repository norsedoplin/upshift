import * as THREE from 'three';
import './style.css';
import { Car, RPM } from './sim/car';
import { Chassis } from './sim/chassis';
import { Input } from './input';
import { Haptics } from './haptics';
import { EngineAudio } from './audio';
import { buildCockpit, shifterPose } from './cockpit';
import { drawCluster, gearLabel } from './gauges';
import { generateTouge, SAMPLE_STEP } from './track/touge';
import { buildScenery } from './track/scenery';
import { collideWithEdges } from './track/collide';
import { Scorer, credsForRun, ScoreEvent } from './game/scoring';
import { loadProgress, saveProgress } from './game/progress';
import { paintFor } from './game/shop';
import { carById, forwardGears } from './cars';
import { Menus } from './ui/menus';
import { Showroom } from './ui/showroom';

const SIM_DT = 0.001;

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
document.getElementById('app')!.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const road = generateTouge();
buildScenery(scene, road);
const cockpit = buildCockpit();
scene.add(cockpit.root);
const showroom = new Showroom();

const progress = loadProgress();
let model = carById(progress.car);
let car = new Car(model.spec);
let chassis = new Chassis(model.chassis);
let gearSequence = [-1, 0, ...forwardGears(model.spec)];
const input = new Input();
const haptics = new Haptics();
const audio = new EngineAudio();
const scorer = new Scorer();

const $ = (id: string) => document.getElementById(id)!;
const message = $('message');
const debug = $('debug');
const debugText = $('debug-text');
const biteCanvas = $('bite') as HTMLCanvasElement;
const padStatus = $('pad-status');
const pedals = { clutch: $('bar-clutch'), brake: $('bar-brake'), throttle: $('bar-throttle') };
const hint = $('hint');
const hud = { score: $('score'), combo: $('combo'), creds: $('creds'), timer: $('timer'), progress: $('progress-fill') };
const toasts = $('toasts');

type RunState = 'idle' | 'running' | 'finished';
let run: RunState = 'idle';
let runTime = 0;
let roadIndex = 0;
let debugOn = false;
let flash = { text: '', until: 0 };

const menus = new Menus(progress, {
  start: () => audio.start(),
  drive: () => {
    resetRun();
    menus.open(null);
  },
  resume: () => menus.open(null),
  restart: () => {
    resetRun();
    menus.open(null);
  },
  toMenu: () => {
    resetRun();
    menus.open('main');
  },
  carChanged: () => applyCar(),
  settingsChanged: () => applySettings(),
  preview: (m, paint) => {
    if (m && paint) {
      if (previewKey !== m.id) showroom.show(m.body, paint);
      else showroom.setPaint(paint);
      previewKey = m.id;
    } else previewKey = '';
  },
});
let previewKey = '';
$('loading').remove();

/** Swap in the selected car (physics, sound, paint) and put it on the start line. */
function applyCar() {
  const next = carById(progress.car);
  const paint = paintFor(progress, next.id).color;
  cockpit.paint.color.set(paint);
  if (next.id !== model.id) {
    model = next;
    car = new Car(model.spec);
    chassis = new Chassis(model.chassis);
    gearSequence = [-1, 0, ...forwardGears(model.spec)];
    audio.setEngine(model.cylinders);
    resetRun();
  }
}

function applySettings() {
  const st = progress.settings;
  haptics.strength = st.rumble;
  audio.setVolume(st.volume);
}

function resetRun() {
  car.reset();
  const p = road.sampleAt(road.startS - 18);
  chassis.place(p.x, p.z, p.yaw);
  roadIndex = Math.round(p.s / SAMPLE_STEP);
  scorer.reset();
  run = 'idle';
  runTime = 0;
  toasts.innerHTML = '';
}

cockpit.paint.color.set(paintFor(progress, model.id).color);
audio.setEngine(model.cylinders);
applySettings();
resetRun();

function resize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  renderer.setSize(w, h);
  cockpit.camera.aspect = w / h;
  cockpit.camera.fov = w / h < 1 ? 80 : 60;
  cockpit.camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

function showFlash(text: string, seconds = 1.6) {
  flash = { text, until: performance.now() + seconds * 1000 };
}

function collide() {
  const r = collideWithEdges(road, chassis, car, roadIndex);
  roadIndex = r.loc.index;
  return r;
}

let last = performance.now();
let simAccumulator = 0;
let time = 0;
let pitch = 0;
let grade = 0;
let driveTime = 0;

function frame(now: number) {
  requestAnimationFrame(frame);
  // rAF timestamps can be slightly older than performance.now() on the first frame.
  const dt = Math.min(0.1, Math.max(0, (now - last) / 1000));
  last = now;
  time += dt;

  const c = input.read(dt);
  const nav = input.nav(dt);
  const pad = input.gamepad();

  // Menus pause the world: no physics, no engine sound, no rumble.
  audio.setMuted(menus.isOpen);
  document.body.classList.toggle('in-menu', menus.isOpen);
  if (menus.isOpen) {
    menus.update(nav);
    simAccumulator = 0;
    haptics.update(dt, car, null);
    if (menus.screen === 'garage') {
      showroom.render(renderer, dt, window.innerWidth / window.innerHeight);
    } else {
      renderer.render(scene, cockpit.camera);
    }
    return;
  }
  driveTime += dt;

  if (c.pause) {
    menus.open('pause');
    haptics.stop(pad);
    return;
  }
  if (c.toggleDebug) {
    debugOn = !debugOn;
    debug.classList.toggle('hidden', !debugOn);
  }
  if (c.reset) resetRun();
  if (c.ignition) {
    if (car.running) car.stopEngine();
    else car.crank();
  }
  if (c.shiftUp || c.shiftDown) {
    const idx = gearSequence.indexOf(car.gear) + (c.shiftUp ? 1 : -1);
    if (idx >= 0 && idx < gearSequence.length) car.shiftTo(gearSequence[idx], c.clutch);
  }

  // Road grade along the car's heading.
  const here = road.sampleAt(roadIndex * SAMPLE_STEP);
  const ahead = road.sampleAt(roadIndex * SAMPLE_STEP + 2);
  const behind = road.sampleAt(roadIndex * SAMPLE_STEP - 2);
  const roadGrade = (ahead.h - behind.h) / 4;
  grade = roadGrade * Math.cos(chassis.yaw - here.yaw);
  const slope = grade / Math.sqrt(1 + grade * grade);

  simAccumulator += dt;
  const steps = Math.floor(simAccumulator / SIM_DT);
  simAccumulator -= steps * SIM_DT;
  let maxImpact = 0;
  for (let i = 0; i < steps; i++) {
    car.step(SIM_DT, {
      throttle: c.throttle,
      brake: c.brake,
      clutch: c.clutch,
      handbrake: c.handbrake,
      slope,
      extraForce: chassis.extraForce,
    });
    chassis.step(SIM_DT, car, { steer: c.steer, handbrake: c.handbrake });
    if (i % 4 === 0 || i === steps - 1) maxImpact = Math.max(maxImpact, collide().impact);
  }
  if (maxImpact > 0.8) {
    car.pushEvent({ type: 'wall', impact: maxImpact });
    haptics.jolt(Math.min(1, maxImpact / 8));
  }

  const events = car.drainEvents();
  for (const e of events) {
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

  // Run flow: the clock starts at the start line and stops at the finish.
  const s = roadIndex * SAMPLE_STEP;
  if (run === 'idle' && s >= road.startS) {
    run = 'running';
    runTime = 0;
    scorer.reset();
  }
  if (run === 'running') {
    runTime += dt;
    scorer.update(dt, car, { throttle: c.throttle, brake: c.brake, clutch: c.clutch }, events);
    for (const e of scorer.drain()) showToast(e);
    if (s >= road.finishS) finishRun();
  }

  // Place the car and camera.
  const loc = road.sampleAt(s);
  const ground = loc.h + 0.15;
  pitch += (Math.atan(grade) - pitch) * Math.min(1, dt * 8);
  const root = cockpit.root;
  root.position.set(chassis.x, ground, chassis.z);
  // Body roll leans away from the corner a little.
  const roll = Math.max(-0.05, Math.min(0.05, -chassis.latAccel * 0.004));
  root.rotation.set(pitch, chassis.yaw, roll, 'YXZ');

  cockpit.wheel.rotation.z = Math.max(-7.8, Math.min(7.8, chassis.steerAngle * 14));
  const [col, row] = shifterPose(car.gear);
  cockpit.shifter.rotation.set(row * 0.22, 0, -col * 0.2);
  cockpit.clutchPedal.rotation.x = -c.clutch * 0.5;
  cockpit.brakePedal.rotation.x = -c.brake * 0.4;
  cockpit.throttlePedal.rotation.x = -c.throttle * 0.4;

  const tyreSlip = Math.max(Math.abs(chassis.slipFront), Math.abs(chassis.slipRear)) * Math.min(1, Math.abs(car.speed) / 5);
  haptics.update(dt, car, pad, tyreSlip);
  audio.update(car, tyreSlip);

  // Head: lean with acceleration and cornering, shake with vibration.
  const shake = haptics.strong * 0.004 + (car.running ? 0.0004 + (car.rpm / 7000) * 0.0006 : 0);
  cockpit.head.position.set(
    -0.37 + (Math.random() - 0.5) * shake + Math.max(-0.04, Math.min(0.04, -chassis.latAccel * 0.004)),
    1.2 + (Math.random() - 0.5) * shake,
    0.1 + Math.max(-0.05, Math.min(0.05, car.accel * 0.006)),
  );
  cockpit.head.rotation.x = Math.max(-0.04, Math.min(0.04, car.accel * 0.004));

  drawCluster(cockpit.clusterCanvas, car, time, progress.settings.units);
  cockpit.cluster.needsUpdate = true;

  updateHud(c.clutch, c.brake, c.throttle, pad, s);
  renderer.render(scene, cockpit.camera);
}

function finishRun() {
  run = 'finished';
  const stats = { ...scorer.stats };
  const earned = credsForRun(stats);
  const best = stats.score > progress.bestScore;
  progress.creds += earned;
  progress.runs += 1;
  progress.bestScore = Math.max(progress.bestScore, stats.score);
  saveProgress(progress);
  haptics.stop(input.gamepad());
  menus.showSummary(stats, earned, best, formatTime(runTime));
}

function formatTime(t: number) {
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${m}:${s.toFixed(1).padStart(4, '0')}`;
}

function showToast(e: ScoreEvent) {
  const el = document.createElement('div');
  el.className = `toast ${e.good ? 'good' : 'bad'}`;
  el.innerHTML = `<span>${e.label}</span><b>${e.points > 0 ? '+' : ''}${e.points}</b>`;
  toasts.prepend(el);
  while (toasts.children.length > 4) toasts.lastChild!.remove();
  setTimeout(() => el.classList.add('fade'), 1800);
  setTimeout(() => el.remove(), 2400);
}

function updateHud(clutch: number, brake: number, throttle: number, pad: Gamepad | null, s: number) {
  pedals.clutch.style.height = `${clutch * 100}%`;
  pedals.brake.style.height = `${brake * 100}%`;
  pedals.throttle.style.height = `${throttle * 100}%`;
  const inBite = car.clutchCapacity > 0 && car.clutchCapacity < car.spec.clutchMaxTorque * 0.95;
  pedals.clutch.classList.toggle('bite', inBite);

  hud.score.textContent = scorer.score.toLocaleString();
  hud.combo.textContent = scorer.combo > 0 ? `×${scorer.multiplier.toFixed(2)}` : '';
  hud.creds.textContent = `◆ ${progress.creds.toLocaleString()}`;
  hud.timer.textContent = run === 'idle' ? 'Drive to the start line' : formatTime(runTime);
  const frac = Math.min(1, Math.max(0, (s - road.startS) / (road.finishS - road.startS)));
  hud.progress.style.width = `${frac * 100}%`;

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
  hint.classList.toggle('hidden', !progress.settings.hints || driveTime > 25);

  if (debugOn) {
    const speedFactor = progress.settings.units === 'mph' ? 2.23694 : 3.6;
    debugText.textContent = [
      `rpm        ${car.rpm.toFixed(0)}`,
      `speed      ${(car.speed * speedFactor).toFixed(1)} ${progress.settings.units === 'mph' ? 'mph' : 'km/h'}`,
      `gear       ${gearLabel(car.gear)}`,
      `clutch     ${(clutch * 100).toFixed(0)}%  cap ${car.clutchCapacity.toFixed(0)} Nm`,
      `clutch Tq  ${car.clutchTorque.toFixed(0)} Nm  ${car.locked ? 'LOCKED' : 'slipping'}`,
      `slip       ${car.slipRpm.toFixed(0)} rpm`,
      `throttle   ${(car.throttleEff * 100).toFixed(0)}%  load ${(car.load * 100).toFixed(0)}%`,
      `out shaft  ${(car.outputOmega * RPM).toFixed(0)} rpm`,
      `steer      ${(chassis.steerAngle * 57.3).toFixed(1)}°  lat ${(chassis.latAccel / 9.81).toFixed(2)} g`,
      `slip ang   F ${(chassis.slipFront * 57.3).toFixed(1)}°  R ${(chassis.slipRear * 57.3).toFixed(1)}°`,
      `road       ${s.toFixed(0)} m  grade ${(grade * 100).toFixed(1)}%`,
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
(window as unknown as { upshift: unknown }).upshift = {
  get car() {
    return car;
  },
  get chassis() {
    return chassis;
  },
  road,
  scorer,
  haptics,
  menus,
  progress,
  resetRun,
  finishRun,
};
