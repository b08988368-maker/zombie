import * as THREE from 'three';
import type { WeaponId } from '../config/balance';

export interface PbrMaterialSet {
  concrete: THREE.MeshStandardMaterial;
  wetAsphalt: THREE.MeshStandardMaterial;
  rustedMetal: THREE.MeshStandardMaterial;
  brushedSteel: THREE.MeshStandardMaterial;
  barnWood: THREE.MeshStandardMaterial;
  timberBeam: THREE.MeshStandardMaterial;
  hayStraw: THREE.MeshStandardMaterial;
  plasterWall: THREE.MeshStandardMaterial;
  labTile: THREE.MeshStandardMaterial;
  soil: THREE.MeshStandardMaterial;
  warningStripe: THREE.MeshStandardMaterial;
  darkTrim: THREE.MeshStandardMaterial;
  gunMetal: THREE.MeshStandardMaterial;
  gunPolymer: THREE.MeshStandardMaterial;
  gunWood: THREE.MeshStandardMaterial;
  zombieSkins: THREE.MeshStandardMaterial[];
  zombieCloths: THREE.MeshStandardMaterial[];
  zombiePants: THREE.MeshStandardMaterial;
  zombieBlood: THREE.MeshStandardMaterial;
  skyDomeTex: THREE.CanvasTexture;
  muzzleFlashTex: THREE.CanvasTexture;
  bulletHoleTex: THREE.CanvasTexture;
  bloodSplatterTex: THREE.CanvasTexture;
  scorchDecalTex: THREE.CanvasTexture;
}

function hash2d(x: number, y: number, seed: number): number {
  const n = Math.sin(x * 127.1 + y * 311.7 + seed * 74.7) * 43758.5453123;
  return n - Math.floor(n);
}

function valueNoise(x: number, y: number, seed: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  const a = hash2d(ix, iy, seed);
  const b = hash2d(ix + 1, iy, seed);
  const c = hash2d(ix, iy + 1, seed);
  const d = hash2d(ix + 1, iy + 1, seed);
  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
}

function fbm(x: number, y: number, seed: number, octaves = 4): number {
  let v = 0;
  let amp = 0.5;
  let freq = 1;
  for (let i = 0; i < octaves; i++) {
    v += amp * valueNoise(x * freq, y * freq, seed + i * 19);
    freq *= 2;
    amp *= 0.5;
  }
  return v;
}

function generateTextureSet(
  size: number,
  maxAniso: number,
  repeatX: number,
  repeatY: number,
  normalStrength: number,
  painter: (
    u: number,
    v: number,
    x: number,
    y: number,
  ) => { r: number; g: number; b: number; h: number; rough: number },
): {
  map: THREE.DataTexture;
  normalMap: THREE.DataTexture;
  roughnessMap: THREE.DataTexture;
} {
  const albedo = new Uint8Array(size * size * 4);
  const heights = new Float32Array(size * size);
  const rough = new Uint8Array(size * size * 4);
  const normal = new Uint8Array(size * size * 4);

  for (let y = 0; y < size; y++) {
    const v = y / size;
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const idx = y * size + x;
      const p = painter(u, v, x, y);
      const o = idx * 4;
      albedo[o] = Math.max(0, Math.min(255, Math.round(p.r)));
      albedo[o + 1] = Math.max(0, Math.min(255, Math.round(p.g)));
      albedo[o + 2] = Math.max(0, Math.min(255, Math.round(p.b)));
      albedo[o + 3] = 255;

      heights[idx] = p.h;

      const rg = Math.max(18, Math.min(250, Math.round(p.rough * 255)));
      rough[o] = rg;
      rough[o + 1] = rg;
      rough[o + 2] = rg;
      rough[o + 3] = 255;
    }
  }

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const xm = (x - 1 + size) % size;
      const xp = (x + 1) % size;
      const ym = (y - 1 + size) % size;
      const yp = (y + 1) % size;
      const dx = (heights[y * size + xp]! - heights[y * size + xm]!) * normalStrength;
      const dy = (heights[yp * size + x]! - heights[ym * size + x]!) * normalStrength;
      const len = Math.hypot(-dx, -dy, 1);
      const nx = ((-dx / len) * 0.5 + 0.5) * 255;
      const ny = ((-dy / len) * 0.5 + 0.5) * 255;
      const nz = ((1 / len) * 0.5 + 0.5) * 255;
      const o = (y * size + x) * 4;
      normal[o] = Math.round(nx);
      normal[o + 1] = Math.round(ny);
      normal[o + 2] = Math.round(nz);
      normal[o + 3] = 255;
    }
  }

  const map = new THREE.DataTexture(albedo, size, size, THREE.RGBAFormat);
  map.colorSpace = THREE.SRGBColorSpace;
  map.wrapS = THREE.RepeatWrapping;
  map.wrapT = THREE.RepeatWrapping;
  map.repeat.set(repeatX, repeatY);
  map.anisotropy = maxAniso;
  map.generateMipmaps = true;
  map.minFilter = THREE.LinearMipmapLinearFilter;
  map.needsUpdate = true;

  const normalMap = new THREE.DataTexture(normal, size, size, THREE.RGBAFormat);
  normalMap.colorSpace = THREE.NoColorSpace;
  normalMap.wrapS = THREE.RepeatWrapping;
  normalMap.wrapT = THREE.RepeatWrapping;
  normalMap.repeat.set(repeatX, repeatY);
  normalMap.anisotropy = maxAniso;
  normalMap.generateMipmaps = true;
  normalMap.minFilter = THREE.LinearMipmapLinearFilter;
  normalMap.needsUpdate = true;

  const roughnessMap = new THREE.DataTexture(rough, size, size, THREE.RGBAFormat);
  roughnessMap.colorSpace = THREE.NoColorSpace;
  roughnessMap.wrapS = THREE.RepeatWrapping;
  roughnessMap.wrapT = THREE.RepeatWrapping;
  roughnessMap.repeat.set(repeatX, repeatY);
  roughnessMap.anisotropy = maxAniso;
  roughnessMap.generateMipmaps = true;
  roughnessMap.minFilter = THREE.LinearMipmapLinearFilter;
  roughnessMap.needsUpdate = true;

  return { map, normalMap, roughnessMap };
}

function applyMacroWorldVariation(mat: THREE.MeshStandardMaterial, scale = 0.08): void {
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
         varying vec3 vWorldPosMacro;`,
      )
      .replace(
        '#include <worldpos_vertex>',
        `#include <worldpos_vertex>
         vec4 macroWp = vec4(transformed, 1.0);
         #ifdef USE_INSTANCING
           macroWp = instanceMatrix * macroWp;
         #endif
         macroWp = modelMatrix * macroWp;
         vWorldPosMacro = macroWp.xyz;`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
         varying vec3 vWorldPosMacro;`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
         float mA = sin(vWorldPosMacro.x * ${scale.toFixed(3)} + vWorldPosMacro.z * ${(scale * 0.7).toFixed(3)});
         float mB = cos(vWorldPosMacro.z * ${(scale * 1.3).toFixed(3)} - vWorldPosMacro.x * ${(scale * 0.5).toFixed(3)});
         float dampGround = clamp((1.5 - vWorldPosMacro.y) * 0.16, 0.0, 0.22);
         float macroVar = (0.88 + 0.14 * (mA * 0.5 + mB * 0.5)) * (1.0 - dampGround);
         diffuseColor.rgb *= macroVar;`,
      );
  };
  mat.customProgramCacheKey = () => `macro_var_${scale}`;
}

export function createSkyDomeTexture(): THREE.CanvasTexture {
  const w = 1024;
  const h = 512;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;

  // Cold night sky gradient matching scene.fog (#070a09) at the horizon
  const skyGrad = ctx.createLinearGradient(0, 0, 0, h);
  skyGrad.addColorStop(0.0, '#040810');
  skyGrad.addColorStop(0.28, '#09131c');
  skyGrad.addColorStop(0.46, '#0d191e');
  skyGrad.addColorStop(0.54, '#09100f');
  skyGrad.addColorStop(0.66, '#070a09');
  skyGrad.addColorStop(1.0, '#070a09');
  ctx.fillStyle = skyGrad;
  ctx.fillRect(0, 0, w, h);

  // Subtle cold starfield in upper hemisphere
  for (let i = 0; i < 420; i++) {
    const sx = hash2d(i, 1, 99) * w;
    const sy = hash2d(i, 2, 77) * (h * 0.44);
    const bright = 0.25 + hash2d(i, 3, 55) * 0.65;
    const rad = hash2d(i, 4, 33) > 0.88 ? 1.4 : 0.8;
    ctx.fillStyle = `rgba(210, 228, 250, ${bright.toFixed(2)})`;
    ctx.beginPath();
    ctx.arc(sx, sy, rad, 0, Math.PI * 2);
    ctx.fill();
  }

  // Atmospheric clouds & valley mist bands
  for (let i = 0; i < 65; i++) {
    const cx = hash2d(i, 5, 19) * w;
    const cy = h * (0.14 + hash2d(i, 6, 23) * 0.34);
    const rx = 55 + hash2d(i, 7, 29) * 110;
    const ry = 10 + hash2d(i, 8, 31) * 20;
    const alpha = 0.03 + hash2d(i, 9, 37) * 0.05;
    const cg = ctx.createRadialGradient(cx, cy, 4, cx, cy, rx);
    cg.addColorStop(0, `rgba(115, 148, 175, ${alpha})`);
    cg.addColorStop(1, 'rgba(10, 18, 22, 0)');
    ctx.fillStyle = cg;
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  // Pale cold moon & soft atmospheric halo
  const moonX = w * 0.72;
  const moonY = h * 0.22;
  const halo = ctx.createRadialGradient(moonX, moonY, 8, moonX, moonY, 130);
  halo.addColorStop(0, 'rgba(218, 234, 255, 0.55)');
  halo.addColorStop(0.18, 'rgba(140, 175, 215, 0.22)');
  halo.addColorStop(0.55, 'rgba(55, 80, 105, 0.06)');
  halo.addColorStop(1, 'rgba(9, 16, 20, 0)');
  ctx.fillStyle = halo;
  ctx.beginPath();
  ctx.arc(moonX, moonY, 130, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = '#e8f1ff';
  ctx.beginPath();
  ctx.arc(moonX, moonY, 15, 0, Math.PI * 2);
  ctx.fill();

  // Distant mountain ridge silhouettes near horizon
  ctx.fillStyle = '#060a09';
  ctx.beginPath();
  ctx.moveTo(0, h * 0.54);
  for (let x = 0; x <= w; x += 16) {
    const ridge =
      Math.sin((x / w) * Math.PI * 4) * 12 +
      Math.cos((x / w) * Math.PI * 10 + 1.1) * 7 +
      fbm((x / w) * 8, 2.5, 404, 3) * 14;
    ctx.lineTo(x, h * 0.515 - ridge);
  }
  ctx.lineTo(w, h);
  ctx.lineTo(0, h);
  ctx.closePath();
  ctx.fill();

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  return tex;
}

export function createPbrMaterialSet(renderer: THREE.WebGLRenderer): PbrMaterialSet {
  const maxAniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  const texSize = 384;
  const bioTexSize = 256;

  // 1. Poured concrete slabs with cracks, expansion joints, and damp staining
  const conc = generateTextureSet(texSize, maxAniso, 1, 1, 2.4, (u, v) => {
    const n = fbm(u * 12, v * 12, 11, 4);
    const fine = valueNoise(u * 64, v * 64, 23);
    const crackN = Math.abs(fbm(u * 7.5 + 3.2, v * 7.5 - 1.4, 17, 3) - 0.5);
    const crack = crackN < 0.018 ? 0.58 : 1.0;
    const sx = Math.abs(((u * 2) % 1) - 0.5);
    const sy = Math.abs(((v * 2) % 1) - 0.5);
    const seam = sx < 0.01 || sy < 0.01 ? 0.62 : 1.0;
    const damp = n < 0.34 ? 0.84 : 1.0;
    const base = (82 + n * 38 + fine * 14) * seam * crack * damp;
    return {
      r: base,
      g: base * 0.99,
      b: base * 0.95,
      h: n * 0.55 + fine * 0.22 - (1 - seam) * 0.45 - (1 - crack) * 0.4,
      rough: n < 0.34 ? 0.42 : 0.76 + n * 0.18,
    };
  });
  const concrete = new THREE.MeshStandardMaterial({
    map: conc.map,
    normalMap: conc.normalMap,
    normalScale: new THREE.Vector2(0.95, 0.95),
    roughnessMap: conc.roughnessMap,
    roughness: 0.86,
    metalness: 0.05,
  });
  applyMacroWorldVariation(concrete, 0.14);

  // 2. Wet cracked asphalt with aggregate grit and rainwater puddles
  const asp = generateTextureSet(texSize, maxAniso, 1, 1, 2.2, (u, v) => {
    const n = fbm(u * 10, v * 10, 31, 4);
    const grit = valueNoise(u * 88, v * 88, 41);
    const crack = Math.abs(fbm(u * 6, v * 6, 47, 3) - 0.5) < 0.015 ? 0.55 : 1.0;
    const isPuddle = n < 0.36;
    const puddleRough = isPuddle ? 0.14 : 0.78 + grit * 0.12;
    const base = (36 + n * 22 + grit * 14) * (isPuddle ? 0.76 : 1.0) * crack;
    return {
      r: base * 0.95,
      g: base,
      b: base * 1.07,
      h: (isPuddle ? 0.18 : grit * 0.38 + n * 0.35) * crack,
      rough: puddleRough,
    };
  });
  const wetAsphalt = new THREE.MeshStandardMaterial({
    map: asp.map,
    normalMap: asp.normalMap,
    normalScale: new THREE.Vector2(0.85, 0.85),
    roughnessMap: asp.roughnessMap,
    roughness: 0.72,
    metalness: 0.12,
  });
  applyMacroWorldVariation(wetAsphalt, 0.09);

  // 3. Rusted corrugated sheet metal with rivets & oxide streaks
  const met = generateTextureSet(texSize, maxAniso, 1, 1, 3.0, (u, v) => {
    const rib = Math.sin(u * Math.PI * 20) * 0.5 + 0.5;
    const rustNoise = fbm(u * 12, v * 7, 53, 4);
    const streak = fbm(u * 26, v * 3.5, 61, 3);
    const rustRaw = rustNoise * 0.65 + streak * 0.35;
    const rust = rustRaw > 0.48 ? Math.min(1, (rustRaw - 0.48) * 2.4) : 0;
    const steel = 74 + rib * 28;
    const r = steel * (1 - rust) + 124 * rust;
    const g = steel * (1 - rust) + 58 * rust;
    const b = steel * 1.06 * (1 - rust) + 32 * rust;
    return { r, g, b, h: rib * 0.65 + rustNoise * 0.3, rough: 0.32 + rust * 0.58 };
  });
  const rustedMetal = new THREE.MeshStandardMaterial({
    map: met.map,
    normalMap: met.normalMap,
    normalScale: new THREE.Vector2(1.15, 1.15),
    roughnessMap: met.roughnessMap,
    roughness: 0.64,
    metalness: 0.7,
  });

  // 4. Brushed riveted industrial steel (for bunker bulkheads, frames, machinery)
  const bsteel = generateTextureSet(texSize, maxAniso, 1, 1, 2.0, (u, v) => {
    const brush = valueNoise(u * 18, v * 120, 67);
    const grime = fbm(u * 10, v * 10, 69, 3);
    const px = ((u * 3) % 1);
    const py = ((v * 3) % 1);
    const edge = px < 0.03 || py < 0.03 ? 0.65 : 1.0;
    const rivetDist = Math.hypot((px - 0.12), (py - 0.12));
    const rivet = rivetDist < 0.035 ? 1.18 : 1.0;
    const base = (66 + brush * 18 + grime * 14) * edge * rivet;
    return {
      r: base * 0.96,
      g: base,
      b: base * 1.04,
      h: brush * 0.18 + (rivet > 1 ? 0.45 : 0) - (1 - edge) * 0.4,
      rough: 0.34 + grime * 0.32,
    };
  });
  const brushedSteel = new THREE.MeshStandardMaterial({
    map: bsteel.map,
    normalMap: bsteel.normalMap,
    normalScale: new THREE.Vector2(0.85, 0.85),
    roughnessMap: bsteel.roughnessMap,
    roughness: 0.48,
    metalness: 0.78,
  });

  // 5. Weathered barn wood planks with grain, knots & nail heads
  const wd = generateTextureSet(texSize, maxAniso, 1, 1, 2.6, (u, v) => {
    const plank = Math.floor(v * 6);
    const pv = (v * 6) % 1;
    const seam = pv < 0.045 ? 0.36 : 1.0;
    const uShift = u + hash2d(plank, 3, 19);
    const grain = fbm(uShift * 5, pv * 18 + plank * 3.1, 71, 4);
    const nail = (Math.abs((uShift % 0.5) - 0.05) < 0.012 && Math.abs(pv - 0.5) < 0.07) ? 0.48 : 1.0;
    const tint = 0.82 + hash2d(plank, 1, 7) * 0.34;
    const r = (92 + grain * 44) * tint * seam * nail;
    const g = (66 + grain * 32) * tint * seam * nail;
    const b = (44 + grain * 20) * tint * seam * nail;
    return { r, g, b, h: grain * 0.55 - (1 - seam) * 0.55, rough: 0.76 + grain * 0.18 };
  });
  const barnWood = new THREE.MeshStandardMaterial({
    map: wd.map,
    normalMap: wd.normalMap,
    normalScale: new THREE.Vector2(1.05, 1.05),
    roughnessMap: wd.roughnessMap,
    roughness: 0.85,
    metalness: 0.04,
  });

  // 6. Dark structural timber beam
  const tmb = generateTextureSet(256, maxAniso, 1, 1, 2.4, (u, v) => {
    const grain = fbm(u * 4, v * 32, 83, 4);
    const knot = valueNoise(u * 12, v * 12, 87);
    const r = 56 + grain * 28 + knot * 10;
    const g = 40 + grain * 20 + knot * 8;
    const b = 28 + grain * 14;
    return { r, g, b, h: grain * 0.6, rough: 0.82 + grain * 0.14 };
  });
  const timberBeam = new THREE.MeshStandardMaterial({
    map: tmb.map,
    normalMap: tmb.normalMap,
    normalScale: new THREE.Vector2(0.95, 0.95),
    roughnessMap: tmb.roughnessMap,
    roughness: 0.86,
    metalness: 0.04,
  });

  // 7. Golden woven hay/straw bales
  const hay = generateTextureSet(256, maxAniso, 1, 1, 2.8, (u, v) => {
    const stalkA = valueNoise(u * 48, v * 8, 101);
    const stalkB = valueNoise(u * 12, v * 44, 103);
    const twine = Math.abs(u - 0.25) < 0.025 || Math.abs(u - 0.75) < 0.025 ? 0.55 : 1.0;
    const s = stalkA * 0.55 + stalkB * 0.45;
    const r = (145 + s * 62) * twine;
    const g = (118 + s * 48) * twine;
    const b = (56 + s * 24) * twine;
    return { r, g, b, h: s * 0.8, rough: 0.94 };
  });
  const hayStraw = new THREE.MeshStandardMaterial({
    map: hay.map,
    normalMap: hay.normalMap,
    normalScale: new THREE.Vector2(1.15, 1.15),
    roughnessMap: hay.roughnessMap,
    roughness: 0.95,
    metalness: 0.02,
  });

  // 8. Farmhouse aged peeling plaster with lath & damp
  const pl = generateTextureSet(texSize, maxAniso, 1, 1, 2.2, (u, v) => {
    const n = fbm(u * 8, v * 8, 91, 4);
    const fine = valueNoise(u * 48, v * 48, 93);
    const mold = fbm(u * 14, v * 14, 97, 3);
    const peel = n < 0.28;
    const damp = mold > 0.6 ? 0.72 : 1.0;
    const r = (peel ? 88 : 138 + n * 28 + fine * 10) * damp;
    const g = (peel ? 72 : 134 + n * 26 + fine * 10) * (damp + 0.03);
    const b = (peel ? 56 : 116 + n * 22 + fine * 8) * damp;
    return { r, g, b, h: (peel ? 0.15 : 0.65) + n * 0.25, rough: 0.89 };
  });
  const plasterWall = new THREE.MeshStandardMaterial({
    map: pl.map,
    normalMap: pl.normalMap,
    normalScale: new THREE.Vector2(0.75, 0.75),
    roughnessMap: pl.roughnessMap,
    roughness: 0.9,
    metalness: 0.02,
  });
  applyMacroWorldVariation(plasterWall, 0.18);

  // 9. Lab Wing ceramic tiles with clean bevels & stained grout
  const lt = generateTextureSet(texSize, maxAniso, 1, 1, 2.5, (u, v) => {
    const gx = (u * 4) % 1;
    const gy = (v * 4) % 1;
    const grout = gx < 0.045 || gy < 0.045;
    const grime = fbm(u * 10, v * 10, 113, 3);
    if (grout) {
      return { r: 52, g: 58, b: 56, h: 0.08, rough: 0.92 };
    }
    const bevel = Math.min(gx, 1 - gx, gy, 1 - gy) < 0.09 ? 0.94 : 1.0;
    const base = (156 + grime * 26) * bevel;
    return {
      r: base * 0.9,
      g: base * 0.98,
      b: base * 0.93,
      h: (bevel < 1 ? 0.55 : 0.78) + grime * 0.08,
      rough: 0.24 + grime * 0.22,
    };
  });
  const labTile = new THREE.MeshStandardMaterial({
    map: lt.map,
    normalMap: lt.normalMap,
    normalScale: new THREE.Vector2(0.85, 0.85),
    roughnessMap: lt.roughnessMap,
    roughness: 0.4,
    metalness: 0.08,
  });

  // 10. Valley soil / damp moss & grass
  const sl = generateTextureSet(texSize, maxAniso, 1, 1, 2.6, (u, v) => {
    const n = fbm(u * 12, v * 12, 131, 4);
    const grass = fbm(u * 28, v * 28, 139, 3);
    const pebbles = valueNoise(u * 64, v * 64, 143);
    const r = 38 + n * 24 + grass * 12 + pebbles * 6;
    const g = 44 + n * 26 + grass * 22 + pebbles * 4;
    const b = 30 + n * 15;
    return { r, g, b, h: n * 0.65 + pebbles * 0.25, rough: 0.93 };
  });
  const soil = new THREE.MeshStandardMaterial({
    map: sl.map,
    normalMap: sl.normalMap,
    normalScale: new THREE.Vector2(1.0, 1.0),
    roughnessMap: sl.roughnessMap,
    roughness: 0.94,
    metalness: 0.02,
  });
  applyMacroWorldVariation(soil, 0.07);

  // 11. Hazard chevron warning stripe
  const wrn = generateTextureSet(texSize, maxAniso, 1, 1, 2.0, (u, v) => {
    const stripe = ((u * 4 + v * 4) % 1) < 0.5;
    const wear = fbm(u * 16, v * 16, 151, 3);
    const scratch = wear > 0.65 ? 0.52 : 1.0;
    if (stripe) {
      return { r: 198 * scratch, g: 148 * scratch, b: 32 * scratch, h: 0.5 + wear * 0.2, rough: 0.44 + (1 - scratch) * 0.3 };
    }
    return { r: 26, g: 28, b: 29, h: 0.45 + wear * 0.2, rough: 0.56 };
  });
  const warningStripe = new THREE.MeshStandardMaterial({
    map: wrn.map,
    normalMap: wrn.normalMap,
    roughnessMap: wrn.roughnessMap,
    roughness: 0.54,
    metalness: 0.38,
  });

  const darkTrim = new THREE.MeshStandardMaterial({
    color: 0x222625,
    roughness: 0.52,
    metalness: 0.68,
  });

  const gunMetal = new THREE.MeshStandardMaterial({
    map: bsteel.map,
    normalMap: bsteel.normalMap,
    color: 0x5c646d,
    roughness: 0.32,
    metalness: 0.88,
  });

  const gunPolymer = new THREE.MeshStandardMaterial({
    color: 0x1b1d20,
    roughness: 0.66,
    metalness: 0.14,
  });

  const gunWood = new THREE.MeshStandardMaterial({
    map: wd.map,
    normalMap: wd.normalMap,
    color: 0x8f5939,
    roughness: 0.52,
    metalness: 0.06,
  });

  // 12. Procedural Infected Skin & Torn Cloth PBR materials (3 skin tones, 6 cloth outfits)
  const skinTints = [
    [118, 128, 108],
    [104, 114, 102],
    [128, 116, 104],
  ] as const;
  const zombieSkins = skinTints.map(([sr, sg, sb], idx) => {
    const tex = generateTextureSet(bioTexSize, maxAniso, 1, 1, 2.4, (u, v) => {
      const mottle = fbm(u * 10, v * 10, 200 + idx * 17, 4);
      const veins = Math.abs(fbm(u * 18, v * 18, 250 + idx, 3) - 0.5) < 0.03 ? 0.72 : 1.0;
      const wound = mottle > 0.68 ? (mottle - 0.68) * 3.0 : 0;
      const r = (sr * (0.78 + mottle * 0.4) * (1 - wound) + 115 * wound) * veins;
      const g = (sg * (0.78 + mottle * 0.4) * (1 - wound) + 22 * wound) * veins;
      const b = (sb * (0.78 + mottle * 0.4) * (1 - wound) + 22 * wound) * veins;
      return { r, g, b, h: mottle * 0.6 - wound * 0.3, rough: 0.72 - wound * 0.42 };
    });
    return new THREE.MeshStandardMaterial({
      map: tex.map,
      normalMap: tex.normalMap,
      normalScale: new THREE.Vector2(0.9, 0.9),
      roughnessMap: tex.roughnessMap,
      roughness: 0.72,
      metalness: 0.06,
    });
  });

  const clothPalettes: [number, number, number, 'plaid' | 'lab' | 'overalls' | 'solid'][] = [
    [56, 78, 62, 'overalls'],
    [168, 174, 166, 'lab'],
    [118, 52, 46, 'plaid'],
    [62, 74, 88, 'solid'],
    [88, 70, 52, 'plaid'],
    [52, 54, 66, 'overalls'],
  ];
  const zombieCloths = clothPalettes.map(([cr, cg, cb, style], idx) => {
    const tex = generateTextureSet(bioTexSize, maxAniso, 1, 1, 2.0, (u, v) => {
      const weave = (valueNoise(u * 64, v * 64, 300 + idx) - 0.5) * 18;
      const dirt = fbm(u * 8, v * 8, 340 + idx * 11, 3);
      const bloodMask = fbm(u * 6 + 1.2, v * 6, 390 + idx * 7, 3) > 0.64;
      let pat = 1.0;
      if (style === 'plaid') {
        const px = ((u * 5) % 1) < 0.16;
        const py = ((v * 5) % 1) < 0.16;
        if (px || py) pat = 0.68;
      } else if (style === 'overalls') {
        if (Math.abs(u - 0.3) < 0.07 || Math.abs(u - 0.7) < 0.07) pat = 0.8;
      } else if (style === 'lab') {
        if (Math.abs(u - 0.5) < 0.02) pat = 0.75;
      }
      const stain = dirt > 0.55 ? 0.74 : 1.0;
      const r = bloodMask ? 95 : (cr * pat + weave) * stain;
      const g = bloodMask ? 16 : (cg * pat + weave) * stain;
      const b = bloodMask ? 16 : (cb * pat + weave) * stain;
      return { r, g, b, h: weave * 0.015 + dirt * 0.35, rough: bloodMask ? 0.34 : 0.88 };
    });
    return new THREE.MeshStandardMaterial({
      map: tex.map,
      normalMap: tex.normalMap,
      normalScale: new THREE.Vector2(0.8, 0.8),
      roughnessMap: tex.roughnessMap,
      roughness: 0.86,
      metalness: 0.05,
    });
  });

  const zombiePantsTex = generateTextureSet(bioTexSize, maxAniso, 1, 1, 1.8, (u, v) => {
    const weave = valueNoise(u * 56, v * 56, 421);
    const mud = fbm(u * 8, v * 8, 433, 3);
    const r = 42 + weave * 14 + mud * 16;
    const g = 45 + weave * 14 + mud * 12;
    const b = 52 + weave * 14;
    return { r, g, b, h: weave * 0.3 + mud * 0.3, rough: 0.88 };
  });
  const zombiePants = new THREE.MeshStandardMaterial({
    map: zombiePantsTex.map,
    normalMap: zombiePantsTex.normalMap,
    roughness: 0.88,
    metalness: 0.04,
  });

  const zombieBlood = new THREE.MeshStandardMaterial({
    color: 0x5c0c0c,
    roughness: 0.28,
    metalness: 0.08,
  });

  const skyDomeTex = createSkyDomeTexture();

  // Procedural muzzle flash sprite texture
  const mfCanvas = document.createElement('canvas');
  mfCanvas.width = 128;
  mfCanvas.height = 128;
  const mfCtx = mfCanvas.getContext('2d')!;
  const grad = mfCtx.createRadialGradient(64, 64, 2, 64, 64, 60);
  grad.addColorStop(0, 'rgba(255,255,235,1)');
  grad.addColorStop(0.28, 'rgba(255,195,90,0.9)');
  grad.addColorStop(0.65, 'rgba(255,110,30,0.35)');
  grad.addColorStop(1, 'rgba(255,60,0,0)');
  mfCtx.fillStyle = grad;
  mfCtx.fillRect(0, 0, 128, 128);
  const muzzleFlashTex = new THREE.CanvasTexture(mfCanvas);
  muzzleFlashTex.colorSpace = THREE.SRGBColorSpace;

  // Bullet hole decal texture
  const bhCanvas = document.createElement('canvas');
  bhCanvas.width = 64;
  bhCanvas.height = 64;
  const bhCtx = bhCanvas.getContext('2d')!;
  const bhGrad = bhCtx.createRadialGradient(32, 32, 3, 32, 32, 26);
  bhGrad.addColorStop(0, 'rgba(10,10,10,0.95)');
  bhGrad.addColorStop(0.35, 'rgba(35,32,28,0.8)');
  bhGrad.addColorStop(0.7, 'rgba(65,60,55,0.28)');
  bhGrad.addColorStop(1, 'rgba(0,0,0,0)');
  bhCtx.fillStyle = bhGrad;
  bhCtx.fillRect(0, 0, 64, 64);
  const bulletHoleTex = new THREE.CanvasTexture(bhCanvas);
  bulletHoleTex.colorSpace = THREE.SRGBColorSpace;

  // Blood splatter decal texture
  const blCanvas = document.createElement('canvas');
  blCanvas.width = 128;
  blCanvas.height = 128;
  const blCtx = blCanvas.getContext('2d')!;
  for (let i = 0; i < 16; i++) {
    const angle = (i / 16) * Math.PI * 2 + (i % 3) * 0.4;
    const dist = i === 0 ? 0 : 12 + (i % 5) * 9;
    const rad = i === 0 ? 24 : 5 + (i % 4) * 4;
    const cx = 64 + Math.cos(angle) * dist;
    const cy = 64 + Math.sin(angle) * dist;
    const bg = blCtx.createRadialGradient(cx, cy, 1, cx, cy, rad);
    bg.addColorStop(0, 'rgba(95,8,8,0.92)');
    bg.addColorStop(0.7, 'rgba(68,6,6,0.65)');
    bg.addColorStop(1, 'rgba(40,4,4,0)');
    blCtx.fillStyle = bg;
    blCtx.beginPath();
    blCtx.arc(cx, cy, rad, 0, Math.PI * 2);
    blCtx.fill();
  }
  const bloodSplatterTex = new THREE.CanvasTexture(blCanvas);
  bloodSplatterTex.colorSpace = THREE.SRGBColorSpace;

  // Explosion scorch decal texture
  const scCanvas = document.createElement('canvas');
  scCanvas.width = 128;
  scCanvas.height = 128;
  const scCtx = scCanvas.getContext('2d')!;
  const scGrad = scCtx.createRadialGradient(64, 64, 6, 64, 64, 60);
  scGrad.addColorStop(0, 'rgba(12,10,9,0.92)');
  scGrad.addColorStop(0.45, 'rgba(28,24,20,0.68)');
  scGrad.addColorStop(0.8, 'rgba(40,34,28,0.2)');
  scGrad.addColorStop(1, 'rgba(0,0,0,0)');
  scCtx.fillStyle = scGrad;
  scCtx.fillRect(0, 0, 128, 128);
  const scorchDecalTex = new THREE.CanvasTexture(scCanvas);
  scorchDecalTex.colorSpace = THREE.SRGBColorSpace;

  return {
    concrete,
    wetAsphalt,
    rustedMetal,
    brushedSteel,
    barnWood,
    timberBeam,
    hayStraw,
    plasterWall,
    labTile,
    soil,
    warningStripe,
    darkTrim,
    gunMetal,
    gunPolymer,
    gunWood,
    zombieSkins,
    zombieCloths,
    zombiePants,
    zombieBlood,
    skyDomeTex,
    muzzleFlashTex,
    bulletHoleTex,
    bloodSplatterTex,
    scorchDecalTex,
  };
}

export function createWallBuyChalkTexture(
  weaponId: WeaponId,
  label: string,
  price: number,
): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 256;
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, 512, 256);

  // Chalk outline frame
  ctx.strokeStyle = 'rgba(236, 232, 218, 0.85)';
  ctx.lineWidth = 4;
  ctx.setLineDash([12, 6]);
  ctx.strokeRect(18, 18, 476, 220);

  ctx.setLineDash([]);
  ctx.fillStyle = 'rgba(236, 232, 218, 0.1)';
  ctx.fillRect(22, 22, 468, 212);

  // Weapon-specific chalk silhouette
  ctx.strokeStyle = 'rgba(248, 245, 232, 0.94)';
  ctx.lineWidth = 5;
  ctx.lineJoin = 'round';
  ctx.beginPath();

  if (weaponId === 'hedgerow') {
    // Pump shotgun: wooden stock, receiver, pump forend, long barrel + under-tube
    ctx.moveTo(64, 152);
    ctx.lineTo(132, 134);
    ctx.lineTo(165, 118);
    ctx.lineTo(436, 118);
    ctx.lineTo(436, 128);
    ctx.lineTo(380, 128);
    ctx.lineTo(380, 140);
    ctx.lineTo(255, 140);
    ctx.lineTo(255, 134);
    ctx.lineTo(168, 136);
    ctx.lineTo(148, 162);
    ctx.lineTo(74, 174);
    ctx.closePath();
    ctx.stroke();
    // Pump grip rib lines
    ctx.beginPath();
    ctx.rect(275, 130, 74, 15);
    ctx.stroke();
  } else if (weaponId === 'rattler') {
    // Compact SMG: wire stock, tall boxy receiver, vertical stick mag, short shrouded barrel
    ctx.moveTo(106, 120);
    ctx.lineTo(164, 120);
    ctx.lineTo(168, 108);
    ctx.lineTo(318, 108);
    ctx.lineTo(318, 118);
    ctx.lineTo(386, 118);
    ctx.lineTo(386, 128);
    ctx.lineTo(316, 128);
    ctx.lineTo(310, 136);
    ctx.lineTo(278, 136);
    ctx.lineTo(272, 182);
    ctx.lineTo(248, 182);
    ctx.lineTo(252, 136);
    ctx.lineTo(205, 136);
    ctx.lineTo(192, 174);
    ctx.lineTo(168, 172);
    ctx.lineTo(176, 136);
    ctx.lineTo(106, 136);
    ctx.closePath();
    ctx.stroke();
  } else {
    // Assault Rifle "Ironsight": angled stock, curved mag, carry handle / front post, long barrel
    ctx.moveTo(74, 128);
    ctx.lineTo(166, 120);
    ctx.lineTo(192, 104);
    ctx.lineTo(268, 104);
    ctx.lineTo(278, 118);
    ctx.lineTo(424, 118);
    ctx.lineTo(424, 128);
    ctx.lineTo(368, 128);
    ctx.lineTo(362, 140);
    ctx.lineTo(276, 140);
    ctx.lineTo(292, 180);
    ctx.lineTo(264, 184);
    ctx.lineTo(244, 142);
    ctx.lineTo(206, 142);
    ctx.lineTo(192, 174);
    ctx.lineTo(168, 172);
    ctx.lineTo(174, 142);
    ctx.lineTo(82, 162);
    ctx.closePath();
    ctx.stroke();
  }

  ctx.font = '700 32px "Oswald", sans-serif';
  ctx.fillStyle = 'rgba(244, 240, 226, 0.95)';
  ctx.textAlign = 'center';
  ctx.fillText(label.toUpperCase(), 256, 72);

  ctx.font = '700 26px "JetBrains Mono", monospace';
  ctx.fillStyle = 'rgba(245, 196, 81, 0.95)';
  ctx.fillText(`${price} PTS`, 256, 218);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function createSignageTexture(title: string, subtitle: string, bgHex = '#1c2420'): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 192;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = bgHex;
  ctx.fillRect(0, 0, 512, 192);

  ctx.strokeStyle = '#9b8e70';
  ctx.lineWidth = 6;
  ctx.strokeRect(10, 10, 492, 172);

  // Subtle weathered corner rivets
  ctx.fillStyle = '#5e5645';
  for (const [rx, ry] of [
    [24, 24],
    [488, 24],
    [24, 168],
    [488, 168],
  ] as const) {
    ctx.beginPath();
    ctx.arc(rx, ry, 5, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.fillStyle = '#e8e2d0';
  ctx.font = '700 36px "Oswald", sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(title, 256, 88);

  ctx.fillStyle = '#c4a662';
  ctx.font = '600 20px "JetBrains Mono", monospace';
  ctx.fillText(subtitle, 256, 134);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function createNoticeboardTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 320;
  const ctx = canvas.getContext('2d')!;

  // Corkboard base
  ctx.fillStyle = '#4c3827';
  ctx.fillRect(0, 0, 512, 320);
  ctx.strokeStyle = '#2a1d13';
  ctx.lineWidth = 14;
  ctx.strokeRect(7, 7, 498, 306);

  // Pinned quarantine notice sheet
  ctx.fillStyle = '#e2dccb';
  ctx.fillRect(36, 36, 210, 230);
  ctx.fillStyle = '#991b1b';
  ctx.fillRect(36, 36, 210, 34);
  ctx.fillStyle = '#f5f2e8';
  ctx.font = '700 18px "Oswald", sans-serif';
  ctx.fillText('QUARANTINE ORDER 10-86', 48, 60);
  ctx.fillStyle = '#222';
  ctx.font = '600 13px "JetBrains Mono", monospace';
  ctx.fillText('SECTOR: HOLLOWFIELD', 48, 94);
  ctx.fillText('STRAIN: BLOOM-F4', 48, 116);
  ctx.fillText('1. SEAL BARRICADES', 48, 148);
  ctx.fillText('2. RESTORE LAB POWER', 48, 170);
  ctx.fillText('3. AVOID SPORE VATS', 48, 192);
  ctx.fillText('   EVAC: TELEMETRY', 48, 214);

  // Blueprint / map card on right side
  ctx.fillStyle = '#173042';
  ctx.fillRect(272, 48, 204, 146);
  ctx.strokeStyle = 'rgba(186, 230, 253, 0.7)';
  ctx.lineWidth = 2;
  ctx.strokeRect(284, 60, 180, 122);
  ctx.strokeRect(300, 126, 48, 44);
  ctx.strokeRect(358, 72, 92, 48);
  ctx.strokeRect(398, 126, 52, 44);
  ctx.fillStyle = '#bae6fd';
  ctx.font = '600 11px "JetBrains Mono", monospace';
  ctx.fillText('STATION GRID B-04', 292, 80);

  // Sticky note
  ctx.fillStyle = '#eab308';
  ctx.fillRect(292, 212, 130, 74);
  ctx.fillStyle = '#1c1917';
  ctx.font = '700 13px "JetBrains Mono", monospace';
  ctx.fillText('FUSES: 3', 306, 240);
  ctx.fillText('QUARTERS / LOFT', 306, 262);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function createOscilloscopeTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 128;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#07140d';
  ctx.fillRect(0, 0, 256, 128);
  ctx.strokeStyle = 'rgba(34, 197, 94, 0.2)';
  ctx.lineWidth = 1;
  for (let x = 0; x <= 256; x += 32) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, 128);
    ctx.stroke();
  }
  for (let y = 0; y <= 128; y += 32) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(256, y);
    ctx.stroke();
  }
  ctx.strokeStyle = '#4ade80';
  ctx.lineWidth = 3;
  ctx.beginPath();
  for (let x = 0; x <= 256; x += 4) {
    const y = 64 + Math.sin(x * 0.08) * 28 * Math.sin(x * 0.02);
    if (x === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
