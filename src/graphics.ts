// Rendering: tone mapping, sun shadows that follow the car, image-based lighting from
// the sky, and (on higher settings) a light post-processing chain. The look stays
// low-poly and flat-shaded; this just lights it better.

import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import type { GraphicsQuality } from './game/progress';

interface Preset {
  pixelRatio: number; // cap
  shadowMap: number; // 0 = no shadows
  post: boolean; // bloom + vignette, drawn into a multisampled target
}

const PRESETS: Record<GraphicsQuality, Preset> = {
  low: { pixelRatio: 1, shadowMap: 0, post: false },
  medium: { pixelRatio: 1.5, shadowMap: 1024, post: false },
  high: { pixelRatio: 2, shadowMap: 2048, post: true },
};

/** Half-size of the square the sun's shadow covers, centred just ahead of the car, m. */
const SHADOW_EXTENT = 38;

/** Darkens the corners a touch and adds a gentle contrast curve (runs on display colours). */
const GradeShader = {
  uniforms: { tDiffuse: { value: null }, vignette: { value: 0.22 } },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float vignette;
    varying vec2 vUv;
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      vec3 s = c.rgb * c.rgb * (3.0 - 2.0 * c.rgb); // smoothstep S-curve
      c.rgb = mix(c.rgb, s, 0.18);
      vec2 d = vUv - 0.5;
      c.rgb *= 1.0 - vignette * smoothstep(0.25, 0.85, dot(d, d) * 2.2);
      gl_FragColor = c;
    }`,
};

export class Graphics {
  quality: GraphicsQuality = 'high';
  private composer: EffectComposer | null = null;
  private renderPass: RenderPass | null = null;
  private size = new THREE.Vector2(1, 1);
  private lightRight = new THREE.Vector3();
  private lightUp = new THREE.Vector3();

  constructor(
    private renderer: THREE.WebGLRenderer,
    private scene: THREE.Scene,
    private sun: THREE.DirectionalLight,
    /** Direction from the ground towards the sun. */
    private sunDir: THREE.Vector3,
  ) {
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.shadowMap.type = THREE.PCFShadowMap;

    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.04;
    const cam = sun.shadow.camera;
    cam.left = cam.bottom = -SHADOW_EXTENT;
    cam.right = cam.top = SHADOW_EXTENT;
    cam.near = 1;
    cam.far = 400;
    scene.add(sun.target);

    // An orthonormal basis facing along the light, for snapping the shadow to texels.
    this.lightRight.crossVectors(new THREE.Vector3(0, 1, 0), sunDir).normalize();
    this.lightUp.crossVectors(sunDir, this.lightRight).normalize();
  }

  setQuality(q: GraphicsQuality) {
    const p = PRESETS[q];
    const changedShadows = PRESETS[this.quality].shadowMap !== p.shadowMap;
    this.quality = q;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, p.pixelRatio));
    this.renderer.shadowMap.enabled = p.shadowMap > 0;
    this.sun.castShadow = p.shadowMap > 0;
    if (p.shadowMap > 0 && (changedShadows || !this.sun.shadow.map)) {
      this.sun.shadow.mapSize.set(p.shadowMap, p.shadowMap);
      this.sun.shadow.map?.dispose();
      this.sun.shadow.map = null;
    }
    // Materials compile differently with and without shadows.
    this.scene.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        for (const m of mats) m.needsUpdate = true;
      }
    });

    this.composer?.dispose();
    this.composer = null;
    this.renderPass = null;
    if (p.post) this.buildComposer();
    this.setSize(this.size.x, this.size.y);
  }

  private buildComposer() {
    const target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 });
    const composer = new EffectComposer(this.renderer, target);
    this.renderPass = new RenderPass(this.scene, new THREE.PerspectiveCamera());
    composer.addPass(this.renderPass);
    // Only things brighter than white bloom: the sun, lamps and reflector glints.
    composer.addPass(new UnrealBloomPass(new THREE.Vector2(256, 256), 0.35, 0.5, 1.0));
    composer.addPass(new OutputPass());
    composer.addPass(new ShaderPass(GradeShader));
    this.composer = composer;
  }

  setSize(w: number, h: number) {
    this.size.set(w, h);
    this.renderer.setSize(w, h);
    if (this.composer) {
      this.composer.setPixelRatio(this.renderer.getPixelRatio());
      this.composer.setSize(w, h);
    }
  }

  /** Keep the shadow-casting area centred on what the player is looking at. */
  follow(focus: THREE.Vector3) {
    if (!this.sun.castShadow) return;
    // Snap the centre to whole shadow-map texels so edges don't crawl as the car moves.
    const texel = (2 * SHADOW_EXTENT) / this.sun.shadow.mapSize.x;
    const r = Math.round(focus.dot(this.lightRight) / texel) * texel;
    const u = Math.round(focus.dot(this.lightUp) / texel) * texel;
    const f = focus.dot(this.sunDir);
    const c = new THREE.Vector3().addScaledVector(this.lightRight, r).addScaledVector(this.lightUp, u).addScaledVector(this.sunDir, f);
    this.sun.target.position.copy(c);
    this.sun.position.copy(c).addScaledVector(this.sunDir, 200);
    this.sun.target.updateMatrixWorld();
  }

  render(camera: THREE.Camera) {
    if (this.composer && this.renderPass) {
      this.renderPass.camera = camera;
      this.composer.render();
    } else {
      this.renderer.render(this.scene, camera);
    }
  }
}

/** Bake a sky-and-ground scene into a prefiltered map for reflections and ambient light. */
export function bakeEnvironment(renderer: THREE.WebGLRenderer, envScene: THREE.Scene) {
  const pm = new THREE.PMREMGenerator(renderer);
  const tex = pm.fromScene(envScene, 0, 0.1, 500).texture;
  pm.dispose();
  return tex;
}
