// A round map of the town for free roam. The streets are drawn once onto a big canvas;
// each frame a window of it around the car is copied in, turned so ahead is up.

import type { City, StreetKind } from '../track/city';

const SCALE = 1.4; // pixels per metre on the big map
const VIEW = 130; // metres from the car to the edge of the minimap

export class Minimap {
  private map: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;

  constructor(private canvas: HTMLCanvasElement, private city: City) {
    canvas.classList.remove('hidden');
    this.ctx = canvas.getContext('2d')!;
    const b = city.bounds;
    const m = document.createElement('canvas');
    m.width = Math.ceil((b.x1 - b.x0 + 20) * SCALE);
    m.height = Math.ceil((b.z1 - b.z0 + 20) * SCALE);
    const g = m.getContext('2d')!;
    g.fillStyle = '#23262c';
    g.fillRect(0, 0, m.width, m.height);
    const X = (x: number) => (x - b.x0 + 10) * SCALE;
    const Z = (z: number) => (z - b.z0 + 10) * SCALE;
    // Blocks, then the special places on them, then the streets on top.
    g.fillStyle = '#3a3e46';
    for (const r of city.blocks) g.fillRect(X(r.x0), Z(r.z0), (r.x1 - r.x0) * SCALE, (r.z1 - r.z0) * SCALE);
    const padColour = { gas: '#c8503c', parking: '#4a5a6e', park: '#4f7a3e', forecourt: '#3f7a5a' };
    for (const p of city.pads) {
      g.fillStyle = padColour[p.kind];
      g.fillRect(X(p.rect.x0), Z(p.rect.z0), (p.rect.x1 - p.rect.x0) * SCALE, (p.rect.z1 - p.rect.z0) * SCALE);
    }
    const colour: Record<StreetKind, string> = { avenue: '#e8e4d8', street: '#b9b6ad', lane: '#8d8b85' };
    for (const kind of ['lane', 'street', 'avenue'] as StreetKind[])
      for (const s of city.streets) {
        if (s.kind !== kind) continue;
        g.fillStyle = colour[kind];
        g.fillRect(X(s.rect.x0), Z(s.rect.z0), (s.rect.x1 - s.rect.x0) * SCALE, (s.rect.z1 - s.rect.z0) * SCALE);
      }
    this.map = m;
  }

  draw(x: number, z: number, yaw: number) {
    const c = this.canvas;
    const size = Math.round(c.clientWidth * Math.min(2, window.devicePixelRatio || 1));
    if (c.width !== size) c.width = c.height = size;
    const g = this.ctx;
    const b = this.city.bounds;
    const k = size / 2 / VIEW / SCALE;
    g.save();
    g.clearRect(0, 0, size, size);
    g.beginPath();
    g.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
    g.clip();
    g.fillStyle = '#23262c';
    g.fillRect(0, 0, size, size);
    g.translate(size / 2, size / 2);
    // Heading 0 is north (-z), which is already up on the map.
    g.rotate(yaw);
    g.scale(k, k);
    g.drawImage(this.map, -(x - b.x0 + 10) * SCALE, -(z - b.z0 + 10) * SCALE);
    g.restore();
    // The car, always in the middle pointing up.
    g.save();
    g.translate(size / 2, size / 2);
    g.fillStyle = '#ffd23a';
    g.strokeStyle = '#111';
    g.lineWidth = size / 90;
    const s = size / 22;
    g.beginPath();
    g.moveTo(0, -s);
    g.lineTo(s * 0.7, s * 0.8);
    g.lineTo(0, s * 0.4);
    g.lineTo(-s * 0.7, s * 0.8);
    g.closePath();
    g.fill();
    g.stroke();
    g.restore();
    g.strokeStyle = 'rgba(255,255,255,0.5)';
    g.lineWidth = size / 80;
    g.beginPath();
    g.arc(size / 2, size / 2, size / 2 - g.lineWidth / 2, 0, Math.PI * 2);
    g.stroke();
  }
}
