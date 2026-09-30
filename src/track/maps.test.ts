import { describe, expect, it } from 'vitest';
import { MAPS, cityForMap, mapById, mapStats, roadFor } from './maps';

describe('maps', () => {
  for (const m of MAPS) {
    if (!m.options) {
      it(`builds the town ${m.name}`, () => {
        const city = cityForMap(m.id)!;
        expect(city.isOpen(city.spawn.x, city.spawn.z, 1.5)).toBe(true);
      });
      continue;
    }
    const options = m.options;
    it(`builds ${m.name}`, () => {
      const road = roadFor(m.id);
      const st = mapStats(road);
      expect(st.km).toBeGreaterThan(((options.length ?? 4200) - 300) / 1000);
      expect(road.lots.length).toBeGreaterThan(0);
      if (options.direction === 'up') expect(st.rise).toBeGreaterThan(50);
      else expect(st.rise).toBeLessThan(-50);
    });
  }
  it('falls back to the first map for an unknown id', () => {
    expect(mapById('nope').id).toBe(MAPS[0].id);
  });
  it('makes the switchbacks tighter than the ridge', () => {
    expect(mapStats(roadFor('kurogane')).hairpins / mapStats(roadFor('kurogane')).km).toBeGreaterThan(mapStats(roadFor('shiroyama')).hairpins / mapStats(roadFor('shiroyama')).km);
  });
});
