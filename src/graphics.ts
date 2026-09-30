// Rendering: tone mapping, sun shadows that follow the car, image-based lighting from
// the sky, and (on higher settings) a light post-processing chain. The look stays
// low-poly and flat-shaded; this just lights it better.

import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import type { GraphicsQuality, RetroLook } from './game/progress';

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

/**
 * The last touch on the normal picture: a gentle contrast curve and vignette, plus
 * speed: the edges smear towards the centre and speed lines streak in as you go faster,
 * with an extra kick (punch) on a good shift. With `street` on it also draws the comic
 * look: ink outlines, banded shading, halftone dots in the shadows and punchier colour.
 */
const FxShader = {
  uniforms: {
    tDiffuse: { value: null },
    vignette: { value: 0.22 },
    res: { value: new THREE.Vector2(1280, 720) },
    speed: { value: 0 },
    punch: { value: 0 },
    time: { value: 0 },
    street: { value: 0 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float vignette;
    uniform vec2 res;
    uniform float speed;
    uniform float punch;
    uniform float time;
    uniform int street;
    varying vec2 vUv;
    float hash(float n) { return fract(sin(n * 127.1) * 43758.5453); }
    float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }
    vec3 tap(vec2 uv) { return texture2D(tDiffuse, uv).rgb; }
    void main() {
      vec2 d = vUv - 0.5;
      float r = length(d * vec2(res.x / res.y, 1.0));
      // Speed smear: sample back towards the centre, more at the edges.
      float amt = (speed * 0.03 + punch * 0.03) * smoothstep(0.25, 0.85, r);
      vec3 c = vec3(0.0);
      for (int i = 0; i < 6; i++) c += tap(vUv - d * amt * float(i) / 5.0);
      c /= 6.0;
      if (amt > 0.001) {
        // Colour fringes where the smear is strongest.
        c.r = mix(c.r, tap(vUv + d * amt * 0.4).r, 0.45);
        c.b = mix(c.b, tap(vUv - d * amt * 0.7).b, 0.45);
      }
      if (street == 1) {
        vec2 px = 1.0 / res;
        float tl = luma(tap(vUv + px * vec2(-1.0, 1.0))), t = luma(tap(vUv + px * vec2(0.0, 1.0))), tr = luma(tap(vUv + px * vec2(1.0, 1.0)));
        float l = luma(tap(vUv + px * vec2(-1.0, 0.0))), rr = luma(tap(vUv + px * vec2(1.0, 0.0)));
        float bl = luma(tap(vUv + px * vec2(-1.0, -1.0))), b = luma(tap(vUv + px * vec2(0.0, -1.0))), br = luma(tap(vUv + px * vec2(1.0, -1.0)));
        float gx = tr + 2.0 * rr + br - tl - 2.0 * l - bl;
        float gy = tl + 2.0 * t + tr - bl - 2.0 * b - br;
        float ink = smoothstep(0.16, 0.42, length(vec2(gx, gy)));
        // Punchy colour and banded light.
        float y = luma(c);
        c = clamp(mix(vec3(y), c, 1.45), 0.0, 1.0);
        float band = floor(y * 4.0 + 0.5) / 4.0;
        c *= mix(1.0, (band + 0.08) / (y + 0.08), 0.5);
        // Halftone dots in the shadows, on a 45 degree grid.
        vec2 g = mat2(0.7071, -0.7071, 0.7071, 0.7071) * gl_FragCoord.xy / 5.0;
        float dotR = length(fract(g) - 0.5);
        float shade = smoothstep(0.42, 0.08, y);
        c *= 1.0 - 0.45 * step(dotR, 0.62 * sqrt(shade));
        c = mix(c, vec3(0.06, 0.04, 0.1), ink * 0.9);
      }
      // Speed lines: thin streaks at random angles that start part way in from the edge.
      float lines = speed * 0.45 + punch * 0.6;
      if (lines > 0.01) {
        float ang = atan(d.y, d.x) / 6.2832 + 0.5;
        float slot = floor(ang * 180.0);
        float seed = slot + floor(time * 14.0) * 57.0;
        float on = step(0.86, hash(seed));
        float from = 0.28 + 0.3 * hash(seed + 3.1);
        float across = abs(fract(ang * 180.0) - 0.5);
        float line = on * smoothstep(from, from + 0.15, r) * smoothstep(0.45, 0.1, across);
        c = mix(c, vec3(1.0), clamp(line * lines * 0.4, 0.0, 0.35));
      }
      vec3 s = c * c * (3.0 - 2.0 * c); // smoothstep S-curve
      c = mix(c, s, 0.18);
      c *= 1.0 - (vignette + speed * 0.12) * smoothstep(0.25, 0.85, dot(d, d) * 2.2);
      gl_FragColor = vec4(c, 1.0);
    }`,
};

/** Internal picture height for each 90s look; the result is scaled up to the screen. */
const RETRO_HEIGHT: Partial<Record<RetroLook, number>> = { vhs: 400, console: 232 };

/**
 * The 90s looks, drawn last over the finished picture.
 * vhs: soft, smeared colour, scanlines, tape noise and a wobbly tracking band.
 * console: a chunky low-res picture with 15-bit colour and ordered dithering, like a 32-bit console.
 */
const RetroShader = {
  uniforms: { tDiffuse: { value: null }, mode: { value: 0 }, res: { value: new THREE.Vector2(320, 240) }, time: { value: 0 } },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform int mode;
    uniform vec2 res;
    uniform float time;
    varying vec2 vUv;
    float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    float bayer(vec2 p) {
      // 4x4 ordered dither, -0.5..0.5
      int x = int(mod(p.x, 4.0));
      int y = int(mod(p.y, 4.0));
      int i = x + y * 4;
      float m[16] = float[16](0.,8.,2.,10.,12.,4.,14.,6.,3.,11.,1.,9.,15.,7.,13.,5.);
      for (int k = 0; k < 16; k++) if (k == i) return m[k] / 16.0 - 0.47;
      return 0.0;
    }
    void main() {
      vec2 uv = vUv;
      vec3 c;
      if (mode == 1) {
        // Snap to the low-res pixel grid, then crush to 5 bits a channel with dithering.
        vec2 px = floor(uv * res);
        c = texture2D(tDiffuse, (px + 0.5) / res).rgb;
        c = floor(c * 31.0 + 0.5 + bayer(px)) / 31.0;
        c = mix(vec3(dot(c, vec3(0.3, 0.59, 0.11))), c, 1.08);
      } else {
        float y = uv.y * res.y;
        // A tracking band that rolls slowly up the picture, plus a faint constant wobble.
        float band = smoothstep(0.035, 0.0, abs(fract(uv.y * 0.6 - time * 0.07) - 0.5) - 0.44);
        uv.x += (sin(y * 0.09 + time * 9.0) * 0.0006) + band * (hash(vec2(floor(y), floor(time * 30.0))) - 0.5) * 0.012;
        // Colour smears sideways further than brightness does.
        vec2 o = vec2(1.6 / res.x, 0.0);
        vec3 a = texture2D(tDiffuse, uv).rgb;
        vec3 l = texture2D(tDiffuse, uv - o * 1.5).rgb;
        vec3 r = texture2D(tDiffuse, uv + o * 1.5).rgb;
        c = vec3(texture2D(tDiffuse, uv + o * 2.2).r, (a.g * 2.0 + l.g + r.g) * 0.25, texture2D(tDiffuse, uv - o * 2.2).b);
        c = mix(c, (a + l + r) / 3.0, 0.35);
        // Washed-out tape colour: lifted blacks, softer highlights, a little warm.
        c = mix(vec3(dot(c, vec3(0.3, 0.59, 0.11))), c, 0.82);
        c = c * vec3(1.02, 0.98, 0.92) * 0.9 + vec3(0.045, 0.04, 0.05);
        c *= 0.9 + 0.1 * sin(y * 3.14159);
        c += (hash(uv * res + fract(time) * 91.0) - 0.5) * 0.05;
        c += band * 0.12 * hash(vec2(floor(uv.x * res.x * 0.25), floor(y) + floor(time * 30.0)));
        vec2 d = vUv - 0.5;
        c *= 1.0 - 0.35 * smoothstep(0.2, 0.9, dot(d, d) * 2.4);
      }
      gl_FragColor = vec4(c, 1.0);
    }`,
};

export class Graphics {
  quality: GraphicsQuality = 'high';
  retro: RetroLook = 'off';
  private retroPass: ShaderPass | null = null;
  private fxPass: ShaderPass | null = null;
  /** Speed smear and speed lines (Settings › Speed effects). */
  speedFx = true;
  private speed = 0;
  private punch = 0;
  private composer: EffectComposer | null = null;
  private renderPass: RenderPass | null = null;
  private size = new THREE.Vector2(1, 1);
  private lightRight = new THREE.Vector3();
  private lightUp = new THREE.Vector3();
  private sunDir: THREE.Vector3;

  constructor(
    private renderer: THREE.WebGLRenderer,
    private scene: THREE.Scene,
    private sun: THREE.DirectionalLight,
    /** Direction from the ground towards the sun. */
    sunDir: THREE.Vector3,
  ) {
    this.sunDir = sunDir.clone();
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
    this.setSunDir(sunDir);
  }

  /** The sun (or moon) moved: re-aim the shadows. */
  setSunDir(dir: THREE.Vector3) {
    this.sunDir.copy(dir);
    this.lightRight.crossVectors(new THREE.Vector3(0, 1, 0), this.sunDir).normalize();
    this.lightUp.crossVectors(this.sunDir, this.lightRight).normalize();
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

    this.rebuildComposer();
  }

  /** How fast the car is going (0..1) and a shift kick (0..1), for the speed effects. */
  setMotion(speed: number, punch: number) {
    this.speed = this.speedFx ? speed : 0;
    this.punch = this.speedFx ? punch : 0;
  }

  setSpeedFx(on: boolean) {
    if (on === this.speedFx) return;
    this.speedFx = on;
    this.rebuildComposer();
  }

  /** Switch the look (normal, street, or a 90s filter). */
  setRetro(look: RetroLook) {
    if (look === this.retro) return;
    this.retro = look;
    this.rebuildComposer();
  }

  private rebuildComposer() {
    this.composer?.dispose();
    this.composer = null;
    this.renderPass = null;
    this.retroPass = null;
    this.fxPass = null;
    // Low keeps a plain render unless a look needs the extra passes.
    const wantFx = this.speedFx && this.quality !== 'low';
    if (PRESETS[this.quality].post || this.retro !== 'off' || wantFx) this.buildComposer();
    this.setSize(this.size.x, this.size.y);
  }

  private buildComposer() {
    const retro = this.retro;
    // The console look wants hard, aliased edges, so no multisampling there.
    const target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: retro === 'console' ? 0 : 4 });
    const composer = new EffectComposer(this.renderer, target);
    this.renderPass = new RenderPass(this.scene, new THREE.PerspectiveCamera());
    composer.addPass(this.renderPass);
    // Only things brighter than white bloom: the sun, lamps and reflector glints.
    if (PRESETS[this.quality].post && retro !== 'console') composer.addPass(new UnrealBloomPass(new THREE.Vector2(256, 256), 0.35, 0.5, 1.0));
    composer.addPass(new OutputPass());
    this.fxPass = new ShaderPass(FxShader);
    this.fxPass.uniforms.street.value = retro === 'street' ? 1 : 0;
    composer.addPass(this.fxPass);
    if (retro === 'vhs' || retro === 'console') {
      this.retroPass = new ShaderPass(RetroShader);
      this.retroPass.uniforms.mode.value = retro === 'console' ? 1 : 0;
      composer.addPass(this.retroPass);
    }
    this.composer = composer;
  }

  setSize(w: number, h: number) {
    this.size.set(w, h);
    this.renderer.setSize(w, h);
    if (this.composer) {
      // The 90s looks draw the world at a low resolution and scale it up.
      const retroH = RETRO_HEIGHT[this.retro] ?? 0;
      this.composer.setPixelRatio(retroH ? Math.min(this.renderer.getPixelRatio(), retroH / Math.max(1, h)) : this.renderer.getPixelRatio());
      this.composer.setSize(w, h);
      const pr = this.renderer.getPixelRatio();
      this.fxPass?.uniforms.res.value.set(w * pr, h * pr);
      if (this.retroPass) {
        const k = retroH / Math.max(1, h);
        this.retroPass.uniforms.res.value.set(Math.round(w * k), retroH);
        // Point sampling keeps the console pixels square and crisp when scaled up.
        const filter = this.retro === 'console' ? THREE.NearestFilter : THREE.LinearFilter;
        for (const t of [this.composer.renderTarget1, this.composer.renderTarget2]) t.texture.minFilter = t.texture.magFilter = filter;
      }
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
      const t = performance.now() / 1000;
      if (this.retroPass) this.retroPass.uniforms.time.value = t;
      if (this.fxPass) {
        const u = this.fxPass.uniforms;
        u.time.value = t;
        u.speed.value = this.speed;
        u.punch.value = this.punch;
      }
      this.composer.render();
    } else {
      this.renderer.render(this.scene, camera);
    }
  }
}

let pmrem: THREE.PMREMGenerator | null = null;

/** Bake a sky-and-ground scene into a prefiltered map for reflections and ambient light. */
export function bakeEnvironment(renderer: THREE.WebGLRenderer, envScene: THREE.Scene, previous?: THREE.WebGLRenderTarget | null) {
  pmrem ??= new THREE.PMREMGenerator(renderer);
  previous?.dispose();
  return pmrem.fromScene(envScene, 0, 0.1, 500);
}
