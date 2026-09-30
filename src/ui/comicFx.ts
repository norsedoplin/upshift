// Comic effects drawn over the game on a 2D canvas: starbursts and smoke puffs when you
// score, and (in the Street look) white speed "wings" streaming off the car at pace.
// Everything is flat shapes with a thick ink outline, like the rest of the Street look.

type Kind = 'burst' | 'puff' | 'wing' | 'spark';

interface Bit {
  kind: Kind;
  x: number;
  y: number;
  vx: number;
  vy: number;
  age: number;
  life: number;
  size: number;
  spin: number;
  color: string;
  side: number;
  seed: number;
}

const INK = '#111';

export class ComicFx {
  private ctx: CanvasRenderingContext2D;
  private bits: Bit[] = [];
  private wingTimer = 0;
  private w = 0;
  private h = 0;

  constructor(private canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d')!;
  }

  /** A starburst with sparks, for the big moments. */
  burst(x: number, y: number, color: string, size = 1) {
    this.add({ kind: 'burst', x, y, vx: 0, vy: 0, life: 0.55, size: 70 * size, spin: (Math.random() - 0.5) * 2, color });
    for (let i = 0; i < 10; i++) {
      const a = Math.random() * Math.PI * 2;
      const v = (260 + Math.random() * 320) * size;
      this.add({ kind: 'spark', x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 0.4 + Math.random() * 0.25, size: 10 * size, spin: 0, color });
    }
  }

  /** A few cartoon smoke puffs, for mistakes and close calls. */
  puff(x: number, y: number, color = '#f4f1e8', n = 5) {
    for (let i = 0; i < n; i++) {
      const a = -Math.PI / 2 + (Math.random() - 0.5) * 2.4;
      const v = 80 + Math.random() * 120;
      this.add({ kind: 'puff', x: x + (Math.random() - 0.5) * 40, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 0.6 + Math.random() * 0.3, size: 16 + Math.random() * 16, spin: 0, color });
    }
  }

  private add(b: Omit<Bit, 'age' | 'side' | 'seed'> & { side?: number }) {
    if (this.bits.length > 160) this.bits.shift();
    this.bits.push({ age: 0, side: 1, seed: Math.random(), ...b });
  }

  /**
   * Advance and draw. `car` is where the car is on screen (the middle of its tail), `speed`
   * is 0..1 and `wings` turns the streaming speed wings on.
   */
  update(dt: number, car: { x: number; y: number; scale: number }, speed: number, wings: boolean) {
    const c = this.canvas;
    const w = c.clientWidth;
    const h = c.clientHeight;
    if (w !== this.w || h !== this.h) {
      this.w = c.width = w;
      this.h = c.height = h;
    }
    const ctx = this.ctx;
    ctx.clearRect(0, 0, w, h);

    if (wings && speed > 0.25) {
      this.wingTimer -= dt;
      if (this.wingTimer <= 0) {
        this.wingTimer = 0.09 / speed;
        for (const side of [-1, 1]) {
          this.add({
            kind: 'wing',
            x: car.x + side * 60 * car.scale,
            y: car.y - 10 * car.scale,
            vx: side * (140 + 260 * speed) * car.scale,
            vy: (40 + Math.random() * 60) * car.scale,
            life: 0.45,
            size: (40 + 50 * speed) * car.scale,
            spin: 0,
            color: '#fff',
            side,
          });
        }
      }
    }

    this.bits = this.bits.filter((b) => (b.age += dt) < b.life);
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    for (const b of this.bits) {
      const k = b.age / b.life;
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      if (b.kind === 'puff' || b.kind === 'spark') {
        b.vx *= 1 - dt * 2.5;
        b.vy *= 1 - dt * 2.5;
      }
      ctx.save();
      ctx.globalAlpha = k > 0.7 ? (1 - k) / 0.3 : 1;
      ctx.translate(b.x, b.y);
      if (b.kind === 'burst') this.drawBurst(b, k);
      else if (b.kind === 'spark') this.drawSpark(b, k);
      else if (b.kind === 'puff') this.drawPuff(b, k);
      else this.drawWing(b, k);
      ctx.restore();
    }
  }

  private drawBurst(b: Bit, k: number) {
    const ctx = this.ctx;
    const s = b.size * (0.4 + 0.8 * Math.min(1, k * 4));
    ctx.rotate(b.spin * k);
    ctx.beginPath();
    const n = 12;
    for (let i = 0; i <= n * 2; i++) {
      const a = (i / (n * 2)) * Math.PI * 2;
      const r = i % 2 ? s * 0.45 : s * (0.9 + 0.2 * Math.sin(i * 7 + b.seed * 10));
      ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
    }
    ctx.closePath();
    ctx.fillStyle = b.color;
    ctx.strokeStyle = INK;
    ctx.lineWidth = 5;
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(0, 0, s * 0.28, 0, Math.PI * 2);
    ctx.fillStyle = '#fff';
    ctx.fill();
  }

  private drawSpark(b: Bit, k: number) {
    const ctx = this.ctx;
    const len = b.size * 2.4 * (1 - k);
    const a = Math.atan2(b.vy, b.vx);
    ctx.rotate(a);
    ctx.strokeStyle = INK;
    ctx.lineWidth = 7;
    ctx.beginPath();
    ctx.moveTo(-len, 0);
    ctx.lineTo(0, 0);
    ctx.stroke();
    ctx.strokeStyle = b.color;
    ctx.lineWidth = 3.5;
    ctx.stroke();
  }

  private drawPuff(b: Bit, k: number) {
    const ctx = this.ctx;
    const r = b.size * (0.6 + k * 0.9);
    ctx.fillStyle = b.color;
    ctx.strokeStyle = INK;
    ctx.lineWidth = 4;
    ctx.beginPath();
    for (let i = 0; i < 3; i++) {
      const a = b.seed * 6 + i * 2.1;
      ctx.moveTo(Math.cos(a) * r * 0.5 + r * 0.7, Math.sin(a) * r * 0.5);
      ctx.arc(Math.cos(a) * r * 0.5, Math.sin(a) * r * 0.5, r * 0.7, 0, Math.PI * 2);
    }
    ctx.stroke();
    ctx.fill();
  }

  /** A curved white streak with an ink edge, sweeping out and back from the car. */
  private drawWing(b: Bit, k: number) {
    const ctx = this.ctx;
    const len = b.size * (0.5 + k);
    const bend = b.side * len * 0.35;
    const path = () => {
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.quadraticCurveTo(b.side * len * 0.6, -bend * b.side * 0.6 - len * 0.1, b.side * len, len * 0.25);
    };
    const width = (1 - k) * 6 + 1.5;
    path();
    ctx.strokeStyle = INK;
    ctx.lineWidth = width + 5;
    ctx.stroke();
    path();
    ctx.strokeStyle = b.color;
    ctx.lineWidth = width;
    ctx.stroke();
  }
}
