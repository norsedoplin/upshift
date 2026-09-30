import { describe, expect, it } from 'vitest';
import { City } from './city';

describe('city', () => {
  const city = new City({ seed: 3, blocks: 12 });

  it('is big enough to explore', () => {
    const b = city.bounds;
    expect(b.x1 - b.x0).toBeGreaterThan(500);
    expect(b.z1 - b.z0).toBeGreaterThan(500);
    expect(city.buildings.length).toBeGreaterThan(600);
  });

  it('has the landmarks', () => {
    const kinds = new Set(city.buildings.map((b) => b.kind));
    for (const k of ['house', 'apartment', 'shop', 'konbini', 'office', 'tower', 'kiosk', 'shrine']) expect(kinds).toContain(k);
    expect(city.pads.some((p) => p.kind === 'gas')).toBe(true);
    expect(city.pads.some((p) => p.kind === 'parking')).toBe(true);
  });

  it('starts you on open road', () => {
    expect(city.isOpen(city.spawn.x, city.spawn.z, 1.5)).toBe(true);
    expect(city.streetAt(city.spawn.x, city.spawn.z)).not.toBeNull();
  });

  it('keeps the streets clear of buildings', () => {
    let blocked = 0;
    for (const s of city.streets)
      for (const b of city.buildings) {
        const r = b.rect;
        const o = s.rect;
        if (b.kind === 'wall') continue;
        if (r.x0 < o.x1 - 0.01 && r.x1 > o.x0 + 0.01 && r.z0 < o.z1 - 0.01 && r.z1 > o.z0 + 0.01) blocked++;
      }
    expect(blocked).toBe(0);
  });
});

describe('driving in town', () => {
  it("can't drive through a building", async () => {
    const { Car } = await import('../sim/car');
    const { Chassis } = await import('../sim/chassis');
    const { collideWithCity } = await import('./collide');
    const city = new City({ seed: 3, blocks: 14 });
    // Aim at the middle of a big building's front from a few metres out on the street.
    const b = city.buildings.find((x) => x.kind === 'apartment' && x.face === 2 && x.rect.x1 - x.rect.x0 > 10)!;
    const cx = (b.rect.x0 + b.rect.x1) / 2;
    const car = new Car();
    const ch = new Chassis();
    ch.place(cx, b.rect.z1 + 8, 0); // facing north, into its front
    car.setSpeed(20);
    let hit = 0;
    for (let i = 0; i < 2000; i++) {
      car.step(0.001, { throttle: 1, brake: 0, clutch: 1, handbrake: false, slope: 0 });
      ch.step(0.001, car, { steer: 0, handbrake: false });
      hit = Math.max(hit, collideWithCity(city, ch, car).impact);
      expect(ch.z).toBeGreaterThan(b.rect.z1 + 0.5);
    }
    expect(hit).toBeGreaterThan(5);
  });
});
