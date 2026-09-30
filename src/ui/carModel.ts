// Low-poly exterior car models for the garage. Each body style has its own side
// profile, extruded across the car's width, with a tapered glasshouse on top, and
// details layered over it: glass, arches, spoked rims, lights, plates, mirrors,
// door shut-lines, exhausts and a spoiler.
//
// Axes: +x right, +y up, -z forwards. The car's front is at z = -length / 2.

import * as THREE from 'three';
import type { BodyShape } from '../cars';

type P = [number, number]; // (z, y) in the side view

interface Profile {
  cabinFront: number; // where the windscreen meets the body (fraction of length from the nose)
  roofFront: number;
  roofRear: number;
  cabinRear: number;
  hoodFront: number; // hood leading edge height, fraction of body height
  deckDrop: number; // how far the rear deck falls to the tail, m
  doorRear: number; // fraction between cabinFront and cabinRear
  bPillar: boolean;
}

const PROFILES: Record<BodyShape['style'], Profile> = {
  hatch: { cabinFront: 0.34, roofFront: 0.53, roofRear: 0.88, cabinRear: 0.97, hoodFront: 0.84, deckDrop: 0.04, doorRear: 0.5, bPillar: true },
  coupe: { cabinFront: 0.41, roofFront: 0.58, roofRear: 0.72, cabinRear: 0.93, hoodFront: 0.7, deckDrop: 0.02, doorRear: 0.62, bPillar: false },
  sedan: { cabinFront: 0.36, roofFront: 0.52, roofRear: 0.72, cabinRear: 0.83, hoodFront: 0.78, deckDrop: 0.05, doorRear: 0.52, bPillar: true },
};

const TUMBLEHOME = 0.22; // how much the glasshouse narrows towards the roof

export function buildCarModel(body: BodyShape, paint: THREE.Color) {
  const g = new THREE.Group();
  const flat = (c: THREE.ColorRepresentation, emissive?: THREE.ColorRepresentation) =>
    new THREE.MeshLambertMaterial({ color: c, flatShading: true, emissive: emissive ?? 0x000000 });
  const paintMat = flat(paint);
  const glass = new THREE.MeshLambertMaterial({ color: '#1a2230', flatShading: true, side: THREE.DoubleSide });
  const black = flat('#16171a');
  const trim = flat('#2a2c31');
  const rubber = flat('#141416');
  const silver = flat('#b9bcc2');
  const chrome = flat('#8d9096');
  const headlight = flat('#fff4d6', '#6a6350');
  const taillight = flat('#c8261f', '#4a0c08');
  const plate = flat('#ecebe4');

  const { length: L, width: W, height: H, cabinHeight: CH, wheelRadius: R } = body;
  const pr = PROFILES[body.style];
  const f = L / 2;
  const at = (u: number) => -f + u * L; // fraction of length from the nose -> z
  const rh = R * 0.55; // underbody height
  const belt = rh + H; // top of the lower body
  const roof = belt + CH;
  const cf = at(pr.cabinFront);
  const rf = at(pr.roofFront);
  const rr = at(pr.roofRear);
  const cr = at(pr.cabinRear);
  const deckEnd = belt - pr.deckDrop;
  const BODY_BEVEL = 0.07;
  const CABIN_BEVEL = 0.04;
  const nose = -f - BODY_BEVEL * 0.8; // the bevel grows the outline outwards
  const tail = f + BODY_BEVEL * 0.8;

  const add = (geo: THREE.BufferGeometry, mat: THREE.Material, x = 0, y = 0, z = 0) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    g.add(m);
    return m;
  };
  const box = (w: number, h: number, d: number, mat: THREE.Material, x: number, y: number, z: number) => add(new THREE.BoxGeometry(w, h, d), mat, x, y, z);
  const mirrored = (fn: (side: 1 | -1) => void) => {
    fn(1);
    fn(-1);
  };

  /** Extrude a side-view outline across the car, chamfering the edges. */
  const extrudeSide = (pts: P[], width: number, bevel: number) => {
    const shape = new THREE.Shape(pts.map(([z, y]) => new THREE.Vector2(z, y)));
    const depth = Math.max(0.01, width - 2 * bevel);
    const geo = new THREE.ExtrudeGeometry(shape, {
      depth,
      bevelEnabled: true,
      bevelThickness: bevel,
      bevelSize: bevel * 0.8,
      bevelSegments: 1,
    });
    geo.translate(0, 0, -depth / 2);
    geo.rotateY(-Math.PI / 2); // shape x -> z (along the car), extrusion -> x (across)
    return geo;
  };

  // ---- Lower body ----
  const lower: P[] = [
    [-f + 0.14, rh],
    [-f, rh + 0.2],
    [-f + 0.03, rh + H * 0.6],
    [-f + 0.26, rh + H * pr.hoodFront],
    [cf, belt],
    [Math.max(cf + 0.1, cr), belt],
    [f - 0.07, deckEnd],
    [f, rh + H * 0.55],
    [f - 0.1, rh],
  ];
  add(extrudeSide(lower, W, BODY_BEVEL), paintMat);

  // ---- Glasshouse: painted shell whose sides lean in towards the roof ----
  const halfG = (W * 0.92) / 2;
  const surfaceHalf = (y: number) => halfG * (1 - TUMBLEHOME * Math.min(1, Math.max(0, (y - belt) / CH)));
  const cabinPts: P[] = [
    [cf, belt - 0.03],
    [rf, roof],
    [(rf + rr) / 2, roof + 0.025],
    [rr, roof],
    [cr, belt - 0.03],
  ];
  const cabin = extrudeSide(cabinPts, W * 0.92, CABIN_BEVEL);
  const cp = cabin.attributes.position;
  for (let i = 0; i < cp.count; i++) {
    const y = cp.getY(i);
    if (y > belt) cp.setX(i, cp.getX(i) * (1 - TUMBLEHOME * Math.min(1, (y - belt) / CH)));
  }
  cabin.computeVertexNormals();
  add(cabin, paintMat);

  // z on a straight line through two side-view points, at height y.
  const zOn = (a: P, b: P, y: number) => a[0] + ((b[0] - a[0]) * (y - a[1])) / (b[1] - a[1]);
  const windscreen: [P, P] = [[cf, belt - 0.03], [rf, roof]];
  const rearScreen: [P, P] = [[cr, belt - 0.03], [rr, roof]];

  // Side windows follow the leaning side of the glasshouse.
  const lo = belt + 0.06;
  const hi = roof - 0.06;
  const sideWindow = (pts: P[], side: 1 | -1) => {
    const verts = pts.map(([z, y]) => new THREE.Vector3(side * (surfaceHalf(y) + 0.006), y, z));
    const tris = THREE.ShapeUtils.triangulateShape(pts.map(([z, y]) => new THREE.Vector2(z, y)), []);
    const geo = new THREE.BufferGeometry().setFromPoints(tris.flat().map((i) => verts[i]));
    geo.computeVertexNormals();
    add(geo, glass);
  };
  const wf = (y: number) => zOn(...windscreen, y) + 0.08;
  const wr = (y: number) => zOn(...rearScreen, y) - 0.08;
  mirrored((side) => {
    if (pr.bPillar) {
      const zb = rf + (rr - rf) * 0.46;
      sideWindow([[wf(lo), lo], [wf(hi), hi], [zb - 0.05, hi], [zb - 0.05, lo]], side);
      sideWindow([[zb + 0.05, lo], [zb + 0.05, hi], [Math.max(zb + 0.1, wr(hi)), hi], [wr(lo), lo]], side);
    } else {
      sideWindow([[wf(lo), lo], [wf(hi), hi], [wr(hi), hi], [wr(lo), lo]], side);
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
    const y0 = belt + 0.04;
    const y1 = roof - 0.04;
    const out = CABIN_BEVEL * 0.8 + 0.008;
    const z0 = zOn(a, b, y0) + nz * out;
    const z1 = zOn(a, b, y1) + nz * out;
    const x0 = surfaceHalf(y0) - 0.07;
    const x1 = surfaceHalf(y1) - 0.07;
    const q = [
      new THREE.Vector3(-x0, y0 + ny * out, z0),
      new THREE.Vector3(x0, y0 + ny * out, z0),
      new THREE.Vector3(x1, y1 + ny * out, z1),
      new THREE.Vector3(-x1, y1 + ny * out, z1),
    ];
    const geo = new THREE.BufferGeometry().setFromPoints([q[0], q[1], q[2], q[0], q[2], q[3]]);
    geo.computeVertexNormals();
    add(geo, glass);
  };
  screen(windscreen, true);
  screen(rearScreen, false);

  // ---- Wheels, arches and flares ----
  const axles = [at(0.17), at(0.82)];
  const tyreW = 0.24;
  const tyre = new THREE.CylinderGeometry(R, R, tyreW, 18).rotateZ(Math.PI / 2);
  const rimDisc = new THREE.CylinderGeometry(R * 0.68, R * 0.68, 0.02, 18).rotateZ(Math.PI / 2);
  const cap = new THREE.CylinderGeometry(R * 0.14, R * 0.14, 0.03, 8).rotateZ(Math.PI / 2);
  const spoke = new THREE.BoxGeometry(0.02, R * 0.6, 0.055);
  const arch = new THREE.CircleGeometry(R * 1.18, 16, 0, Math.PI);
  for (const z of axles)
    mirrored((side) => {
      const x = side * (W / 2 - 0.1);
      add(tyre, rubber, x, R, z);
      const face = x + side * (tyreW / 2 + 0.006);
      add(rimDisc, trim, face, R, z);
      for (let k = 0; k < 5; k++) {
        const s = add(spoke, silver, face + side * 0.01, R, z);
        const a = (k / 5) * Math.PI * 2;
        s.rotation.x = a;
        s.position.y += Math.cos(a) * R * 0.3;
        s.position.z += Math.sin(a) * R * 0.3;
      }
      add(cap, chrome, face + side * 0.016, R, z);
      // Dark arch opening painted on the body side.
      const archMesh = add(arch, black, side * (W / 2 + 0.004), R, z);
      archMesh.rotation.y = side * (Math.PI / 2);
      if (body.flares) {
        const flare = add(new THREE.TorusGeometry(R * 1.2, 0.06, 4, 14, Math.PI), paintMat, side * (W / 2 + 0.01), R, z);
        flare.rotation.y = Math.PI / 2;
        flare.scale.set(1, 1, 1.6);
      }
    });

  // ---- Front ----
  const lightY = rh + H * 0.52;
  mirrored((side) => {
    const x = side * (W / 2 - 0.3);
    if (body.style === 'sedan') {
      for (const dx of [-0.08, 0.08]) {
        const lamp = add(new THREE.CylinderGeometry(0.065, 0.065, 0.08, 10).rotateX(Math.PI / 2), headlight, x + dx, lightY, nose + 0.04);
        lamp.scale.set(1, 1, 1);
      }
    } else if (body.style === 'coupe') {
      box(0.38, 0.06, 0.1, headlight, x, lightY + 0.04, nose + 0.05);
    } else {
      box(0.34, 0.12, 0.1, headlight, x, lightY, nose + 0.05);
    }
    // Indicators under the lamps.
    box(0.12, 0.04, 0.06, flat('#f2a33a', '#4a2c08'), side * (W / 2 - 0.2), rh + 0.2, nose + 0.02);
  });
  box(W * 0.34, 0.11, 0.08, black, 0, lightY, nose + 0.04); // grille
  box(W * 0.62, 0.07, 0.08, black, 0, rh + 0.1, nose + 0.1); // lower intake
  box(0.5, 0.11, 0.015, plate, 0, rh + 0.24, nose - 0.004);

  // ---- Rear ----
  const tailY = rh + H * 0.64;
  if (body.style === 'sedan') {
    box(W * 0.9, 0.08, 0.06, taillight, 0, tailY, tail - 0.03);
  } else {
    mirrored((side) => box(0.3, 0.1, 0.06, taillight, side * (W / 2 - 0.25), tailY, tail - 0.03));
  }
  box(0.5, 0.11, 0.015, plate, 0, rh + 0.3, tail - 0.012);
  box(W * 0.94, 0.1, 0.1, trim, 0, rh + 0.06, tail - 0.08); // diffuser
  const pipe = new THREE.CylinderGeometry(0.045, 0.045, 0.16, 10).rotateX(Math.PI / 2);
  const pipes = body.exhausts === 2 ? [-0.42, 0.42] : [0.42];
  for (const x of pipes) add(pipe, chrome, x, rh + 0.04, tail - 0.02);

  // ---- Sides ----
  mirrored((side) => {
    const x = side * (W / 2 + 0.003);
    const doorFront = cf - 0.02;
    const doorRear = cf + (cr - cf) * pr.doorRear;
    const doorH = belt - rh - 0.1;
    box(0.008, doorH, 0.012, black, x, rh + 0.07 + doorH / 2, doorFront);
    box(0.008, doorH, 0.012, black, x, rh + 0.07 + doorH / 2, doorRear);
    box(0.012, 0.03, 0.12, trim, x, belt - 0.13, doorRear - 0.14); // handle
    // Side skirt between the arches.
    const zs = axles[0] + R * 1.2;
    const ze = axles[1] - R * 1.2;
    box(0.05, 0.08, ze - zs, trim, side * (W / 2 - 0.01), rh + 0.03, (zs + ze) / 2);
    // Mirror on a short arm.
    const mz = cf + 0.14;
    box(0.08, 0.03, 0.05, trim, side * (surfaceHalf(belt) + 0.03), belt + 0.06, mz);
    box(0.06, 0.09, 0.15, paintMat, side * (surfaceHalf(belt) + 0.1), belt + 0.08, mz);
  });

  // ---- Spoilers ----
  if (body.spoiler === 'roof') {
    const s = box(W * 0.78, 0.03, 0.24, paintMat, 0, roof - 0.01, rr + 0.08);
    s.rotation.x = 0.12;
  } else if (body.spoiler === 'ducktail') {
    const s = box(W * 0.86, 0.05, 0.2, paintMat, 0, deckEnd + 0.04, f - 0.14);
    s.rotation.x = 0.28;
  } else if (body.spoiler === 'wing') {
    const wz = f - 0.2;
    mirrored((side) => box(0.03, 0.16, 0.1, trim, side * 0.5, deckEnd + 0.08, wz));
    box(W * 0.94, 0.03, 0.26, paintMat, 0, deckEnd + 0.17, wz).rotation.x = -0.06;
    mirrored((side) => box(0.02, 0.1, 0.3, trim, side * (W * 0.47), deckEnd + 0.17, wz));
  }

  return { group: g, paintMat };
}
