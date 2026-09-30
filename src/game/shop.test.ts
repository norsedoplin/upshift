import { describe, expect, it } from 'vitest';
import { applyGrants, defaultProgress, parseProgress } from './progress';
import { chooseCar, choosePaint, paintFor } from './shop';

describe('progress', () => {
  it('reads the old v1 shape and fills in the rest', () => {
    const p = parseProgress(JSON.stringify({ creds: 420, bestScore: 900, runs: 3 }));
    expect(p.creds).toBe(420);
    expect(p.ownedCars).toEqual(['hatch']);
    expect(p.car).toBe('hatch');
    expect(p.settings.rumble).toBe(1);
  });

  it('gives the playtest creds once, even to old saves', () => {
    const p = parseProgress(JSON.stringify({ creds: 420, bestScore: 900, runs: 3 }));
    expect(applyGrants(p)).toBe(true);
    expect(p.creds).toBe(12420);
    const again = parseProgress(JSON.stringify(p));
    expect(applyGrants(again)).toBe(false);
    expect(again.creds).toBe(12420);
  });

  it('survives garbage', () => {
    expect(parseProgress('{not json').creds).toBe(0);
    const p = parseProgress(JSON.stringify({ creds: 'lots', car: 'ronin', settings: { units: 'furlongs', rumble: 7 } }));
    expect(p.creds).toBe(0);
    expect(p.car).toBe('hatch'); // not owned
    expect(p.settings.units).toBe('kmh');
    expect(p.settings.rumble).toBe(1);
    expect(p.settings.camera).toBe('cockpit');
    expect(p.settings.fov).toBe(60);
    expect(p.settings.speedo).toBe('auto');
    expect(parseProgress(JSON.stringify({ settings: { speedo: 'off' } })).settings.speedo).toBe('off');
  });

  it('keeps camera settings in range', () => {
    const p = parseProgress(JSON.stringify({ settings: { camera: 'drone', fov: 170 } }));
    expect(p.settings.camera).toBe('cockpit');
    expect(p.settings.fov).toBe(100);
    expect(parseProgress(JSON.stringify({ settings: { camera: 'chase', fov: 73 } })).settings).toMatchObject({ camera: 'chase', fov: 75 });
  });
});

describe('shop', () => {
  it('buys a car only with enough creds', () => {
    const p = defaultProgress();
    p.creds = 1000;
    expect(chooseCar(p, 'kitsune')).toBe('too-poor');
    expect(p.creds).toBe(1000);
    p.creds = 1600;
    expect(chooseCar(p, 'kitsune')).toBe('bought');
    expect(p.creds).toBe(100);
    expect(p.car).toBe('kitsune');
    expect(chooseCar(p, 'hatch')).toBe('equipped');
    expect(chooseCar(p, 'kitsune')).toBe('equipped');
    expect(p.creds).toBe(100);
  });

  it('buys paint once and uses it on any car', () => {
    const p = defaultProgress();
    p.creds = 300;
    expect(choosePaint(p, 'green')).toBe('bought');
    expect(p.creds).toBe(100);
    expect(paintFor(p, 'hatch').id).toBe('green');
    p.ownedCars.push('ronin');
    chooseCar(p, 'ronin');
    expect(paintFor(p, 'ronin').id).toBe('midnight'); // its own default until changed
    expect(choosePaint(p, 'green')).toBe('equipped');
    expect(p.creds).toBe(100);
    expect(choosePaint(p, 'candy')).toBe('too-poor');
  });
});
