// Draws the instrument cluster (a canvas used as a texture in the cockpit) and the on-screen speedo.

import type { CarDesign } from './cars';
import type { Car } from './sim/car';

export function gearLabel(g: number) {
  return g === 0 ? 'N' : g === -1 ? 'R' : String(g);
}

const FONT = 'Inter, system-ui, sans-serif';
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

interface DialStyle {
  face?: string; // filled face colour, if any
  rim?: string;
  track: string;
  ink: string; // ticks and numbers
  red: string;
  needle: string;
  hub: string;
  label: string;
  font: number;
  from?: number; // sweep in radians (canvas angles, clockwise from +x)
  to?: number;
  minors?: number; // minor ticks between majors
  numbers?: boolean;
}

type Ctx = CanvasRenderingContext2D;

function dial(
  ctx: Ctx,
  st: DialStyle,
  cx: number,
  cy: number,
  r: number,
  value: number,
  max: number,
  majors: number,
  red: number | null,
  label: string,
  labelEvery = 1,
) {
  const a0 = st.from ?? Math.PI * 0.75;
  const a1 = st.to ?? Math.PI * 2.25;
  const angle = (v: number) => a0 + (a1 - a0) * clamp01(v / max);
  const at = (a: number, d: number): [number, number] => [cx + Math.cos(a) * d, cy + Math.sin(a) * d];
  if (st.face) {
    ctx.fillStyle = st.face;
    ctx.beginPath();
    ctx.arc(cx, cy, r + 6, 0, Math.PI * 2);
    ctx.fill();
  }
  if (st.rim) {
    ctx.strokeStyle = st.rim;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(cx, cy, r + 6, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.lineCap = 'round';
  ctx.lineWidth = 5;
  ctx.strokeStyle = st.track;
  ctx.beginPath();
  ctx.arc(cx, cy, r, a0, a1);
  ctx.stroke();
  if (red !== null) {
    ctx.strokeStyle = st.red;
    ctx.beginPath();
    ctx.arc(cx, cy, r, angle(red), a1);
    ctx.stroke();
  }
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `600 ${st.font}px ${FONT}`;
  const minors = st.minors ?? 1;
  for (let i = 0; i <= majors * minors; i++) {
    const v = (max / (majors * minors)) * i;
    const major = i % minors === 0;
    const a = angle(v);
    ctx.strokeStyle = red !== null && v >= red ? st.red : st.ink;
    ctx.lineWidth = major ? 3 : 1.5;
    ctx.beginPath();
    ctx.moveTo(...at(a, r - (major ? r * 0.16 : r * 0.09)));
    ctx.lineTo(...at(a, r - 4));
    ctx.stroke();
    const n = i / minors;
    if (!major || n % labelEvery !== 0 || st.numbers === false) continue;
    ctx.fillStyle = red !== null && v >= red ? st.red : st.ink;
    ctx.fillText(String(Math.round(max > 1000 ? v / 1000 : v)), ...at(a, r - r * 0.16 - st.font * 0.9));
  }
  if (label) {
    ctx.font = `500 ${Math.round(st.font * 0.7)}px ${FONT}`;
    ctx.fillStyle = st.label;
    ctx.fillText(label, cx, cy + r * 0.52);
  }
  const a = angle(value);
  ctx.strokeStyle = st.needle;
  ctx.lineWidth = Math.max(3, r * 0.045);
  ctx.beginPath();
  ctx.moveTo(...at(a + Math.PI, r * 0.12));
  ctx.lineTo(...at(a, r - 8));
  ctx.stroke();
  ctx.fillStyle = st.hub;
  ctx.beginPath();
  ctx.arc(cx, cy, Math.max(7, r * 0.1), 0, Math.PI * 2);
  ctx.fill();
}

/** A small sideways gauge like fuel or water temperature: a short arc with a needle. */
function miniGauge(ctx: Ctx, cx: number, cy: number, r: number, v: number, low: string, high: string, ink: string, needle: string) {
  const a0 = Math.PI * 1.2;
  const a1 = Math.PI * 1.8;
  ctx.strokeStyle = ink;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(cx, cy, r, a0, a1);
  ctx.stroke();
  for (let i = 0; i <= 4; i++) {
    const a = a0 + ((a1 - a0) * i) / 4;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(a) * (r - 6), cy + Math.sin(a) * (r - 6));
    ctx.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
    ctx.stroke();
  }
  ctx.font = `600 11px ${FONT}`;
  ctx.fillStyle = ink;
  ctx.fillText(low, cx + Math.cos(a0) * (r + 9), cy + Math.sin(a0) * (r + 9));
  ctx.fillText(high, cx + Math.cos(a1) * (r + 9), cy + Math.sin(a1) * (r + 9));
  const a = a0 + (a1 - a0) * clamp01(v);
  ctx.strokeStyle = needle;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.lineTo(cx + Math.cos(a) * (r - 3), cy + Math.sin(a) * (r - 3));
  ctx.stroke();
}

function warnings(ctx: Ctx, car: Car, x: number, y: number) {
  if (car.running) return;
  ctx.fillStyle = '#e4573d';
  ctx.fillRect(x - 30, y - 6, 22, 12);
  ctx.fillStyle = '#ffb02e';
  ctx.beginPath();
  ctx.ellipse(x + 20, y, 12, 7, 0, 0, Math.PI * 2);
  ctx.fill();
}

function shiftLamp(ctx: Ctx, car: Car, time: number, x: number, y: number, r = 9) {
  const redline = car.spec.revLimit - 300;
  if (car.rpm > redline - 200 && Math.floor(time * 12) % 2 === 0) {
    ctx.fillStyle = '#ff3d3d';
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
}

// Coolant creeps up as the engine runs, so the temp gauge has something to do.
let warmth = 0;
// Smoothed boost for the turbo car's gauge.
let boost = -0.6;
let lastTime = 0;

export function drawCluster(canvas: HTMLCanvasElement, car: Car, time: number, units: 'kmh' | 'mph' = 'kmh', design: CarDesign = 'hatch') {
  const dt = Math.min(0.1, Math.max(0, time - lastTime));
  lastTime = time;
  warmth = clamp01(warmth + (car.running ? dt / 90 : -dt / 400));
  const speedFactor = units === 'mph' ? 2.23694 : 3.6;
  const speed = Math.abs(car.speed) * speedFactor;
  const speedMax = units === 'mph' ? 140 : 220;
  const speedMajors = units === 'mph' ? 14 : 11;
  const unitLabel = units === 'mph' ? 'mph' : 'km/h';
  const rpmMax = Math.ceil((car.spec.revLimit + 700) / 1000) * 1000;
  const redline = car.spec.revLimit - 300;
  const ctx = canvas.getContext('2d')!;
  const W = canvas.width;
  const H = canvas.height;
  // The dash top hides the bottom fifth of the panel, so lay the dials out in the part you can see.
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  const fit = () => ctx.setTransform(0.8, 0, 0, 0.8, W * 0.1, 2);

  if (design === 'ae86') {
    // Big centre tach flanked by a speedo and the fuel/temp pair, white on black.
    ctx.fillStyle = '#0b0b0c';
    ctx.fillRect(0, 0, W, H);
    fit();
    const st: DialStyle = { face: '#050506', rim: '#2a2a2d', track: '#1d1d20', ink: '#e9ecef', red: '#ff4a2e', needle: '#ff6a2a', hub: '#1b1b1d', label: '#8e929b', font: 16, minors: 2 };
    dial(ctx, { ...st, font: 13, minors: 2 }, 88, 112, 70, speed, speedMax, speedMajors, null, unitLabel, 2);
    dial(ctx, st, 256, 100, 90, car.rpm, rpmMax, rpmMax / 1000, redline, 'RPM ×1000');
    miniGauge(ctx, 430, 90, 44, 0.72, 'E', 'F', '#e9ecef', '#ff6a2a');
    miniGauge(ctx, 430, 168, 44, 0.15 + warmth * 0.38, 'C', 'H', '#e9ecef', '#ff6a2a');
    ctx.font = `700 22px ${FONT}`;
    ctx.fillStyle = '#ffb347';
    ctx.fillText(gearLabel(car.gear), 256, 150);
    warnings(ctx, car, 88, 180);
    shiftLamp(ctx, car, time, 256, 14, 7);
    return;
  }

  if (design === 's14') {
    // Tach and speedo either side of a boost gauge, amber-lit night dials.
    ctx.fillStyle = '#121316';
    ctx.fillRect(0, 0, W, H);
    fit();
    const st: DialStyle = { face: '#08090b', rim: '#34363c', track: '#1f2126', ink: '#f2f4f7', red: '#ff3b30', needle: '#ff8a1f', hub: '#25272c', label: '#9aa0aa', font: 15, minors: 2 };
    dial(ctx, st, 118, 104, 84, car.rpm, rpmMax, rpmMax / 1000, redline, 'RPM ×1000');
    dial(ctx, { ...st, minors: 2 }, 394, 104, 84, speed, speedMax, speedMajors, null, unitLabel, 2);
    const target = car.running ? -0.6 + 1.4 * car.throttleEff * clamp01((car.rpm - 2200) / 2300) : 0;
    boost += (target - boost) * Math.min(1, dt * (target > boost ? 2.5 : 6));
    dial(
      ctx,
      { ...st, font: 11, face: '#08090b', minors: 4, numbers: false, from: Math.PI * 0.85, to: Math.PI * 2.15 },
      256,
      74,
      40,
      boost + 1,
      2,
      2,
      null,
      '',
    );
    ctx.font = `600 10px ${FONT}`;
    ctx.fillStyle = '#9aa0aa';
    ctx.fillText('BOOST', 256, 98);
    ctx.font = `700 34px ${FONT}`;
    ctx.fillStyle = '#f4f1e8';
    ctx.fillText(gearLabel(car.gear), 256, 150);
    warnings(ctx, car, 256, 186);
    shiftLamp(ctx, car, time, 256, 18, 7);
    return;
  }

  if (design === 'fd') {
    // A huge centre tach with the speed in digits, speedo and oil/water off to the sides.
    ctx.fillStyle = '#0e0e10';
    ctx.fillRect(0, 0, W, H);
    fit();
    const st: DialStyle = { face: '#050506', rim: '#b5161c', track: '#1c1c1f', ink: '#f5f5f5', red: '#ff2d2d', needle: '#ff3d24', hub: '#b5161c', label: '#8c8f96', font: 17, minors: 2 };
    dial(ctx, { ...st, rim: '#2b2b2e', hub: '#2b2b2e', font: 12 }, 82, 118, 62, speed, speedMax, speedMajors, null, unitLabel, 2);
    dial(ctx, st, 256, 100, 94, car.rpm, rpmMax, rpmMax / 1000, redline, '');
    ctx.font = `700 30px ${FONT}`;
    ctx.fillStyle = '#ffffff';
    ctx.fillText(String(Math.round(speed)), 256, 146);
    ctx.font = `600 10px ${FONT}`;
    ctx.fillStyle = '#8c8f96';
    ctx.fillText(unitLabel, 256, 168);
    ctx.font = `700 20px ${FONT}`;
    ctx.fillStyle = '#ff3d24';
    ctx.fillText(gearLabel(car.gear), 256, 62);
    miniGauge(ctx, 432, 90, 44, car.running ? 0.35 + 0.45 * clamp01(car.rpm / car.spec.revLimit) : 0, 'L', 'H', '#f5f5f5', '#ff3d24');
    miniGauge(ctx, 432, 168, 44, 0.15 + warmth * 0.38, 'C', 'H', '#f5f5f5', '#ff3d24');
    warnings(ctx, car, 82, 186);
    shiftLamp(ctx, car, time, 256, 14, 7);
    return;
  }

  // Classic hatch cluster: two plain dials, gear and digits in the middle.
  ctx.fillStyle = '#16171b';
  ctx.fillRect(0, 0, W, H);
  fit();
  const st: DialStyle = { track: '#2c2e35', ink: '#c9ccd4', red: '#e4573d', needle: '#ff7a3d', hub: '#2c2e35', label: '#7d818c', font: 15 };
  dial(ctx, st, 128, 104, 88, car.rpm, rpmMax, rpmMax / 1000, redline, 'RPM ×1000');
  dial(ctx, st, 384, 104, 88, speed, speedMax, speedMajors, null, unitLabel, 2);
  ctx.fillStyle = '#f4f1e8';
  ctx.font = `700 44px ${FONT}`;
  ctx.fillText(gearLabel(car.gear), 256, 86);
  ctx.font = `600 16px ${FONT}`;
  ctx.fillStyle = '#9da1ab';
  ctx.fillText(String(Math.round(speed)), 256, 126);
  warnings(ctx, car, 256, 164);
  shiftLamp(ctx, car, time, 256, 30);
}

/**
 * The on-screen speedo: a segmented tach arc that heats up towards the limiter,
 * big digital speed, a gear pill and a row of shift lights that fill as revs climb.
 */
export function drawSpeedo(canvas: HTMLCanvasElement, car: Car, time: number, units: 'kmh' | 'mph' = 'kmh') {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const size = canvas.clientWidth || 200;
  const px = Math.round(size * dpr);
  if (canvas.width !== px || canvas.height !== px) {
    canvas.width = px;
    canvas.height = px;
  }
  const ctx = canvas.getContext('2d')!;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, size, size);
  const s = size / 200;
  const cx = 100 * s;
  const cy = 108 * s;
  const r = 82 * s;

  const limit = car.spec.revLimit;
  const rpmMax = Math.ceil((limit + 700) / 1000) * 1000;
  const frac = clamp01(car.rpm / rpmMax);
  const redFrac = (limit - 300) / rpmMax;
  const a0 = Math.PI * 0.75;
  const a1 = Math.PI * 2.25;
  const flash = car.rpm > limit - 200 && Math.floor(time * 14) % 2 === 0;

  // Backing disc.
  const bg = ctx.createRadialGradient(cx, cy, r * 0.2, cx, cy, r + 14 * s);
  bg.addColorStop(0, 'rgba(22,23,28,0.96)');
  bg.addColorStop(1, 'rgba(10,11,14,0.92)');
  ctx.fillStyle = bg;
  ctx.beginPath();
  ctx.arc(cx, cy, r + 12 * s, 0, Math.PI * 2);
  ctx.fill();

  // Segmented tach: lit up to the current revs, cool white to amber to red.
  const segs = 44;
  const gap = 0.012;
  for (let i = 0; i < segs; i++) {
    const f0 = i / segs;
    const f1 = (i + 1) / segs;
    const lit = f0 < frac;
    const hot = f0 >= redFrac;
    let col: string;
    if (lit) {
      if (hot) col = flash ? '#ffffff' : '#ff3b30';
      else if (f0 > redFrac - 0.18) col = '#ffa726';
      else col = `hsl(${190 - f0 * 120}, 90%, ${62 + f0 * 10}%)`;
    } else col = hot ? 'rgba(255,59,48,0.28)' : 'rgba(255,255,255,0.09)';
    ctx.strokeStyle = col;
    ctx.lineWidth = (hot ? 12 : 10) * s;
    ctx.lineCap = 'butt';
    ctx.beginPath();
    ctx.arc(cx, cy, r - 4 * s, a0 + (a1 - a0) * f0 + gap, a0 + (a1 - a0) * f1 - gap);
    ctx.stroke();
  }
  if (frac > 0.01) {
    // A soft glow at the tip of the lit arc.
    const a = a0 + (a1 - a0) * frac;
    const g = ctx.createRadialGradient(cx + Math.cos(a) * (r - 4 * s), cy + Math.sin(a) * (r - 4 * s), 0, cx + Math.cos(a) * (r - 4 * s), cy + Math.sin(a) * (r - 4 * s), 16 * s);
    g.addColorStop(0, frac >= redFrac ? 'rgba(255,80,60,0.7)' : 'rgba(255,200,140,0.45)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(cx + Math.cos(a) * (r - 4 * s), cy + Math.sin(a) * (r - 4 * s), 16 * s, 0, Math.PI * 2);
    ctx.fill();
  }

  // Thousands numerals inside the arc.
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `600 ${10 * s}px ${FONT}`;
  for (let k = 0; k <= rpmMax / 1000; k++) {
    const a = a0 + (a1 - a0) * ((k * 1000) / rpmMax);
    ctx.fillStyle = k * 1000 >= limit - 300 ? '#ff6b5e' : 'rgba(255,255,255,0.55)';
    ctx.fillText(String(k), cx + Math.cos(a) * (r - 22 * s), cy + Math.sin(a) * (r - 22 * s));
  }

  // Speed.
  const speed = Math.round(Math.abs(car.speed) * (units === 'mph' ? 2.23694 : 3.6));
  ctx.fillStyle = '#f7f5ef';
  ctx.font = `700 ${46 * s}px ${FONT}`;
  ctx.fillText(String(speed), cx, cy - 6 * s);
  ctx.font = `600 ${10 * s}px ${FONT}`;
  ctx.fillStyle = 'rgba(255,255,255,0.5)';
  ctx.fillText(units === 'mph' ? 'MPH' : 'KM/H', cx, cy + 22 * s);

  // Gear pill.
  const gw = 34 * s;
  const gh = 28 * s;
  const gy = cy + 36 * s;
  ctx.fillStyle = car.gear === 0 ? 'rgba(255,255,255,0.12)' : '#ff7a3d';
  ctx.beginPath();
  ctx.roundRect(cx - gw / 2, gy, gw, gh, 8 * s);
  ctx.fill();
  ctx.fillStyle = car.gear === 0 ? '#f7f5ef' : '#1a0d05';
  ctx.font = `800 ${20 * s}px ${FONT}`;
  ctx.fillText(gearLabel(car.gear), cx, gy + gh / 2 + 1 * s);

  // Shift lights: five dots across the top, green, amber, red, then all flash.
  const start = limit - 1600;
  const n = 5;
  for (let i = 0; i < n; i++) {
    const on = car.rpm > start + (i * 1300) / n;
    const x = cx + (i - (n - 1) / 2) * 15 * s;
    const y = 12 * s;
    const col = i < 2 ? '#3ddc84' : i < 4 ? '#ffb02e' : '#ff3b30';
    ctx.fillStyle = flash ? '#ff3b30' : on ? col : 'rgba(20,21,26,0.85)';
    ctx.beginPath();
    ctx.arc(x, y, 4.5 * s, 0, Math.PI * 2);
    ctx.fill();
  }

  if (!car.running) {
    ctx.fillStyle = '#ffb02e';
    ctx.font = `700 ${9 * s}px ${FONT}`;
    ctx.fillText('ENGINE OFF', cx, cy - 38 * s);
  }
}
