// Draws the instrument cluster onto a canvas used as a texture in the cockpit.

import type { Car } from './sim/car';

export function gearLabel(g: number) {
  return g === 0 ? 'N' : g === -1 ? 'R' : String(g);
}

export function drawCluster(canvas: HTMLCanvasElement, car: Car, time: number, units: 'kmh' | 'mph' = 'kmh') {
  const speedFactor = units === 'mph' ? 2.23694 : 3.6;
  const rpmMax = Math.ceil((car.spec.revLimit + 700) / 1000) * 1000;
  const redline = car.spec.revLimit - 300;
  const ctx = canvas.getContext('2d')!;
  const W = canvas.width;
  const H = canvas.height;
  ctx.fillStyle = '#16171b';
  ctx.fillRect(0, 0, W, H);

  const dial = (cx: number, cy: number, r: number, value: number, max: number, majors: number, red: number | null, label: string) => {
    const a0 = Math.PI * 0.75;
    const a1 = Math.PI * 2.25;
    const angle = (v: number) => a0 + (a1 - a0) * Math.min(1, Math.max(0, v / max));
    ctx.lineCap = 'round';
    ctx.lineWidth = 5;
    ctx.strokeStyle = '#2c2e35';
    ctx.beginPath();
    ctx.arc(cx, cy, r, a0, a1);
    ctx.stroke();
    if (red !== null) {
      ctx.strokeStyle = '#e4573d';
      ctx.beginPath();
      ctx.arc(cx, cy, r, angle(red), a1);
      ctx.stroke();
    }
    ctx.fillStyle = '#c9ccd4';
    ctx.font = '600 15px Inter, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let i = 0; i <= majors; i++) {
      const v = (max / majors) * i;
      const a = angle(v);
      ctx.strokeStyle = red !== null && v >= red ? '#e4573d' : '#c9ccd4';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * (r - 14), cy + Math.sin(a) * (r - 14));
      ctx.lineTo(cx + Math.cos(a) * (r - 4), cy + Math.sin(a) * (r - 4));
      ctx.stroke();
      const lv = max > 1000 ? v / 1000 : v;
      if (max <= 1000 && i % 2 === 1) continue;
      ctx.fillText(String(Math.round(lv)), cx + Math.cos(a) * (r - 30), cy + Math.sin(a) * (r - 30));
    }
    ctx.font = '500 11px Inter, system-ui, sans-serif';
    ctx.fillStyle = '#7d818c';
    ctx.fillText(label, cx, cy + r * 0.52);
    // Needle
    const a = angle(value);
    ctx.strokeStyle = '#ff7a3d';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(cx - Math.cos(a) * 10, cy - Math.sin(a) * 10);
    ctx.lineTo(cx + Math.cos(a) * (r - 8), cy + Math.sin(a) * (r - 8));
    ctx.stroke();
    ctx.fillStyle = '#2c2e35';
    ctx.beginPath();
    ctx.arc(cx, cy, 9, 0, Math.PI * 2);
    ctx.fill();
  };

  dial(128, 104, 88, car.rpm, rpmMax, rpmMax / 1000, redline, 'RPM ×1000');
  dial(384, 104, 88, Math.abs(car.speed) * speedFactor, units === 'mph' ? 140 : 220, units === 'mph' ? 14 : 11, null, units === 'mph' ? 'mph' : 'km/h');

  // Gear + digital speed in the middle.
  ctx.fillStyle = '#f4f1e8';
  ctx.font = '700 44px Inter, system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(gearLabel(car.gear), 256, 86);
  ctx.font = '600 16px Inter, system-ui, sans-serif';
  ctx.fillStyle = '#9da1ab';
  ctx.fillText(String(Math.round(Math.abs(car.speed) * speedFactor)), 256, 126);

  // Warning lights: battery + oil light up with the ignition on and the engine off.
  if (!car.running) {
    ctx.fillStyle = '#e4573d';
    ctx.fillRect(226, 158, 22, 12);
    ctx.fillStyle = '#ffb02e';
    ctx.beginPath();
    ctx.ellipse(276, 164, 12, 7, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  // Shift light near the limiter.
  if (car.rpm > redline - 200 && Math.floor(time * 12) % 2 === 0) {
    ctx.fillStyle = '#ff3d3d';
    ctx.beginPath();
    ctx.arc(256, 30, 9, 0, Math.PI * 2);
    ctx.fill();
  }
}
