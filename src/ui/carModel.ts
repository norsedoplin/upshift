// Low-poly exterior car models. Each design (see CarDesign in cars.ts) has its own
// side profile, extruded across the car with enough segments to be shaped: the
// nose and tail are rounded in plan, hoods get a crown or fender bulges, the
// glasshouse leans in and can taper towards the rear. Details are layered on:
// glass, arches, spoked rims, lights (pop-ups where the real thing had them),
// bumpers, plates, mirrors, shut-lines, exhausts and wings.
//
// Axes: +x right, +y up, -z forwards. The car's front is at z = -length / 2.
// Designs are inspired by classic mountain-road cars; no badges or brand names.

import * as THREE from 'three';
import type { BodyShape, CarDesign } from '../cars';

type P = [number, number]; // (z, y) in the side view
type UV = [number, number]; // (u along the length from the nose 0..1, v = height above the underbody / body height)

export interface CarModelOptions {
  /** Pop-up headlights raised (the garage shows them up; on the road they're down). */
  lightsUp?: boolean;
}

interface Kit {
  g: THREE.Group;
  m: Record<'paint' | 'glass' | 'black' | 'trim' | 'rubber' | 'silver' | 'chrome' | 'headlight' | 'taillight' | 'amber' | 'plate' | 'smoke', THREE.Material>;
  L: number;
  W: number;
  H: number;
  R: number;
  f: number;
  rh: number;
  belt: number;
  roof: number;
  at: (u: number) => number;
  add: (geo: THREE.BufferGeometry, mat: THREE.Material, x?: number, y?: number, z?: number) => THREE.Mesh;
  box: (w: number, h: number, d: number, mat: THREE.Material, x: number, y: number, z: number, rx?: number, ry?: number, rz?: number) => THREE.Mesh;
  mirrored: (fn: (side: 1 | -1) => void) => void;
  /** Height of the painted upper surface at u and xn (-1..1 across). */
  topY: (u: number, xn?: number) => number;
  /** z of the nose surface at height y, and of the tail surface. */
  frontZ: (y: number) => number;
  rearZ: (y: number) => number;
  halfAt: (u: number) => number;
  /** Extra height the crown/fender shaping adds at (xn, u). */
  surf: (xn: number, u: number) => number;
  deform: (geo: THREE.BufferGeometry, width: number) => void;
  extrude: (pts: P[], width: number, bevel: number, steps?: number) => THREE.BufferGeometry;
  opts: CarModelOptions;
}

interface Design {
  rideHeight: number; // underbody height as a fraction of wheel radius
  top: UV[]; // upper outline from the nose to the tail
  bottomFront: number; // u where the underside begins (bumper chamfer)
  bottomRear: number;
  cabin: { cf: number; rf: number; rr: number; cr: number; arc: number };
  taperFront: [number, number]; // [amount, length as fraction of L]
  taperRear: [number, number];
  crown: number; // m, rise of the hood/deck centre
  surface?: (xn: number, u: number) => number; // extra shaping of upper surfaces, m
  tumblehome: number;
  cabinTaper: number; // glasshouse narrows towards the rear (teardrop)
  roofDip: number; // m, a groove down the roof's centre (double bubble)
  sidePillar: number | null; // fraction between roof front and rear where a pillar splits the side glass
  axles: [number, number];
  doorRear: number; // fraction between cabin front and rear
  spokes: number;
  spokeWidth: number;
  rim: 'silver' | 'dark';
  mirrors: 'paint' | 'black';
  details: (k: Kit) => void;
}

const gauss = (x: number) => Math.exp(-x * x);
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

const DESIGNS: Record<CarDesign, Design> = {
  // The starter: a boxy little hatchback.
  hatch: {
    rideHeight: 0.55,
    top: [[0, 0.28], [0.008, 0.6], [0.067, 0.84], [0.34, 1], [0.97, 1], [0.982, 0.945], [1, 0.55]],
    bottomFront: 0.036,
    bottomRear: 0.974,
    cabin: { cf: 0.34, rf: 0.53, rr: 0.88, cr: 0.97, arc: 0.02 },
    taperFront: [0.05, 0.1],
    taperRear: [0.04, 0.08],
    crown: 0.02,
    tumblehome: 0.22,
    cabinTaper: 0,
    roofDip: 0,
    sidePillar: 0.46,
    axles: [0.17, 0.82],
    doorRear: 0.5,
    spokes: 5,
    spokeWidth: 0.055,
    rim: 'silver',
    mirrors: 'paint',
    details: (k) => {
      const { box, mirrored, m, W, H, rh, belt, frontZ, rearZ, at } = k;
      const lightY = rh + H * 0.52;
      mirrored((side) => {
        box(0.34, 0.12, 0.1, m.headlight, side * (W / 2 - 0.3), lightY, frontZ(lightY) + 0.04);
        box(0.12, 0.04, 0.06, m.amber, side * (W / 2 - 0.2), rh + 0.2, frontZ(rh + 0.2) + 0.02);
        box(0.3, 0.1, 0.06, m.taillight, side * (W / 2 - 0.25), rh + H * 0.64, rearZ(rh + H * 0.64) - 0.02);
      });
      box(W * 0.34, 0.11, 0.08, m.black, 0, lightY, frontZ(lightY) + 0.035);
      box(W * 0.62, 0.07, 0.08, m.black, 0, rh + 0.1, frontZ(rh + 0.1) + 0.05);
      box(0.5, 0.11, 0.015, m.plate, 0, rh + 0.24, frontZ(rh + 0.24) - 0.005);
      box(0.5, 0.11, 0.015, m.plate, 0, rh + 0.3, rearZ(rh + 0.3) + 0.004);
      box(W * 0.94, 0.1, 0.1, m.trim, 0, rh + 0.06, rearZ(rh + 0.06) - 0.06);
      exhausts(k, [0.42], 0.045);
      const s = box(W * 0.78, 0.03, 0.24, m.paint, 0, k.roof - 0.01, at(0.88) + 0.08);
      s.rotation.x = 0.12;
      void belt;
    },
  },

  // Light rear-drive hatchback of the mid-80s: wedge nose with pop-ups, black bumpers
  // and lower band, big glass, full-width black tail panel.
  ae86: {
    rideHeight: 0.55,
    top: [[0, 0.36], [0.01, 0.52], [0.035, 0.66], [0.2, 0.85], [0.36, 1], [0.93, 1], [0.955, 0.99], [0.985, 0.9], [1, 0.6]],
    bottomFront: 0.03,
    bottomRear: 0.975,
    cabin: { cf: 0.36, rf: 0.52, rr: 0.67, cr: 0.935, arc: 0.012 },
    taperFront: [0.04, 0.08],
    taperRear: [0.03, 0.06],
    crown: 0.015,
    tumblehome: 0.2,
    cabinTaper: 0.04,
    roofDip: 0,
    sidePillar: 0.64,
    axles: [0.18, 0.755],
    doorRear: 0.62,
    spokes: 8,
    spokeWidth: 0.032,
    rim: 'silver',
    mirrors: 'black',
    details: (k) => {
      const { box, mirrored, m, W, H, rh, frontZ, rearZ, at, topY, deform, extrude, add, belt } = k;
      // Black bumpers and lower band all round (the two-tone look).
      const band = rh + 0.22;
      const bandGeo = extrude(
        [[at(0.028), rh - 0.065], [at(-0.012), rh + 0.03], [at(-0.014), band], [at(1.014), band], [at(1.012), rh + 0.03], [at(0.972), rh - 0.065]],
        W + 0.024,
        0.03,
        6,
      );
      deform(bandGeo, W + 0.024);
      add(bandGeo, m.trim);
      // Side moulding stripe.
      mirrored((side) => box(0.012, 0.035, at(0.93) - at(0.05), m.black, side * (W / 2 + 0.004), rh + H * 0.55, (at(0.05) + at(0.93)) / 2));
      popups(k, 0.05, W / 2 - 0.31, 0.38, 0.13);
      // Slim nose grille and bumper indicators.
      const noseY = rh + H * 0.46;
      box(W * 0.3, 0.035, 0.05, m.black, 0, noseY, frontZ(noseY) + 0.015);
      mirrored((side) => box(0.16, 0.045, 0.04, m.amber, side * (W / 2 - 0.2), rh + 0.15, at(-0.014) - 0.03));
      box(0.5, 0.11, 0.015, m.plate, 0, rh + 0.12, at(-0.014) - 0.04);
      // Tail: full-width black panel with red outers, amber inners.
      const tailY = rh + H * 0.72;
      const tz = rearZ(tailY) - 0.015;
      box(W * 0.94, 0.13, 0.05, m.black, 0, tailY, tz);
      mirrored((side) => {
        box(0.34, 0.1, 0.03, m.taillight, side * (W / 2 - 0.23), tailY, tz + 0.02);
        box(0.1, 0.1, 0.03, m.amber, side * (W / 2 - 0.46), tailY, tz + 0.02);
      });
      box(0.5, 0.11, 0.015, m.plate, 0, rh + 0.36, rearZ(rh + 0.36) + 0.006);
      // Lip spoiler at the base of the hatch glass.
      const ly = topY(0.95) + 0.02;
      const lip = box(W * 0.84, 0.025, 0.12, m.paint, 0, ly, at(0.95));
      lip.rotation.x = -0.15;
      exhausts(k, [0.45], 0.04);
      void belt;
    },
  },

  // 90s turbo coupe: smooth rounded nose with narrow slanted headlights, wide lower
  // opening, long doors, high trunk with a low wing.
  s14: {
    rideHeight: 0.55,
    top: [[0, 0.4], [0.012, 0.62], [0.04, 0.74], [0.09, 0.8], [0.2, 0.9], [0.33, 1], [0.81, 1], [0.84, 1.03], [0.97, 1.03], [0.99, 0.95], [1, 0.6]],
    bottomFront: 0.03,
    bottomRear: 0.97,
    cabin: { cf: 0.33, rf: 0.49, rr: 0.66, cr: 0.82, arc: 0.02 },
    taperFront: [0.08, 0.1],
    taperRear: [0.05, 0.08],
    crown: 0.03,
    surface: (xn, u) => 0.015 * gauss((u - 0.745) / 0.09) * gauss((Math.abs(xn) - 0.85) / 0.2),
    tumblehome: 0.24,
    cabinTaper: 0.05,
    roofDip: 0,
    sidePillar: 0.8,
    axles: [0.185, 0.744],
    doorRear: 0.66,
    spokes: 5,
    spokeWidth: 0.06,
    rim: 'silver',
    mirrors: 'paint',
    details: (k) => {
      const { box, mirrored, m, W, H, rh, frontZ, rearZ, at, topY, add, surf } = k;
      // Narrow, slanted headlights lying on the sloped nose, with projector lenses.
      const hy = rh + H * 0.69;
      const slope = Math.atan2(frontZ(hy + 0.03) - frontZ(hy - 0.03), 0.06); // lean back from vertical
      mirrored((side) => {
        const x = side * (W / 2 - 0.31);
        // The hood's crown lifts the sloped nose, which moves its surface forwards.
        const hz = frontZ(hy) - surf(x / (W / 2), 0.03) * Math.tan(slope);
        box(0.44, 0.1, 0.03, m.smoke, x, hy, hz - 0.006, slope, 0, side * 0.08);
        box(0.26, 0.065, 0.02, m.headlight, x + side * 0.07, hy + 0.004, hz - 0.02, slope, 0, side * 0.08);
        add(new THREE.CylinderGeometry(0.032, 0.032, 0.03, 12).rotateX(Math.PI / 2 - slope), m.chrome, x - side * 0.13, hy - 0.006, hz - 0.02);
        // Fog lamps in the bumper.
        add(new THREE.CylinderGeometry(0.035, 0.035, 0.04, 10).rotateX(Math.PI / 2), m.headlight, side * (W / 2 - 0.26), rh + 0.14, frontZ(rh + 0.14) + 0.01);
      });
      // Wide lower opening with a body-colour bar across, and a slim upper grille.
      const oy = rh + 0.15;
      box(W * 0.56, 0.13, 0.08, m.black, 0, oy, frontZ(oy) + 0.035);
      box(W * 0.56, 0.02, 0.02, m.paint, 0, oy + 0.005, frontZ(oy) - 0.01);
      box(W * 0.26, 0.03, 0.04, m.black, 0, hy - 0.02, frontZ(hy - 0.02) + 0.012);
      box(0.5, 0.11, 0.015, m.plate, 0, rh + 0.26, frontZ(rh + 0.26) - 0.005);
      // Full-width tail band: red outers, dark red centre garnish.
      const ty = rh + H * 0.8;
      const tz = rearZ(ty) - 0.02;
      box(W * 0.5, 0.1, 0.05, k.m.smoke, 0, ty, tz);
      mirrored((side) => box(0.36, 0.11, 0.05, m.taillight, side * (W / 2 - 0.22), ty, tz));
      box(0.5, 0.11, 0.015, m.plate, 0, rh + 0.3, rearZ(rh + 0.3) + 0.005);
      box(W * 0.9, 0.08, 0.1, m.trim, 0, rh + 0.05, rearZ(rh + 0.05) - 0.06);
      // Low wing on two stands at the trunk's edge.
      const deck = topY(0.93);
      mirrored((side) => box(0.03, 0.08, 0.1, m.paint, side * 0.52, deck + 0.04, at(0.93)));
      box(W * 0.86, 0.025, 0.2, m.paint, 0, deck + 0.09, at(0.93) + 0.01, -0.05);
      exhausts(k, [0.45], 0.055);
    },
  },

  // Early-90s twin-rotor sports car: very low, wide and curvy, pop-ups on the fenders,
  // oval nose intake, double-bubble roof, teardrop glass and a hoop wing.
  fd: {
    rideHeight: 0.5,
    top: [[0, 0.3], [0.012, 0.5], [0.04, 0.6], [0.12, 0.72], [0.24, 0.85], [0.36, 1], [0.9, 1], [0.93, 0.99], [0.985, 0.88], [1, 0.62]],
    bottomFront: 0.035,
    bottomRear: 0.975,
    cabin: { cf: 0.36, rf: 0.51, rr: 0.62, cr: 0.905, arc: 0.02 },
    taperFront: [0.13, 0.14],
    taperRear: [0.08, 0.1],
    crown: 0,
    surface: (xn, u) => {
      const a = Math.abs(xn);
      const front = 0.075 * gauss((u - 0.19) / 0.12) * gauss((a - 0.8) / 0.22);
      const hips = 0.06 * gauss((u - 0.76) / 0.1) * gauss((a - 0.82) / 0.2);
      const dip = u < 0.37 ? -0.015 * gauss(xn / 0.35) : 0;
      return front + hips + dip;
    },
    tumblehome: 0.26,
    cabinTaper: 0.18,
    roofDip: 0.018,
    sidePillar: 0.84,
    axles: [0.19, 0.757],
    doorRear: 0.7,
    spokes: 5,
    spokeWidth: 0.035,
    rim: 'dark',
    mirrors: 'paint',
    details: (k) => {
      const { box, mirrored, m, W, H, rh, frontZ, rearZ, at, topY, add } = k;
      popups(k, 0.075, W / 2 - 0.36, 0.34, 0.1);
      // Oval intake in the nose, flanked by slim bumper lamps.
      const iy = rh + 0.12;
      const oval = add(new THREE.CylinderGeometry(0.34, 0.34, 0.08, 18).rotateX(Math.PI / 2), m.black, 0, iy, frontZ(iy) + 0.025);
      oval.scale.set(1, 0.3, 1);
      mirrored((side) => {
        box(0.18, 0.035, 0.04, m.amber, side * (W / 2 - 0.24), iy + 0.03, frontZ(iy + 0.03) + 0.012);
        box(0.18, 0.025, 0.04, m.headlight, side * (W / 2 - 0.24), iy - 0.01, frontZ(iy - 0.01) + 0.012);
      });
      // Smoked tail strip with three round lamps a side.
      const ty = rh + H * 0.74;
      const tz = rearZ(ty) - 0.02;
      box(W * 0.9, 0.12, 0.05, m.smoke, 0, ty, tz);
      mirrored((side) => {
        [0.2, 0.34, 0.48].forEach((dx, i) => {
          add(new THREE.CylinderGeometry(0.048, 0.048, 0.03, 12).rotateX(Math.PI / 2), i === 2 ? m.amber : m.taillight, side * (W / 2 - dx), ty, tz + 0.03);
        });
      });
      box(0.5, 0.11, 0.015, m.plate, 0, rh + 0.3, rearZ(rh + 0.3) + 0.006);
      box(W * 0.86, 0.07, 0.1, m.trim, 0, rh + 0.04, rearZ(rh + 0.04) - 0.06);
      // Hoop wing: stands at the outer edges of the tail.
      const deck = topY(0.955, 0.85);
      mirrored((side) => {
        const st = box(0.05, 0.13, 0.14, m.paint, side * (W * 0.42), deck + 0.05, at(0.955));
        st.rotation.z = side * 0.12;
      });
      box(W * 0.88, 0.028, 0.2, m.paint, 0, deck + 0.12, at(0.955) + 0.01, -0.04);
      exhausts(k, [0.26, 0.42], 0.045);
    },
  },
};

/** Pop-up headlights: flush panel seams when down, raised pods with lenses when up. */
function popups(k: Kit, u: number, x: number, w: number, h: number) {
  const { box, mirrored, m, at, topY, W } = k;
  const z = at(u);
  mirrored((side) => {
    const xn = (side * x) / (W / 2);
    const y = topY(u, xn);
    if (k.opts.lightsUp) {
      box(w, h, 0.26, m.paint, side * x, y + h / 2 - 0.01, z + 0.06);
      box(w - 0.04, h - 0.04, 0.012, m.black, side * x, y + h / 2 - 0.01, z - 0.075);
      box(w - 0.08, h - 0.06, 0.012, m.headlight, side * x, y + h / 2 - 0.01, z - 0.082);
    } else {
      // Shut-lines around the closed lid.
      box(w, 0.006, 0.008, m.black, side * x, y + 0.002, z - 0.07);
      box(w, 0.006, 0.008, m.black, side * x, y + 0.004, z + 0.19);
      mirrored((s2) => box(0.008, 0.006, 0.26, m.black, side * x + s2 * (w / 2), y + 0.003, z + 0.06));
    }
  });
}

function exhausts(k: Kit, xs: number[], r: number) {
  const pipe = new THREE.CylinderGeometry(r, r, 0.16, 12).rotateX(Math.PI / 2);
  const y = k.rh + 0.04;
  for (const x of xs) k.add(pipe, k.m.chrome, x, y, k.rearZ(y) - 0.02);
}

export function buildCarModel(body: BodyShape, paint: THREE.Color, opts: CarModelOptions = {}) {
  const g = new THREE.Group();
  const flat = (c: THREE.ColorRepresentation, emissive?: THREE.ColorRepresentation, roughness = 0.6, metalness = 0) =>
    new THREE.MeshStandardMaterial({ color: c, flatShading: true, emissive: emissive ?? 0x000000, roughness, metalness });
  // Glossy clear-coated paint: the facets pick up the sky and the sun's highlight.
  const paintMat = new THREE.MeshPhysicalMaterial({
    color: paint,
    flatShading: true,
    roughness: 0.42,
    metalness: 0.08,
    clearcoat: 1,
    clearcoatRoughness: 0.07,
  });
  const headlight = flat('#fff4d6', '#ffe8b8', 0.1);
  headlight.emissiveIntensity = 0.55;
  const taillight = flat('#c8261f', '#ff2412', 0.2);
  taillight.emissiveIntensity = 0.35;
  const mats: Kit['m'] = {
    paint: paintMat,
    glass: new THREE.MeshStandardMaterial({ color: '#0d1117', flatShading: true, side: THREE.DoubleSide, roughness: 0.08, metalness: 0, envMapIntensity: 0.7 }),
    black: flat('#16171a', undefined, 0.7),
    trim: flat('#202226', undefined, 0.5),
    rubber: flat('#141416', undefined, 0.95),
    silver: flat('#c4c7cc', undefined, 0.3, 0.85),
    chrome: flat('#e2e4e8', undefined, 0.12, 1),
    headlight,
    taillight,
    amber: flat('#f2a33a', '#4a2c08', 0.2),
    plate: flat('#ecebe4'),
    smoke: flat('#3a1416', '#1a0404', 0.15),
  };

  const d = DESIGNS[body.design];
  const { length: L, width: W, height: H, cabinHeight: CH, wheelRadius: R } = body;
  const f = L / 2;
  const at = (u: number) => -f + u * L;
  const rh = R * d.rideHeight;
  const belt = rh + H;
  const roof = belt + CH;
  const BODY_BEVEL = 0.07;
  const CABIN_BEVEL = 0.04;
  const grow = BODY_BEVEL * 0.8; // the bevel pushes the outline outwards by this much

  const add = (geo: THREE.BufferGeometry, mat: THREE.Material, x = 0, y = 0, z = 0) => {
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, y, z);
    g.add(mesh);
    return mesh;
  };
  const box = (w: number, h: number, dd: number, mat: THREE.Material, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0) => {
    const mesh = add(new THREE.BoxGeometry(w, h, dd), mat, x, y, z);
    mesh.rotation.set(rx, ry, rz);
    return mesh;
  };
  const mirrored = (fn: (side: 1 | -1) => void) => {
    fn(1);
    fn(-1);
  };

  /** Extrude a side-view outline across the car, with `steps` segments across so it can be shaped. */
  const extrude = (pts: P[], width: number, bevel: number, steps = 1) => {
    const shape = new THREE.Shape(pts.map(([z, y]) => new THREE.Vector2(z, y)));
    const depth = Math.max(0.01, width - 2 * bevel);
    const geo = new THREE.ExtrudeGeometry(shape, { depth, steps, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel * 0.8, bevelSegments: 1 });
    geo.translate(0, 0, -depth / 2);
    geo.rotateY(-Math.PI / 2); // shape x -> z (along the car), extrusion -> x (across)
    return geo;
  };

  // Upper outline, and helpers to read heights and surfaces off it.
  const top = d.top;
  const vAt = (u: number) => {
    if (u <= top[0][0]) return top[0][1];
    for (let i = 1; i < top.length; i++) {
      const [u1, v1] = top[i];
      const [u0, v0] = top[i - 1];
      if (u <= u1) return v0 + ((v1 - v0) * (u - u0)) / (u1 - u0 || 1);
    }
    return top[top.length - 1][1];
  };
  const taper = (u: number) => {
    const [af, lf] = d.taperFront;
    const [ar, lr] = d.taperRear;
    return (u < lf ? af * ((lf - u) / lf) ** 2 : 0) + (u > 1 - lr ? ar * ((u - (1 - lr)) / lr) ** 2 : 0);
  };
  const halfAt = (u: number) => (W / 2) * (1 - taper(u));
  const surf = (xn: number, u: number) => d.crown * (1 - Math.min(1, xn * xn)) + (d.surface ? d.surface(xn, u) : 0);
  const topY = (u: number, xn = 0) => rh + H * vAt(u) + grow + surf(xn, u);
  // Nose and tail surfaces: walk the outline to find z at a given height.
  let peak = 0;
  top.forEach(([u, v], i) => {
    if (u < 0.5 && v > top[peak][1]) peak = i;
  });
  const frontZ = (y: number) => {
    const v = (y - rh) / H;
    // Below the outline's first point the nose chamfers back to the underside.
    if (v < top[0][1]) return at(d.bottomFront + (top[0][0] - d.bottomFront) * clamp01(v / top[0][1])) - grow;
    for (let i = 1; i <= peak; i++) {
      const [u0, v0] = top[i - 1];
      const [u1, v1] = top[i];
      if (v <= v1) return at(u0 + ((u1 - u0) * clamp01((v - v0) / (v1 - v0 || 1)))) - grow;
    }
    return at(top[0][0]) - grow;
  };
  const rearZ = (y: number) => {
    const v = (y - rh) / H;
    const last = top[top.length - 1];
    if (v < last[1]) return at(d.bottomRear + (last[0] - d.bottomRear) * clamp01(v / last[1])) + grow;
    for (let i = top.length - 1; i > 0; i--) {
      const [u1, v1] = top[i];
      const [u0, v0] = top[i - 1];
      if (v <= v0 || i === 1) return at(u1 + ((u0 - u1) * clamp01((v - v1) / (v0 - v1 || 1)))) + grow;
    }
    return at(1) + grow;
  };

  /** Round the ends in plan and shape the upper surfaces (crown, fenders), in place. */
  const deform = (geo: THREE.BufferGeometry, width: number) => {
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const y = pos.getY(i);
      const z = pos.getZ(i);
      const u = (z + f) / L;
      const xn = Math.max(-1, Math.min(1, x / (width / 2)));
      const t = clamp01((y - rh) / Math.max(0.05, rh + H * vAt(clamp01(u)) - rh)) ** 4;
      pos.setX(i, x * (1 - taper(clamp01(u))));
      pos.setY(i, y + t * surf(xn, clamp01(u)));
    }
    geo.computeVertexNormals();
  };

  // ---- Lower body ----
  const lower: P[] = [[at(d.bottomFront), rh], ...top.map(([u, v]) => [at(u), rh + v * H] as P), [at(d.bottomRear), rh]];
  const bodyGeo = extrude(lower, W, BODY_BEVEL, 10);
  deform(bodyGeo, W);
  add(bodyGeo, paintMat);

  // ---- Glasshouse ----
  const { cf: cfu, rf: rfu, rr: rru, cr: cru, arc } = d.cabin;
  const cf = at(cfu);
  const rf = at(rfu);
  const rr = at(rru);
  const cr = at(cru);
  const halfG = (W * 0.92) / 2;
  const cabinScale = (y: number, z: number) => {
    const t = clamp01((y - belt) / CH);
    const zc = clamp01((z - cf) / (cr - cf));
    return (1 - d.tumblehome * t) * (1 - d.cabinTaper * zc * zc);
  };
  const surfaceHalf = (y: number, z: number) => halfG * cabinScale(y, z);
  const cabinPts: P[] = [[cf, belt - 0.03], [rf, roof], [(rf + rr) / 2, roof + arc], [rr, roof], [cr, belt - 0.03]];
  const cabin = extrude(cabinPts, W * 0.92, CABIN_BEVEL, 6);
  const cp = cabin.attributes.position;
  for (let i = 0; i < cp.count; i++) {
    const x = cp.getX(i);
    const y = cp.getY(i);
    const z = cp.getZ(i);
    if (y > belt) {
      const s = cabinScale(y, z);
      cp.setX(i, x * s);
      if (d.roofDip > 0) {
        const t = clamp01((y - belt) / CH);
        const xn = x / halfG;
        cp.setY(i, y - d.roofDip * clamp01((t - 0.85) / 0.15) * gauss(xn / 0.3));
      }
    }
  }
  cabin.computeVertexNormals();
  add(cabin, paintMat);

  // z on a straight line through two side-view points, at height y.
  const zOn = (a: P, b: P, y: number) => a[0] + ((b[0] - a[0]) * (y - a[1])) / (b[1] - a[1]);
  const windscreen: [P, P] = [[cf, belt - 0.03], [rf, roof]];
  const rearScreen: [P, P] = [[cr, belt - 0.03], [rr, roof]];

  // Side windows follow the leaning, tapering side of the glasshouse.
  const hi = roof - 0.06;
  // The glass starts a little above the body; swollen fenders push it up.
  const lowY = (z: number) => Math.max(belt + 0.06, topY(clamp01((z + f) / L), 0.9) + 0.03);
  const lo = belt + 0.06;
  /** A side window between a front edge and a rear edge (z as a function of y). */
  const windowPts = (front: (y: number) => number, rear: (y: number) => number): P[] => {
    const z0 = front(lo);
    const z1 = rear(lo);
    const bottom: P[] = [];
    for (let i = 0; i <= 6; i++) {
      const z = z0 + ((z1 - z0) * i) / 6;
      bottom.push([z, lowY(z)]);
    }
    return [...bottom, [Math.max(front(hi) + 0.02, rear(hi)), hi], [front(hi), hi]];
  };
  const sideWindow = (pts: P[], side: 1 | -1) => {
    const verts = pts.map(([z, y]) => new THREE.Vector3(side * (surfaceHalf(y, z) + 0.006), y, z));
    const tris = THREE.ShapeUtils.triangulateShape(pts.map(([z, y]) => new THREE.Vector2(z, y)), []);
    const geo = new THREE.BufferGeometry().setFromPoints(tris.flat().map((i) => verts[i]));
    geo.computeVertexNormals();
    add(geo, mats.glass);
  };
  const wf = (y: number) => zOn(...windscreen, y) + 0.08;
  const wr = (y: number) => zOn(...rearScreen, y) - 0.08;
  mirrored((side) => {
    if (d.sidePillar !== null) {
      const zb = rf + (rr - rf) * d.sidePillar;
      sideWindow(windowPts(wf, () => zb - 0.04), side);
      if (wr(lo) > zb + 0.12) sideWindow(windowPts(() => zb + 0.04, (y) => Math.max(zb + 0.08, wr(y))), side);
    } else {
      sideWindow(windowPts(wf, wr), side);
    }
  });

  // Windscreen and rear screen: trapezoids nudged out along their normals.
  const screen = (line: [P, P], front: boolean) => {
    const [a, b] = line;
    const dz = b[0] - a[0];
    const dy = b[1] - a[1];
    const len = Math.hypot(dz, dy);
    const nz = ((front ? -1 : 1) * Math.abs(dy)) / len;
    const ny = Math.abs(dz) / len;
    const out = CABIN_BEVEL * 0.8 + 0.008;
    const y0 = belt + 0.04;
    const y1 = roof - 0.04;
    const z0 = zOn(a, b, y0);
    const z1 = zOn(a, b, y1);
    const x0 = surfaceHalf(y0, z0) - 0.07;
    const x1 = surfaceHalf(y1, z1) - 0.07;
    const q = [
      new THREE.Vector3(-x0, y0 + ny * out, z0 + nz * out),
      new THREE.Vector3(x0, y0 + ny * out, z0 + nz * out),
      new THREE.Vector3(x1, y1 + ny * out, z1 + nz * out),
      new THREE.Vector3(-x1, y1 + ny * out, z1 + nz * out),
    ];
    const geo = new THREE.BufferGeometry().setFromPoints([q[0], q[1], q[2], q[0], q[2], q[3]]);
    geo.computeVertexNormals();
    add(geo, mats.glass);
  };
  screen(windscreen, true);
  screen(rearScreen, false);

  // ---- Wheels and arches ----
  const axles = d.axles.map(at);
  const tyreW = 0.22 + R * 0.1;
  const tyre = new THREE.CylinderGeometry(R, R, tyreW, 20).rotateZ(Math.PI / 2);
  const rimR = R * 0.68;
  const rimDisc = new THREE.CylinderGeometry(rimR, rimR, 0.02, 20).rotateZ(Math.PI / 2);
  const lip = new THREE.TorusGeometry(rimR, 0.012, 4, 20).rotateY(Math.PI / 2);
  const cap = new THREE.CylinderGeometry(R * 0.13, R * 0.13, 0.03, 8).rotateZ(Math.PI / 2);
  const spoke = new THREE.BoxGeometry(0.02, rimR * 0.9, d.spokeWidth);
  const arch = new THREE.CircleGeometry(R * 1.24, 18, 0, Math.PI);
  const spokeMat = d.rim === 'dark' ? flat('#5b5f66', undefined, 0.35, 0.8) : mats.silver;
  for (const z of axles) {
    const u = (z + f) / L;
    const half = halfAt(u);
    mirrored((side) => {
      const x = side * (half - tyreW / 2 + 0.02);
      add(tyre, mats.rubber, x, R, z);
      const face = x + side * (tyreW / 2 + 0.006);
      add(rimDisc, mats.trim, face, R, z);
      add(lip, spokeMat, face + side * 0.008, R, z);
      for (let n = 0; n < d.spokes; n++) {
        const s = add(spoke, spokeMat, face + side * 0.01, R, z);
        const a = (n / d.spokes) * Math.PI * 2;
        s.rotation.x = a;
        s.position.y += Math.cos(a) * rimR * 0.45;
        s.position.z += Math.sin(a) * rimR * 0.45;
      }
      add(cap, mats.chrome, face + side * 0.016, R, z);
      const archMesh = add(arch, mats.black, side * (half + 0.006), R, z);
      archMesh.rotation.y = side * (Math.PI / 2);
    });
  }

  const kit: Kit = { g, m: mats, L, W, H, R, f, rh, belt, roof, at, add, box, mirrored, topY, frontZ, rearZ, halfAt, surf, deform, extrude, opts };

  // ---- Sides: shut-lines, handles, skirts, mirrors ----
  mirrored((side) => {
    const doorFront = cf - 0.02;
    const doorRear = cf + (cr - cf) * d.doorRear;
    const doorH = belt - rh - 0.12;
    const xAt = (z: number) => side * (halfAt((z + f) / L) + 0.003);
    box(0.008, doorH, 0.012, mats.black, xAt(doorFront), rh + 0.08 + doorH / 2, doorFront);
    box(0.008, doorH, 0.012, mats.black, xAt(doorRear), rh + 0.08 + doorH / 2, doorRear);
    box(0.012, 0.03, 0.12, mats.trim, xAt(doorRear - 0.14), belt - 0.12, doorRear - 0.14);
    const zs = axles[0] + R * 1.2;
    const ze = axles[1] - R * 1.2;
    box(0.05, 0.07, ze - zs, mats.trim, side * (W / 2 - 0.015), rh + 0.025, (zs + ze) / 2);
    const mz = cf + 0.14;
    const mirrorMat = d.mirrors === 'paint' ? paintMat : mats.black;
    box(0.08, 0.03, 0.05, mats.trim, side * (surfaceHalf(belt, mz) + 0.03), belt + 0.06, mz);
    box(0.06, 0.085, 0.14, mirrorMat, side * (surfaceHalf(belt, mz) + 0.1), belt + 0.08, mz);
  });

  d.details(kit);

  g.traverse((o) => {
    o.castShadow = true;
    o.receiveShadow = true;
  });
  return { group: g, paintMat };
}
