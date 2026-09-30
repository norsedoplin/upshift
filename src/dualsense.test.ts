import { describe, expect, it } from 'vitest';
import { TRIGGER_OFF, crc32, rumbleReport, triggerSection } from './dualsense';

describe('dualsense reports', () => {
  it('uses standard CRC-32', () => {
    expect((crc32(new TextEncoder().encode('123456789')) ^ 0xffffffff) >>> 0).toBe(0xcbf43926);
  });

  it('builds a USB rumble report', () => {
    const r = rumbleReport(false, 1, 0.5);
    expect(r.length).toBe(47); // 48 with the report id
    expect(r[0]).toBe(0x02);
    expect(r[38]).toBe(0x04);
    expect(rumbleReport(false, 1, 1, 0, false)[0]).toBe(0x03);
    expect(r[2]).toBe(128); // weak (right) motor
    expect(r[3]).toBe(255); // strong (left) motor
  });

  it('builds a Bluetooth rumble report with a valid CRC', () => {
    const r = rumbleReport(true, 0.25, 0, 3);
    expect(r.length).toBe(77); // 78 with the report id
    expect(r[0]).toBe(0x30);
    expect(r[1]).toBe(0x10);
    expect(r[2]).toBe(0x02);
    expect(r[5]).toBe(64);
    const head = new Uint8Array([0xa2, 0x31, ...r.subarray(0, 73)]);
    const crc = (crc32(head) ^ 0xffffffff) >>> 0;
    expect(new DataView(r.buffer).getUint32(73, true)).toBe(crc);
  });

  it('puts trigger effects in the right slots', () => {
    const left = triggerSection(0.5, 0.7, 0.45);
    expect([...left.subarray(0, 4)]).toEqual([0x02, 128, 179, 115]);
    const r = rumbleReport(false, 0, 0, 0, true, 47, { left, right: TRIGGER_OFF });
    expect(r[0]).toBe(0x02 | 0x04 | 0x08);
    expect(r[10]).toBe(0x05); // right trigger off
    expect([...r.subarray(21, 25)]).toEqual([0x02, 128, 179, 115]);
    expect(r[38]).toBe(0x04);
  });
});
