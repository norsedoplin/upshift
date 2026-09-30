// Direct DualSense rumble over WebHID.
// Chrome's Gamepad API often gives a DualSense no vibrationActuator, so we talk to the pad ourselves:
// output report 0x02 over USB, 0x31 (with a CRC) over Bluetooth. Layout follows Linux's hid-playstation.

interface HIDReportInfo {
  reportId: number;
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

/** Builds the report body (without the report id) for a rumble of 0..1 on each motor. */
export function rumbleReport(bluetooth: boolean, strong: number, weak: number, seq = 0): Uint8Array {
  const toByte = (v: number) => Math.round(Math.min(1, Math.max(0, v)) * 255);
  // Common block: valid_flag0, valid_flag1, motor_right (weak), motor_left (strong), ..., valid_flag2 at 38.
  const common = new Uint8Array(47);
  common[0] = 0x01 | 0x02; // compatible vibration + haptics select
  common[2] = toByte(weak);
  common[3] = toByte(strong);
  common[38] = 0x04; // compatible vibration v2, for newer firmware
  if (!bluetooth) {
    const data = new Uint8Array(62);
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
  private seq = 0;
  private busy = false;
  private pending: [number, number] | null = null;
  private last: [number, number] = [-1, -1];
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
    this.last = [-1, -1];
    return true;
  }

  /** Set both motors (0..1). Cheap to call every frame: it only sends when something changed. */
  rumble(strong: number, weak: number) {
    if (!this.connected) return;
    const now = performance.now();
    const changed = Math.abs(strong - this.last[0]) > 0.02 || Math.abs(weak - this.last[1]) > 0.02;
    // Resend now and then even when steady, in case a report was dropped.
    if (!changed && now - this.lastSent < 250) return;
    if (now - this.lastSent < 16) return;
    this.pending = [strong, weak];
    void this.flush();
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
    this.lastSent = performance.now();
    try {
      const id = this.bluetooth ? 0x31 : 0x02;
      await this.device.sendReport(id, rumbleReport(this.bluetooth, strong, weak, this.seq++));
    } catch (e) {
      console.warn('DualSense rumble failed', e);
    } finally {
      this.busy = false;
    }
    if (this.pending) void this.flush();
  }
}

