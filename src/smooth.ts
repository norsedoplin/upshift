// Mid-poly shading: smooth normals across gentle angles, crisp edges where surfaces meet
// at a real corner. Turns faceted low-poly models into rounder, softer ones without
// remodelling them.

import * as THREE from 'three';
import { toCreasedNormals } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/**
 * Give every mesh under `root` creased normals (smooth below `angle` degrees, sharp above)
 * and switch its materials off flat shading. Geometry shared between meshes is done once.
 */
export function smoothShade(root: THREE.Object3D, angle = 40) {
  const crease = (angle * Math.PI) / 180;
  const done = new Map<THREE.BufferGeometry, THREE.BufferGeometry>();
  root.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    if (mats.some((m) => m instanceof THREE.ShaderMaterial || m.userData.keepFlat)) return;
    if (o.geometry.userData.smooth) return;
    let geo = done.get(o.geometry);
    if (!geo) {
      geo = toCreasedNormals(o.geometry, crease);
      geo.userData.smooth = true;
      done.set(o.geometry, geo);
      if (geo !== o.geometry) o.geometry.dispose();
    }
    o.geometry = geo;
    for (const m of mats) {
      if ('flatShading' in m && (m as THREE.MeshStandardMaterial).flatShading) {
        (m as THREE.MeshStandardMaterial).flatShading = false;
        m.needsUpdate = true;
      }
    }
  });
}
