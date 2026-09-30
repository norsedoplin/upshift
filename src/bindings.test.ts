import { describe, expect, it } from 'vitest';
import { assignKey, assignPad, defaultBindings, padLabel, parseBindings } from './bindings';

describe('bindings', () => {
  it('moves an input off whatever used it before', () => {
    const b = defaultBindings();
    const cleared = assignPad(b, 'brake', { kind: 'button', index: 7 }); // R2, which was gas
    expect(cleared).toEqual(['gas']);
    expect(b.pad.gas).toBeNull();
    expect(padLabel(b.pad.brake)).toBe('R2');
    expect(assignKey(b, 'gas', 'KeyS')).toEqual(['brake']);
    expect(b.keys.brake).toEqual(['ArrowDown']);
  });

  it('survives garbage and keeps defaults', () => {
    const b = parseBindings({ pad: { gas: { kind: 'axis', index: 3, dir: 1 }, brake: { kind: 'laser' }, clutch: null }, keys: { gas: 'W' } });
    expect(b.pad.gas).toEqual({ kind: 'axis', index: 3, dir: 1 });
    expect(b.pad.brake).toEqual(defaultBindings().pad.brake);
    expect(b.pad.clutch).toBeNull();
    expect(b.keys.gas).toEqual(defaultBindings().keys.gas);
    expect(parseBindings('nope')).toEqual(defaultBindings());
  });

  it('labels stick directions', () => {
    expect(padLabel({ kind: 'axis', index: 3, dir: 1 })).toBe('Right stick ↓');
    expect(padLabel({ kind: 'axis', index: 0, dir: -1 })).toBe('Left stick ←');
  });
});
