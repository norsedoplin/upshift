import * as THREE from 'three';
import './style.css';
import { Car, RPM } from './sim/car';
import { Chassis } from './sim/chassis';
import { Input } from './input';
import { keysLabel, padLabel, type Action } from './bindings';
import { DualSense } from './dualsense';
import { Haptics } from './haptics';
import { EngineAudio } from './audio';
import { buildCockpit, shifterPose } from './cockpit';
import { drawCluster, drawSpeedo, gearLabel } from './gauges';
import { roadPoint } from './track/touge';
import { MAPS, cityForMap, roadFor } from './track/maps';
import { buildCityScenery } from './track/cityScene';
import { Minimap } from './ui/minimap';
import { buildScenery, SUN_DIR, updateTreeDetail } from './track/scenery';
import { DayCycle } from './track/daylight';
import { Graphics, bakeEnvironment } from './graphics';
import { CAR_HALF_WIDTH, collideWithCity, collideWithEdges } from './track/collide';
import { ComicFx } from './ui/comicFx';
import { Scorer, cashoutFor, credsForRun, tierFor, ScoreEvent } from './game/scoring';
import { CAMERA_VIEWS, loadProgress, saveProgress } from './game/progress';
import { paintFor } from './game/shop';
import { specFor, tuneFor } from './game/tuning';
import { carById, forwardGears } from './cars';
import { Menus } from './ui/menus';
import { Showroom } from './ui/showroom';
import { buildCarModel } from './ui/carModel';

const SIM_DT = 0.001;
const SKIP_TITLE = 'upshift.skipTitle';

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
document.getElementById('app')!.appendChild(renderer.domElement);

const progress = loadProgress();
const scene = new THREE.Scene();
// A touge map has a road; a free-roam map is a town instead (and the road goes unused).
const city = cityForMap(progress.settings.map);
const road = roadFor(progress.settings.map);
const cityScenery = city ? buildCityScenery(scene, city) : null;
const scenery = cityScenery ?? buildScenery(scene, road);
const minimap = city ? new Minimap(document.getElementById('minimap') as HTMLCanvasElement, city) : null;
/** In town: how close the car last came to hitting something, for close calls. */
let cityGap = Infinity;
const graphics = new Graphics(renderer, scene, scenery.sun, SUN_DIR);
const day = new DayCycle(scenery.day);
let envTarget = bakeEnvironment(renderer, scenery.envScene);
scene.environment = envTarget.texture;
/** Move the sun, recolour the sky and, now and then, re-bake reflections to match. */
function updateDay(dt: number) {
  if (day.update(dt, progress.settings.timeOfDay)) {
    envTarget = bakeEnvironment(renderer, scenery.envScene, envTarget);
    scene.environment = envTarget.texture;
  }
  graphics.setSunDir(day.dir);
  // Nights are properly dark: the exposure doesn't lift them, so the headlights do the work.
  renderer.toneMappingExposure = 1.05 + day.sky.dark * 0.1;
  headlights.intensity = day.sky.dark * 700;
  highBeam.intensity = day.sky.dark * 1100;
}
const showroom = new Showroom();

let model = carById(progress.car);
let cockpit = buildCockpit(model.interior);
scene.add(cockpit.root);
// The body you see from outside (chase view). Its origin is on the ground.
let exterior = buildCarModel(model.body, new THREE.Color(paintFor(progress, model.id).color));
scene.add(exterior.group);
// Headlights: one wide beam from the nose, only switched on after dark.
const headlights = new THREE.SpotLight('#fff1d8', 0, 0, 0.62, 0.55, 1.6);
const headlightAim = new THREE.Object3D();
// A narrower, longer beam on top, like high beams on an empty mountain road.
const highBeam = new THREE.SpotLight('#fff6e6', 0, 0, 0.3, 0.45, 1.25);
const highAim = new THREE.Object3D();
highBeam.position.set(0, 0.8, -2.1);
highAim.position.set(0, -0.2, -60);
highBeam.target = highAim;
headlights.position.set(0, 0.75, -2.1);
headlightAim.position.set(0, -0.6, -22);
headlights.target = headlightAim;
const lightRig = new THREE.Group();
lightRig.add(headlights, headlightAim, highBeam, highAim);
scene.add(lightRig);
const camera = new THREE.PerspectiveCamera(60, 1, 0.03, 3000);
const chaseCam = { pos: new THREE.Vector3(), yaw: 0, ready: false };
let car = new Car(specFor(progress, model));
let tuneKey = JSON.stringify(tuneFor(progress, model.id));
let chassis = new Chassis(model.chassis);
let gearSequence = [-1, 0, ...forwardGears(model.spec)];
const input = new Input();
const haptics = new Haptics();
// Reconnect a DualSense the player linked on an earlier visit (no prompt needed).
void haptics.dualsense.restore().catch(() => {});
const dualSenseLabel = () =>
  haptics.dualsense.connected ? `Connected (${haptics.dualsense.bluetooth ? 'Bluetooth' : 'USB'})` : 'Connect';
const audio = new EngineAudio();
const scorer = new Scorer();

const $ = (id: string) => document.getElementById(id)!;
const message = $('message');
const debug = $('debug');
const debugText = $('debug-text');
const biteCanvas = $('bite') as HTMLCanvasElement;
const padStatus = $('pad-status');
const pedals = { clutch: $('bar-clutch'), brake: $('bar-brake'), throttle: $('bar-throttle'), boost: $('bar-boost'), boostWrap: $('pedal-boost') };
const hint = $('hint');
const speedo = $('speedo') as HTMLCanvasElement;
const hud = {
  score: $('score'),
  combo: $('combo'),
  tier: $('tier'),
  mult: $('mult'),
  comboFill: $('combo-fill'),
  flowFill: $('flow-fill'),
  creds: $('creds'),
  timer: $('timer'),
  progress: $('progress-fill'),
};
const cashoutEl = $('cashout');
let shownScore = 0;
let lastTier = '';
const toasts = $('toasts');
const comic = new ComicFx($('fx-canvas') as HTMLCanvasElement);
const tierBanner = $('tier-banner');
const edgeFlash = $('edge-flash');
/** 0..1 kick after a good shift or a new tier: widens the view and fires the speed lines. */
let punch = 0;
/** 0..1.2 smoothed forward acceleration, for the push-back feel. */
let pull = 0;
/** 0..1 how fast the car is going, for the speed effects. */
let speed01 = 0;
const carScreen = { x: 0, y: 0, scale: 1 };

type RunState = 'idle' | 'running' | 'finished';
let run: RunState = 'idle';
let runTime = 0;
let roadIndex = 0;
let roadS = 0; // exact distance along the road; roadIndex is only the nearest 2 m sample
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
    cashOut();
    resetRun();
    menus.open(null);
  },
  toMenu: () => {
    cashOut();
    resetRun();
    menus.open('main');
  },
  carChanged: () => applyCar(),
  testRumble: () => haptics.test(input.gamepad()),
  startCapture: (kind) => input.startCapture(kind),
  pollCapture: () => input.pollCapture(),
  cancelCapture: () => input.cancelCapture(),
  dualSense: () => ({
    supported: DualSense.supported(),
    label: dualSenseLabel(),
    connect: async () => {
      try {
        if (!haptics.dualsense.connected) await haptics.dualsense.request();
        return dualSenseLabel();
      } catch (e) {
        console.warn('DualSense connect failed', e);
        // Browsers only show the device picker after a click or key press, not a controller button.
        return e instanceof DOMException && e.name === 'SecurityError' ? 'Click it with the mouse' : 'Could not connect';
      }
    },
  }),
  settingsChanged: () => applySettings(),
  mapChanged: () => {
    // Each road builds its own world, so the simplest clean switch is a fresh page load
    // that comes straight back to the menu.
    saveProgress(progress);
    try {
      sessionStorage.setItem(SKIP_TITLE, '1');
    } catch {
      // No session storage: the title screen shows again, which is fine.
    }
    location.reload();
  },
  preview: (m, paint) => {
    if (m && paint) {
      if (previewKey !== m.id) showroom.show(m.body, paint);
      else showroom.setPaint(paint);
      previewKey = m.id;
    } else previewKey = '';
  },
});
let previewKey = '';
// Mouse clutch: a click on the road grabs the pointer; letting it go (Esc) pauses.
window.addEventListener('mousedown', (e) => {
  if (!menus.isOpen && e.button === 0) input.grabMouse(document.body);
});
document.addEventListener('pointerlockchange', () => {
  if (!document.pointerLockElement && input.mouseClutch && !menus.isOpen) menus.open('pause');
});
// Back from a map change: skip the title and land on the main menu.
{
  let skip = false;
  try {
    skip = sessionStorage.getItem(SKIP_TITLE) === '1';
    sessionStorage.removeItem(SKIP_TITLE);
  } catch {
    // ignore
  }
  if (skip) {
    menus.open('main');
    // Sound can only start after a click or key press.
    const wake = () => audio.start();
    window.addEventListener('pointerdown', wake, { once: true });
    window.addEventListener('keydown', wake, { once: true });
  }
}

// Garage camera: drag anywhere outside the menu panel to turn and tilt, scroll to zoom.
{
  let drag: { x: number; y: number } | null = null;
  const inGarage = (e: Event) => (menus.screen === 'garage' || menus.screen === 'tune') && !(e.target as HTMLElement | null)?.closest?.('.menu-panel');
  window.addEventListener('pointerdown', (e) => {
    if (inGarage(e)) drag = { x: e.clientX, y: e.clientY };
  });
  window.addEventListener('pointermove', (e) => {
    if (!drag || (menus.screen !== 'garage' && menus.screen !== 'tune')) return;
    showroom.orbit((e.clientX - drag.x) * 0.008, (e.clientY - drag.y) * 0.005);
    drag = { x: e.clientX, y: e.clientY };
  });
  window.addEventListener('pointerup', () => (drag = null));
  window.addEventListener(
    'wheel',
    (e) => {
      if (inGarage(e)) showroom.orbit(0, 0, -e.deltaY * 0.001);
    },
    { passive: true },
  );
}
$('loading').remove();

/** Swap in the selected car (physics, sound, paint) and put it on the start line. */
function applyCar() {
  const next = carById(progress.car);
  const paint = paintFor(progress, next.id).color;
  if (next.id !== model.id) {
    model = next;
    scene.remove(cockpit.root, exterior.group);
    cockpit.dispose();
    cockpit = buildCockpit(model.interior);
    exterior = buildCarModel(model.body, new THREE.Color(paint));
    scene.add(cockpit.root, exterior.group);
    attachCamera();
    car = new Car(specFor(progress, model));
    tuneKey = JSON.stringify(tuneFor(progress, model.id));
    chassis = new Chassis(model.chassis);
    gearSequence = [-1, 0, ...forwardGears(model.spec)];
    audio.setEngine(model.cylinders);
    resetRun();
  }
  // New parts fitted: rebuild the drivetrain with them.
  const key = JSON.stringify(tuneFor(progress, model.id));
  if (key !== tuneKey) {
    tuneKey = key;
    car = new Car(specFor(progress, model));
    resetRun();
  }
  audio.exhaust = tuneFor(progress, model.id).exhaust ?? 0;
  const tb = car.spec.turbo;
  pedals.boostWrap.classList.toggle('hidden', !tb);
  cockpit.paint.color.set(paint);
  exterior.paintMat.color.set(paint);
}

/** The on-screen control hint, written from the current bindings. */
function updateHint() {
  const b = progress.settings.bindings;
  const p = (a: Action) => padLabel(b.pad[a]);
  const k = (a: Action) => keysLabel(b.keys[a]);
  const steerPad = b.pad.steerLeft?.kind === 'axis' && b.pad.steerRight?.kind === 'axis' && b.pad.steerLeft.index === b.pad.steerRight.index ? padLabel(b.pad.steerLeft).replace(/ [←→↑↓]$/, '') : `${p('steerLeft')}/${p('steerRight')}`;
  hint.innerHTML =
    `<b>Controller</b> ${p('clutch')} clutch · ${p('gas')} gas · ${p('brake')} brake · ${steerPad} steer · ${p('shiftDown')}/${p('shiftUp')} shift · ${p('ignition')} ignition · ${p('handbrake')} handbrake · ${p('camera')} camera · ${p('pause')} pause` +
    `<br /><b>Keyboard</b> ${k('clutch')} clutch (hold Shift to release slowly) · ${k('gas')} gas · ${k('brake')} brake · ${k('steerLeft')}/${k('steerRight')} steer · ${k('shiftDown')}/${k('shiftUp')} shift · ${k('ignition')} ignition · ${k('handbrake')} handbrake · ${k('reset')} restart · ${k('camera')} camera · ${k('pause')} pause`;
}

let graphicsReady = false;
function applySettings() {
  const st = progress.settings;
  input.bindings = st.bindings;
  const clutchPad = st.bindings.pad.clutch;
  haptics.clutchTrigger = clutchPad?.kind === 'button' ? (clutchPad.index === 6 ? 'left' : clutchPad.index === 7 ? 'right' : null) : null;
  haptics.clutchFeel = st.clutchFeel;
  input.mouseClutch = st.mouseClutch > 0;
  if (st.mouseClutch > 0) input.mouseTravel = st.mouseClutch;
  else input.releaseMouse();
  updateHint();
  haptics.strength = st.rumble;
  audio.setVolume(st.volume);
  graphics.setRetro(st.retro);
  graphics.setSpeedFx(st.speedFx);
  document.body.classList.toggle('look-street', st.retro === 'street');
  document.body.classList.toggle('retro-vhs', st.retro === 'vhs');
  document.body.classList.toggle('retro-console', st.retro === 'console');
  if (st.graphics !== graphics.quality || !graphicsReady) {
    graphics.setQuality(st.graphics);
    graphicsReady = true;
  }
  attachCamera();
  resize();
}

/** Cockpit view rides on the driver's head; hood view sits on the bonnet; chase view follows in world space. */
function attachCamera() {
  const view = progress.settings.camera;
  camera.removeFromParent();
  camera.position.set(0, 0, 0);
  camera.rotation.set(0, 0, 0);
  if (view === 'cockpit') {
    camera.rotation.x = -0.1;
    cockpit.head.add(camera);
  } else if (view === 'hood') {
    camera.position.set(0, 1.28 - model.interior.seatDrop, -1.2);
    camera.rotation.x = -0.07;
    cockpit.root.add(camera);
  } else {
    scene.add(camera);
    chaseCam.ready = false;
  }
  cockpit.root.visible = view !== 'chase';
  exterior.group.visible = view === 'chase';
}

function cycleCamera() {
  const st = progress.settings;
  st.camera = CAMERA_VIEWS[(CAMERA_VIEWS.indexOf(st.camera) + 1) % CAMERA_VIEWS.length];
  saveProgress(progress);
  applySettings();
  showFlash(st.camera === 'cockpit' ? 'Cockpit view' : st.camera === 'hood' ? 'Hood view' : 'Chase view', 1);
}

function resetRun() {
  car.reset();
  if (city) {
    // Free roam: no start line, the run (and the scoring) goes from the moment you arrive.
    chassis.place(city.spawn.x, city.spawn.z, city.spawn.yaw);
    scorer.reset();
    chaseCam.ready = false;
    run = 'running';
    runTime = 0;
    toasts.innerHTML = '';
    return;
  }
  // Start parked up in the lot beside the start line, pointing down the road.
  const lot = road.lots[0];
  const p = roadPoint(road, lot.s0 + 16, lot.side * (road.wallOffset + 3.4));
  chassis.place(p.x, p.z, p.yaw);
  const loc = road.locate(p.x, p.z);
  roadIndex = loc.index;
  roadS = loc.s;
  scorer.reset();
  chaseCam.ready = false; // snap the chase camera behind the car instead of swooping over
  run = 'idle';
  runTime = 0;
  toasts.innerHTML = '';
}

cockpit.paint.color.set(paintFor(progress, model.id).color);
audio.setEngine(model.cylinders);
applySettings();
applyCar();
resetRun();

function resize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  graphics.setSize(w, h);
  camera.aspect = w / h;
  // The setting is for landscape screens; portrait needs a wider view to see the road.
  baseFov = Math.min(110, progress.settings.fov + (w / h < 1 ? 20 : 0));
  camera.fov = baseFov + speedFov;
  camera.updateProjectionMatrix();
}
let baseFov = 60;
/** Extra field of view at speed, eased so it breathes with the throttle rather than jumping. */
let speedFov = 0;
window.addEventListener('resize', resize);
resize();

function showFlash(text: string, seconds = 1.6) {
  flash = { text, until: performance.now() + seconds * 1000 };
}

function collide() {
  if (city) {
    const c = collideWithCity(city, chassis, car);
    cityGap = Math.min(cityGap, c.gap);
    return c;
  }
  const r = collideWithEdges(road, chassis, car, roadIndex);
  roadIndex = r.loc.index;
  roadS = r.loc.s;
  return r;
}

let last = performance.now();
let simAccumulator = 0;
let time = 0;
let pitch = 0;
let grade = 0;
let driveTime = 0;
const shadowFocus = new THREE.Vector3();

function frame(now: number) {
  requestAnimationFrame(frame);
  // rAF timestamps can be slightly older than performance.now() on the first frame.
  const dt = Math.min(0.1, Math.max(0, (now - last) / 1000));
  last = now;
  time += dt;

  const c = input.read(dt);
  const nav = input.nav(dt);
  const pad = input.gamepad();

  updateDay(menus.isOpen ? 0 : dt);

  // Menus pause the world: no physics, no engine sound, no rumble.
  audio.setMuted(menus.isOpen);
  document.body.classList.toggle('in-menu', menus.isOpen);
  if (menus.isOpen) {
    graphics.setMotion(0, 0);
    if (document.pointerLockElement) input.releaseMouse();
    menus.update(nav);
    simAccumulator = 0;
    haptics.update(dt, car, null);
    if (menus.screen === 'garage' || menus.screen === 'tune') {
      showroom.control(pad, dt);
      showroom.render(renderer, dt, window.innerWidth / window.innerHeight);
    } else {
      // The main menu's "Your ride" tile shows the car on its turntable: draw it into a corner
      // of the main canvas, copy that into the tile, then draw the world over it.
      const tile = menus.rideCanvas();
      if (tile) drawRide(tile, dt);
      graphics.render(camera);
    }
    return;
  }
  driveTime += dt;

  if (c.pause) {
    input.releaseMouse();
    menus.open('pause');
    haptics.stop(pad);
    return;
  }
  if (c.toggleDebug) {
    debugOn = !debugOn;
    debug.classList.toggle('hidden', !debugOn);
  }
  if (c.reset) {
    cashOut();
    resetRun();
  }
  if (c.cycleCamera) cycleCamera();
  if (c.ignition) {
    if (car.running) car.stopEngine();
    else car.crank();
  }
  if (c.shiftUp || c.shiftDown) {
    const idx = gearSequence.indexOf(car.gear) + (c.shiftUp ? 1 : -1);
    if (idx >= 0 && idx < gearSequence.length) car.shiftTo(gearSequence[idx], c.clutch);
  }

  // Road grade along the car's heading.
  const here = road.sampleAt(roadS);
  const ahead = road.sampleAt(roadS + 2);
  const behind = road.sampleAt(roadS - 2);
  const roadGrade = city ? 0 : (ahead.h - behind.h) / 4;
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
    } else if (e.type === 'blowoff') {
      audio.blowoff(e.boost);
      haptics.jolt(0.12 * e.boost);
    }
  }

  // Run flow: the clock starts at the start line and stops at the finish.
  const s = roadS;
  if (run === 'idle' && !city && s >= road.startS) {
    run = 'running';
    runTime = 0;
    scorer.reset();
  }
  if (run === 'running') {
    runTime += dt;
    scorer.update(dt, car, { throttle: c.throttle, brake: c.brake, clutch: c.clutch }, events);
    if (city) {
      // In town the line through a corner is the car's own path.
      const v = Math.abs(car.speed);
      scorer.track(dt, { kappa: v > 3 ? chassis.yawRate / v : 0, edgeGap: cityGap, speed: v, latAccel: chassis.latAccel });
      cityGap = Infinity;
    } else {
      const here = road.locate(chassis.x, chassis.z, roadIndex);
      const side = Math.sign(here.offset) || 1;
      scorer.track(dt, {
        kappa: road.sampleAt(s).kappa,
        edgeGap: road.wallOffset + road.lotDepth(here.s, side) - CAR_HALF_WIDTH - Math.abs(here.offset),
        speed: Math.abs(car.speed),
        latAccel: chassis.latAccel,
      });
    }
    for (const e of scorer.drain()) {
      showToast(e);
      react(e);
    }
    if (!city && s >= road.finishS) finishRun();
  }

  // Place the car and camera.
  const loc = city ? { h: 0 } : road.sampleAt(s);
  const ground = loc.h + 0.15;
  pitch += (Math.atan(grade) - pitch) * Math.min(1, dt * 8);
  const root = cockpit.root;
  root.position.set(chassis.x, ground, chassis.z);
  // Body roll leans away from the corner a little.
  const roll = Math.max(-0.05, Math.min(0.05, -chassis.latAccel * 0.004));
  root.rotation.set(pitch, chassis.yaw, roll, 'YXZ');
  exterior.group.position.set(chassis.x, loc.h, chassis.z);
  exterior.group.rotation.copy(root.rotation);
  lightRig.position.copy(exterior.group.position);
  lightRig.rotation.copy(root.rotation);
  if (progress.settings.camera === 'chase') updateChaseCamera(dt, loc.h);

  cockpit.wheel.rotation.z = Math.max(-7.8, Math.min(7.8, chassis.steerAngle * 14));
  moveShifter(dt);
  cockpit.clutchPedal.rotation.x = -c.clutch * 0.5;
  cockpit.brakePedal.rotation.x = -c.brake * 0.4;
  cockpit.throttlePedal.rotation.x = -c.throttle * 0.4;

  const tyreSlip = Math.max(Math.abs(chassis.slipFront), Math.abs(chassis.slipRear)) * Math.min(1, Math.abs(car.speed) / 5);
  haptics.update(dt, car, pad, tyreSlip);
  audio.update(car, tyreSlip);

  // Head: lean with acceleration and cornering, shake with vibration.
  const shake = haptics.strong * 0.004 + (car.running ? 0.0004 + (car.rpm / 7000) * 0.0006 : 0);
  const eye = cockpit.eye;
  cockpit.head.position.set(
    eye.x + (Math.random() - 0.5) * shake + Math.max(-0.04, Math.min(0.04, -chassis.latAccel * 0.004)),
    eye.y + (Math.random() - 0.5) * shake,
    eye.z + Math.max(-0.05, Math.min(0.09, car.accel * 0.011)),
  );
  cockpit.head.rotation.x = Math.max(-0.05, Math.min(0.06, car.accel * 0.007));

  // Pull: how hard the car is shoving you into the seat. It widens the view, and when the
  // turbo is on boost the whole car shudders with it.
  pull += (Math.min(1.2, Math.max(0, car.accel / 5.5)) - pull) * Math.min(1, dt * 4);
  const tbo = car.spec.turbo;
  const onBoost = tbo ? (car.boost / tbo.maxBoost) * car.throttleEff : 0;
  if (onBoost > 0.05) {
    const judder = onBoost * (0.0016 * Math.sin(time * 2 * Math.PI * 11) + (Math.random() - 0.5) * 0.0022);
    cockpit.head.position.y += judder;
    cockpit.head.position.x += judder * 0.5;
  }

  // Speed effects: the view widens and shivers a touch as the speed builds.
  const fast = progress.settings.speedFx ? Math.max(0, Math.abs(car.speed) - 8) / 30 : 0;
  speed01 += (Math.min(1, Math.max(0, (Math.abs(car.speed) - 12) / 30)) - speed01) * Math.min(1, dt * 3);
  punch = Math.max(0, punch - dt * 1.8);
  const wantFov = progress.settings.speedFx ? Math.min(1, fast) * 12 + pull * 8 + punch * 5 : 0;
  speedFov += (wantFov - speedFov) * Math.min(1, dt * (wantFov > speedFov ? 8 : 2.5));
  if (Math.abs(camera.fov - (baseFov + speedFov)) > 0.01) {
    camera.fov = baseFov + speedFov;
    camera.updateProjectionMatrix();
  }
  if (fast > 0) {
    const buzz = Math.min(1, fast) ** 2 * 0.0025;
    cockpit.head.position.x += (Math.random() - 0.5) * buzz;
    cockpit.head.position.y += (Math.random() - 0.5) * buzz;
  }

  drawCluster(cockpit.clusterCanvas, car, time, progress.settings.units, model.body.design);
  cockpit.cluster.needsUpdate = true;

  updateHud(c.clutch, c.brake, c.throttle, pad, s);
  // Shadows cover the area just ahead of the car, where you're looking.
  shadowFocus.set(chassis.x - Math.sin(chassis.yaw) * 14, loc.h, chassis.z - Math.cos(chassis.yaw) * 14);
  graphics.follow(shadowFocus);
  updateTreeDetail(scenery.trees, shadowFocus);
  cityScenery?.update(time);
  minimap?.draw(chassis.x, chassis.z, chassis.yaw);
  const lvl = progress.settings.fxLevel;
  graphics.setMotion(Math.min(1, speed01 + pull * 0.3) * lvl, punch * lvl);
  graphics.render(camera);
  placeCarOnScreen();
  // The speed wings stream off the car body, so only from outside it.
  comic.update(dt, carScreen, progress.settings.speedFx ? speed01 * (0.4 + 0.6 * progress.settings.fxLevel) : 0, progress.settings.retro === 'street' && progress.settings.camera === 'chase');
}

const screenPos = new THREE.Vector3();
/** Where the car's tail is on screen, for the comic effects (low in the middle from the cockpit). */
function placeCarOnScreen() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  if (progress.settings.camera === 'chase') {
    screenPos.set(chassis.x, exterior.group.position.y + 0.7, chassis.z);
    const dist = screenPos.distanceTo(camera.position);
    screenPos.project(camera);
    carScreen.x = (screenPos.x * 0.5 + 0.5) * w;
    carScreen.y = (-screenPos.y * 0.5 + 0.5) * h;
    carScreen.scale = Math.min(1.6, (7 / Math.max(3, dist)) * (h / 720));
  } else {
    carScreen.x = w / 2;
    carScreen.y = h * 0.86;
    carScreen.scale = 1.6 * (h / 720);
  }
}

/** Sound, sparks and screen kick for each score event. */
function react(e: ScoreEvent) {
  const big = e.label.startsWith('PERFECT') || e.label === 'HEEL-TOE' || e.label === 'FULL SEND';
  const street = progress.settings.retro === 'street';
  const x = carScreen.x;
  const y = carScreen.y - 40 * carScreen.scale;
  if (e.label === 'COMBO LOST' || !e.good) {
    audio.sting('bad');
    comic.puff(x, y, '#c9c4b8', e.label === 'COMBO LOST' ? 7 : 4);
    flashEdges('#ff3d5a');
    return;
  }
  if (big) {
    audio.sting('great', e.combo);
    comic.burst(x, y, street ? '#ffe14d' : '#c8f04a', 1.2);
    punch = 1;
    flashEdges('#ffe14d');
  } else {
    audio.sting('good', e.combo);
    if (e.label === 'CLOSE CALL') comic.puff(x, y, '#ffffff', 5);
    else if (e.label === 'HAIRPIN') comic.burst(x, y, '#4de1ff', 0.8);
    else if (e.label.endsWith('SHIFT')) punch = Math.max(punch, 0.45);
  }
}

function flashEdges(color: string) {
  edgeFlash.style.setProperty('--flash', color);
  edgeFlash.classList.remove('go');
  void edgeFlash.offsetWidth;
  edgeFlash.classList.add('go');
}

/** New combo tier: the banner slams across and everything kicks. */
function showTier(tier: string) {
  tierBanner.dataset.tier = tier.toLowerCase().replace(/ /g, '-');
  tierBanner.querySelector('b')!.textContent = tier;
  tierBanner.querySelector('span')!.textContent = `×${scorer.multiplier.toFixed(2)}`;
  tierBanner.classList.remove('show');
  void tierBanner.offsetWidth;
  tierBanner.classList.add('show');
  audio.sting('tier', scorer.combo);
  punch = 1;
  comic.burst(window.innerWidth / 2, window.innerHeight * 0.46, '#ffe14d', 1.6);
  flashEdges('#ff8a3d');
}

function drawRide(tile: HTMLCanvasElement, dt: number) {
  const pr = renderer.getPixelRatio();
  const w = Math.round(tile.clientWidth * pr);
  const h = Math.round(tile.clientHeight * pr);
  if (w < 2 || h < 2) return;
  if (tile.width !== w || tile.height !== h) {
    tile.width = w;
    tile.height = h;
  }
  const rect = { left: 0, top: 0, width: tile.clientWidth, height: tile.clientHeight };
  showroom.renderInto(renderer, dt, rect);
  tile.getContext('2d')?.drawImage(renderer.domElement, 0, 0, w, h, 0, 0, w, h);
}

/**
 * The gear lever travels through the H-gate rather than snapping: back to the middle of the
 * gate, across, then into the new gear.
 */
const lever = { col: 0, row: 0 };
function moveShifter(dt: number) {
  const [col, row] = shifterPose(car.gear);
  const speed = dt * 9;
  const toward = (v: number, t: number) => v + Math.max(-speed, Math.min(speed, t - v));
  if (Math.abs(lever.col - col) > 0.01) {
    // Different plane: centre first, then across.
    if (Math.abs(lever.row) > 0.05) lever.row = toward(lever.row, 0);
    else lever.col = toward(lever.col, col);
  } else {
    lever.col = col;
    lever.row = toward(lever.row, row);
  }
  cockpit.shifter.rotation.set(lever.row * 0.24, 0, -lever.col * 0.2);
}

/** A camera that trails the car, lagging a little in yaw so corners are readable. */
function updateChaseCamera(dt: number, groundY: number) {
  const k = chaseCam.ready ? Math.min(1, dt * 4) : 1;
  let dy = chassis.yaw - chaseCam.yaw;
  dy = Math.atan2(Math.sin(dy), Math.cos(dy));
  chaseCam.yaw += dy * k;
  const back = new THREE.Vector3(Math.sin(chaseCam.yaw), 0, Math.cos(chaseCam.yaw)); // -forward
  const target = new THREE.Vector3(chassis.x, groundY, chassis.z);
  // At speed the camera drops back and down a little, so the road rushes by.
  const st = progress.settings;
  const want = target.clone().addScaledVector(back, st.chaseDist + speed01 * 1.1);
  want.y = Math.max(groundY + st.chaseHeight - speed01 * 0.3, (city ? 0 : road.sampleAt(Math.max(0, roadS - 6)).h) + 1.6);
  if (chaseCam.ready) chaseCam.pos.lerp(want, Math.min(1, dt * 8));
  else chaseCam.pos.copy(want);
  chaseCam.ready = true;
  camera.position.copy(chaseCam.pos);
  camera.lookAt(target.x - back.x * 2, groundY + 0.9, target.z - back.z * 2);
}

/** Leaving a run early still pays: the score so far becomes creds, shown with a little count-up. */
function cashOut() {
  if (run !== 'running' || scorer.score <= 0) return;
  const earned = cashoutFor(scorer.stats);
  if (earned <= 0) return;
  const score = scorer.score;
  progress.creds += earned;
  progress.runs += 1;
  progress.bestScore = Math.max(progress.bestScore, score);
  recordMapBest(score);
  saveProgress(progress);
  cashoutEl.innerHTML = `<span class="co-label">Cashed out</span><span class="co-score">${score.toLocaleString()} pts</span><b class="co-creds">◆ +0</b>`;
  cashoutEl.classList.remove('hidden', 'leave');
  // Restart the entry animation.
  void cashoutEl.offsetWidth;
  cashoutEl.classList.add('show');
  const credsEl = cashoutEl.querySelector('.co-creds')!;
  const t0 = performance.now();
  const tick = (now: number) => {
    const k = Math.min(1, (now - t0) / 900);
    credsEl.textContent = `◆ +${Math.round(earned * (1 - (1 - k) ** 3)).toLocaleString()}`;
    if (k < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  clearTimeout(cashoutTimer);
  cashoutTimer = window.setTimeout(() => {
    cashoutEl.classList.add('leave');
    cashoutTimer = window.setTimeout(() => cashoutEl.classList.add('hidden'), 400);
  }, 2600);
}
let cashoutTimer = 0;

function finishRun() {
  run = 'finished';
  const stats = { ...scorer.stats };
  const earned = credsForRun(stats);
  const best = stats.score > (progress.bestByMap[progress.settings.map] ?? 0);
  progress.creds += earned;
  progress.runs += 1;
  progress.bestScore = Math.max(progress.bestScore, stats.score);
  recordMapBest(stats.score);
  saveProgress(progress);
  haptics.stop(input.gamepad());
  menus.showSummary(stats, earned, best, formatTime(runTime));
}

function recordMapBest(score: number) {
  const id = progress.settings.map;
  progress.bestByMap[id] = Math.max(progress.bestByMap[id] ?? 0, score);
}

// The VHS filter's camcorder date stamp: today's date, but in 1997.
{
  const el = document.querySelector<HTMLElement>('.osd-date');
  const months = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
  const two = (n: number) => String(n).padStart(2, '0');
  const tick = () => {
    const d = new Date();
    if (el) el.textContent = `${two(d.getHours())}:${two(d.getMinutes())}:${two(d.getSeconds())}\n${months[d.getMonth()]}. ${two(d.getDate())} 1997`;
  };
  tick();
  setInterval(tick, 1000);
}

// Lay out the other roads while you sit in the menus, so the map picker opens instantly
// (never mid-run, where it would cost a dropped frame).
{
  const rest = MAPS.filter((m) => m.options).map((m) => m.id).filter((id) => id !== progress.settings.map);
  const next = () => {
    if (!rest.length) return;
    if (menus.isOpen) roadFor(rest.shift()!);
    setTimeout(next, 400);
  };
  setTimeout(next, 4000);
}

function formatTime(t: number) {
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${m}:${s.toFixed(1).padStart(4, '0')}`;
}

function tierRank(name: string) {
  return ['', 'WARM', 'HOT', 'ON FIRE', 'TOUGE KING'].indexOf(name);
}

function showToast(e: ScoreEvent, extra = '') {
  const el = document.createElement('div');
  const big = e.label.startsWith('PERFECT') || e.label === 'HEEL-TOE' || e.label === 'FULL SEND';
  el.style.setProperty('--rot', `${(Math.random() - 0.5) * 7}deg`);
  el.className = `toast ${e.good ? 'good' : 'bad'}${big ? ' big' : ''}`;
  const pts = e.points === 0 ? '' : `${e.points > 0 ? '+' : ''}${e.points}`;
  el.innerHTML = `<span>${e.label}</span>${pts ? `<b>${pts}</b>` : ''}`;
  // A little bump on the score when points land.
  if (e.points !== 0) {
    hud.score.classList.remove('bump', 'hurt');
    void hud.score.offsetWidth;
    hud.score.classList.add(e.points > 0 ? 'bump' : 'hurt');
  }
  if (extra) el.classList.add(extra);
  toasts.prepend(el);
  while (toasts.children.length > 3) toasts.lastChild!.remove();
  setTimeout(() => el.classList.add('fade'), 1800);
  setTimeout(() => el.remove(), 2400);
}

function updateHud(clutch: number, brake: number, throttle: number, pad: Gamepad | null, s: number) {
  pedals.clutch.style.height = `${clutch * 100}%`;
  pedals.brake.style.height = `${brake * 100}%`;
  pedals.throttle.style.height = `${throttle * 100}%`;
  if (car.spec.turbo) pedals.boost.style.height = `${(car.boost / car.spec.turbo.maxBoost) * 100}%`;
  const inBite = car.clutchCapacity > 0 && car.clutchCapacity < car.spec.clutchMaxTorque * 0.95;
  pedals.clutch.classList.toggle('bite', inBite);

  // The counter rolls up to the score rather than jumping.
  shownScore = scorer.score < shownScore ? scorer.score : shownScore + Math.max(1, (scorer.score - shownScore) * 0.15);
  if (shownScore > scorer.score) shownScore = scorer.score;
  hud.score.textContent = Math.round(shownScore).toLocaleString();
  const tier = tierFor(scorer.combo).name;
  hud.tier.textContent = tier;
  hud.mult.textContent = scorer.combo > 0 ? `×${scorer.multiplier.toFixed(2)}` : '';
  hud.combo.dataset.tier = tier.toLowerCase().replace(/ /g, '-');
  hud.comboFill.style.width = `${(Math.min(scorer.combo, 8) / 8) * 100}%`;
  hud.flowFill.style.width = `${scorer.flowLevel * 100}%`;
  if (tier && tier !== lastTier && run === 'running' && tierRank(tier) > tierRank(lastTier)) showTier(tier);
  lastTier = tier;
  hud.creds.textContent = `◆ ${progress.creds.toLocaleString()}`;
  hud.timer.textContent = city ? `Free roam  ${formatTime(runTime)}` : run === 'idle' ? 'Drive to the start line' : formatTime(runTime);
  const frac = city ? 0 : Math.min(1, Math.max(0, (s - road.startS) / (road.finishS - road.startS)));
  hud.progress.style.width = `${frac * 100}%`;

  const gp = pad ? padLabel(progress.settings.bindings.pad.ignition) : keysLabel(progress.settings.bindings.keys.ignition);
  let msg = '';
  if (performance.now() < flash.until) msg = flash.text;
  else if (!car.running && !car.cranking)
    msg = car.gear !== 0 ? `Clutch in (or neutral), then ${gp} to start` : `Press ${gp} to start the engine`;
  else if (input.mouseClutch && !input.mouseGrabbed) msg = 'Click to use the mouse as your clutch';
  message.textContent = msg;
  message.classList.toggle('visible', msg !== '');

  const hasRumble = !!(pad as unknown as { vibrationActuator?: unknown } | null)?.vibrationActuator;
  padStatus.textContent = pad
    ? `${shortPadName(pad.id)}${
        haptics.dualsense.connected
          ? ' · direct rumble'
          : hasRumble
            ? ''
            : DualSense.supported() && shortPadName(pad.id) === 'DualSense'
              ? ' · no rumble yet: Settings › DualSense rumble'
              : ' · no rumble in this browser'
      }`
    : 'No controller: press any button on it';
  hint.classList.toggle('hidden', !progress.settings.hints || driveTime > 25);

  // Outside the cockpit you can't see the gauges, so Auto shows the speedo on screen there.
  const mode = progress.settings.speedo;
  const showSpeedo = mode === 'on' || (mode === 'auto' && progress.settings.camera !== 'cockpit');
  speedo.classList.toggle('hidden', !showSpeedo);
  if (showSpeedo) drawSpeedo(speedo, car, performance.now() / 1000, progress.settings.units);

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
  city,
  renderer,
  scene,
  scorer,
  haptics,
  menus,
  progress,
  resetRun,
  finishRun,
  applyCar,
  applySettings,
  graphics,
  showroom,
  day,
  // For testing the score effects by hand from the console.
  pop: (e: ScoreEvent) => {
    showToast(e);
    react(e);
  },
  showTier,
};
