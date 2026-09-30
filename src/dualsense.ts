// Direct DualSense rumble over WebHID.
// Chrome's Gamepad API often gives a DualSense no vibrationActuator, so we talk to the pad ourselves:
// output report 0x02 over USB, 0x31 (with a CRC) over Bluetooth. Layout follows Linux's hid-playstation.

interface HIDReportItem {
  reportSize?: number; // bits per field
  reportCount?: number;
}
interface HIDReportInfo {
  reportId: number;
  items?: HIDReportItem[];
}
interface HIDCollection {
  outputReports?: HIDReportInfo[];
}
interface HIDDeviceLike {
  opened: boolean;
  vendorId: number;
  productId: number;
  productName: string;
  collections: HIDCollection[];
  open(): Promise<void>;
  close(): Promise<void>;
  sendReport(reportId: number, data: Uint8Array): Promise<void>;
  receiveFeatureReport(reportId: number): Promise<DataView>;
}
interface HIDLike {
  getDevices(): Promise<HIDDeviceLike[]>;
  requestDevice(opts: { filters: { vendorId: number; productId?: number }[] }): Promise<HIDDeviceLike[]>;
  addEventListener(type: 'disconnect', cb: (e: { device: HIDDeviceLike }) => void): void;
}

const SONY = 0x054c;
const PRODUCTS = [0x0ce6, 0x0df2]; // DualSense, DualSense Edge

const hid = (): HIDLike | undefined => (navigator as unknown as { hid?: HIDLike }).hid;

let crcTable: Uint32Array | null = null;
export function crc32(bytes: Uint8Array, seed = 0xffffffff) {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let c = seed;
  for (const b of bytes) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return c >>> 0;
}

/** An adaptive-trigger effect: 11 bytes, mode first. */
export type TriggerEffect = Uint8Array;

/** No resistance. */
export const TRIGGER_OFF: TriggerEffect = new Uint8Array([0x05, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);

/**
 * Resistance over one stretch of the trigger's travel (0 = released, 1 = fully pressed) that
 * gives way past the end, like pushing through a clutch's bite point. Force is 0..1.
 */
export function triggerSection(start: number, end: number, force: number): TriggerEffect {
  const b = (v: number) => Math.round(Math.min(1, Math.max(0, v)) * 255);
  const e = new Uint8Array(11);
  e[0] = 0x02; // "simple section" resistance
  e[1] = b(start);
  e[2] = Math.max(b(start) + 1, b(end));
  e[3] = b(force);
  return e;
}

export interface Triggers {
  left?: TriggerEffect;
  right?: TriggerEffect;
}

/** Builds the report body (without the report id) for a rumble of 0..1 on each motor. */
export function rumbleReport(
  bluetooth: boolean,
  strong: number,
  weak: number,
  seq = 0,
  v2 = true,
  usbLength = 47,
  triggers: Triggers = {},
): Uint8Array {
  const toByte = (v: number) => Math.round(Math.min(1, Math.max(0, v)) * 255);
  // Common block: valid_flag0, valid_flag1, motor_right (weak), motor_left (strong), ..., valid_flag2 at 38.
  const common = new Uint8Array(47);
  // Haptics select, plus the rumble-emulation flag: in valid_flag2 on firmware from 2021 on
  // (what Linux calls vibration v2), in valid_flag0 on older firmware.
  common[0] = 0x02 | (v2 ? 0 : 0x01);
  common[2] = toByte(weak);
  common[3] = toByte(strong);
  if (v2) common[38] = 0x04;
  // Adaptive triggers: flag bits 2 (right) and 3 (left); effects at 10 (right) and 21 (left).
  if (triggers.right) {
    common[0] |= 0x04;
    common.set(triggers.right.subarray(0, 11), 10);
  }
  if (triggers.left) {
    common[0] |= 0x08;
    common.set(triggers.left.subarray(0, 11), 21);
  }
  if (!bluetooth) {
    // Over USB the body is the common block; Windows rejects a report longer than the descriptor says (47 bytes).
    const data = new Uint8Array(Math.max(47, usbLength));
    data.set(common, 0);
    return data;
  }
  const data = new Uint8Array(77);
  data[0] = (seq & 0x0f) << 4;
  data[1] = 0x10; // output tag
  data.set(common, 2);
  // CRC covers a 0xA2 header byte, the report id and the body up to the CRC itself.
  const crcInput = new Uint8Array(1 + 1 + 73);
  crcInput[0] = 0xa2;
  crcInput[1] = 0x31;
  crcInput.set(data.subarray(0, 73), 2);
  const crc = crc32(crcInput) ^ 0xffffffff;
  new DataView(data.buffer).setUint32(73, crc >>> 0, true);
  return data;
}

export class DualSense {
  device: HIDDeviceLike | null = null;
  bluetooth = false;
  /** Newer firmware wants the v2 rumble flag; older firmware the original one. */
  vibrationV2 = true;
  firmware = '';
  lastError = '';
  /** Body length of USB report 0x02 as the device describes it. */
  usbLength = 47;
  private seq = 0;
  private busy = false;
  private pending: [number, number] | null = null;
  private last: [number, number] = [-1, -1];
  private triggers: Triggers = {};
  private triggersDirty = false;
  private lastSent = 0;

  static supported() {
    return !!hid();
  }

  get connected() {
    return !!this.device?.opened;
  }

  /** Reopen a pad the player already allowed on an earlier visit. No prompt. */
  async restore() {
    const h = hid();
    if (!h) return false;
    h.addEventListener('disconnect', (e) => {
      if (e.device === this.device) this.device = null;
    });
    const devices = (await h.getDevices()).filter((d) => d.vendorId === SONY && PRODUCTS.includes(d.productId));
    return devices.length ? this.use(devices[0]) : false;
  }

  /** Ask the browser for the pad. Must run from a click or key press. */
  async request() {
    const h = hid();
    if (!h) return false;
    const devices = await h.requestDevice({ filters: PRODUCTS.map((productId) => ({ vendorId: SONY, productId })) });
    return devices.length ? this.use(devices[0]) : false;
  }

  private async use(d: HIDDeviceLike) {
    if (!d.opened) await d.open();
    this.device = d;
    this.bluetooth = d.collections.some((c) => c.outputReports?.some((r) => r.reportId === 0x31));
    this.usbLength = reportLength(d, 0x02) ?? 47;
    this.last = [-1, -1];
    this.lastError = '';
    await this.readFirmware();
    return true;
  }

  /** Feature report 0x20 carries the firmware's update version; 2.21 switched rumble to v2 (see hid-playstation). */
  private async readFirmware() {
    if (!this.device || this.device.productId !== 0x0ce6) return; // the Edge always uses v2
    try {
      const view = await this.device.receiveFeatureReport(0x20);
      // Some platforms include the report id as byte 0, some don't.
      const off = view.byteLength >= 64 ? 44 : 43;
      const version = view.getUint16(off, true);
      this.firmware = `${version >> 8}.${(version & 0xff).toString().padStart(2, '0')}`;
      this.vibrationV2 = version >= 0x0215;
    } catch (e) {
      console.warn('DualSense firmware read failed', e);
    }
  }

  /** One rumble for the settings test: sends straight away and reports any error. */
  async pulse(strong: number, weak: number, ms: number): Promise<string> {
    if (!this.device) return 'Not connected';
    try {
      await this.send(strong, weak);
      await new Promise((r) => setTimeout(r, ms));
      await this.send(0, 0);
      return '';
    } catch (e) {
      console.warn('DualSense rumble failed', e);
      return e instanceof Error ? `${e.name}: ${e.message}` : String(e);
    }
  }

  private send(strong: number, weak: number) {
    const id = this.bluetooth ? 0x31 : 0x02;
    this.lastSent = performance.now();
    this.triggersDirty = false;
    return this.device!.sendReport(
      id,
      rumbleReport(this.bluetooth, strong, weak, this.seq++, this.vibrationV2, this.usbLength, this.triggers),
    );
  }

  /** Set both motors (0..1). Cheap to call every frame: it only sends when something changed. */
  rumble(strong: number, weak: number) {
    if (!this.connected) return;
    const now = performance.now();
    const changed = this.triggersDirty || Math.abs(strong - this.last[0]) > 0.02 || Math.abs(weak - this.last[1]) > 0.02;
    // Resend now and then even when steady, in case a report was dropped.
    if (!changed && now - this.lastSent < 250) return;
    this.pending = [strong, weak];
    void this.flush();
  }

  /** Set the resistance on each trigger. Only resends when an effect actually changes. */
  setTriggers(left: TriggerEffect, right: TriggerEffect) {
    const same = (a?: TriggerEffect, b?: TriggerEffect) => !!a && !!b && a.every((v, i) => v === b[i]);
    if (same(this.triggers.left, left) && same(this.triggers.right, right)) return;
    this.triggers = { left, right };
    this.triggersDirty = true;
  }

  stop() {
    this.pending = [0, 0];
    this.last = [-1, -1];
    void this.flush();
  }

  private async flush() {
    if (this.busy || !this.pending || !this.device) return;
    this.busy = true;
    const [strong, weak] = this.pending;
    this.pending = null;
    this.last = [strong, weak];
    try {
      await this.send(strong, weak);
      this.lastError = '';
    } catch (e) {
      if (!this.lastError) console.warn('DualSense rumble failed', e);
      this.lastError = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
    } finally {
      this.busy = false;
    }
    if (this.pending) void this.flush();
  }
}


/** Byte length of an output report from the device's descriptor, if it lists one. */
function reportLength(d: HIDDeviceLike, id: number) {
  for (const c of d.collections) {
    const r = c.outputReports?.find((x) => x.reportId === id);
    if (!r?.items?.length) continue;
    const bits = r.items.reduce((n, it) => n + (it.reportSize ?? 0) * (it.reportCount ?? 0), 0);
    if (bits > 0) return Math.ceil(bits / 8);
  }
  return null;
}
