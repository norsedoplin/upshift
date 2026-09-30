import { describe, expect, it } from 'vitest';
import { lightDirection, skyAt, sunDirection } from './daylight';

describe('day cycle', () => {
  it('puts the sun up by day and down at night', () => {
    expect(sunDirection(13).y).toBeGreaterThan(0.7);
    expect(sunDirection(23).y).toBeLessThan(0);
    // The light always comes from above: the moon takes over at night.
    for (let h = 0; h < 24; h += 0.25) expect(lightDirection(h).y).toBeGreaterThan(0.05);
  });

  it('is dark at night and bright at noon, with no jumps', () => {
    expect(skyAt(1).dark).toBe(1);
    expect(skyAt(13).dark).toBe(0);
    expect(skyAt(13).lightI).toBeGreaterThan(skyAt(23).lightI * 5);
    for (let h = 0; h < 24; h += 0.05) {
      const a = skyAt(h);
      const b = skyAt(h + 0.05);
      expect(Math.abs(a.lightI - b.lightI)).toBeLessThan(0.25);
      expect(Math.abs(a.horizon.r - b.horizon.r)).toBeLessThan(0.1);
    }
    expect(skyAt(24.5).dark).toBeCloseTo(skyAt(0.5).dark);
  });

  it('switches from sun to moon only while the light is faded out', () => {
    for (let h = 0; h < 24; h += 0.02) {
      const up = sunDirection(h).y > -0.02;
      const upNext = sunDirection(h + 0.02).y > -0.02;
      if (up !== upNext) expect(skyAt(h).lightI).toBeLessThan(0.15);
    }
  });
});
