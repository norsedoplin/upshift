import { describe, expect, it } from 'vitest';
import { generateTouge, SAMPLE_STEP } from './touge';

describe('touge generator', () => {
  const road = generateTouge();

  it('is deterministic for a seed', () => {
    const again = generateTouge();
    expect(again.samples.length).toBe(road.samples.length);
    expect(again.samples[500].x).toBe(road.samples[500].x);
  });

  it('is long enough and descends', () => {
    expect(road.length).toBeGreaterThan(4000);
    expect(road.samples[road.samples.length - 1].h).toBeLessThan(road.samples[0].h - 100);
  });

  it('never crosses or runs alongside itself', () => {
    const s = road.samples;
    let min = Infinity;
    for (let i = 0; i < s.length; i += 2)
      for (let j = 0; j < i - 90 / SAMPLE_STEP; j += 2) min = Math.min(min, Math.hypot(s[i].x - s[j].x, s[i].z - s[j].z));
    expect(min).toBeGreaterThan(28);
  });

  it('has hairpins and keeps grades drivable', () => {
    const tightest = Math.max(...road.samples.map((p) => Math.abs(p.kappa)));
    expect(1 / tightest).toBeLessThan(20);
    for (let i = 1; i < road.samples.length; i++) {
      const grade = (road.samples[i - 1].h - road.samples[i].h) / SAMPLE_STEP;
      expect(Math.abs(grade)).toBeLessThan(0.12);
    }
  });

  it('locates points relative to the centreline', () => {
    const p = road.sampleAt(1234);
    const lx = -Math.cos(p.yaw);
    const lz = Math.sin(p.yaw);
    const loc = road.locate(p.x + lx * 2, p.z + lz * 2, Math.round(1234 / SAMPLE_STEP));
    expect(loc.s).toBeCloseTo(1234, 0);
    expect(loc.offset).toBeCloseTo(2, 1);
    const cold = road.locate(p.x - lx * 3, p.z - lz * 3);
    expect(cold.offset).toBeCloseTo(-3, 1);
  });

  it('has a lot at the start and more along the way', () => {
    expect(road.lots.length).toBeGreaterThanOrEqual(4);
    expect(road.lots[0].s1).toBeLessThan(road.startS);
    const l = road.lots[1];
    expect(road.lotDepth((l.s0 + l.s1) / 2, l.side)).toBe(l.depth);
    expect(road.lotDepth((l.s0 + l.s1) / 2, -l.side)).toBe(0);
    expect(road.lotDepth(l.s0 + 5, l.side)).toBeCloseTo(l.depth / 2);
  });
});
