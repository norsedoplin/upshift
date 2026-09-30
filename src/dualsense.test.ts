import { describe, expect, it } from 'vitest';
import { crc32, rumbleReport } from './dualsense';

describe('dualsense reports', () => {
  it('uses standard CRC-32', () => {
    expect((crc32(new TextEncoder().encode('123456789')) ^ 0xffffffff) >>> 0).toBe(0xcbf43926);
  });

  it('builds a USB rumble report', () => {
    const r = rumbleReport(false, 1, 0.5);
    expect(r.length).toBe(62); // 63 with the report id
    expect(r[0]).toBe(0x03);
    expect(r[2]).toBe(128); // weak (right) motor
    expect(r[3]).toBe(255); // strong (left) motor
  });

  it('builds a Bluetooth rumble report with a valid CRC', () => {
    const r = rumbleReport(true, 0.25, 0, 3);
    expect(r.length).toBe(77); // 78 with the report id
    expect(r[0]).toBe(0x30);
    expect(r[1]).toBe(0x10);
    expect(r[2]).toBe(0x03);
    expect(r[5]).toBe(64);
    const head = new Uint8Array([0xa2, 0x31, ...r.subarray(0, 73)]);
    const crc = (crc32(head) ^ 0xffffffff) >>> 0;
    expect(new DataView(r.buffer).getUint32(73, true)).toBe(crc);
  });
});
