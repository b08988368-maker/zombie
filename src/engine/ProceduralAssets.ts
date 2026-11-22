import * as THREE from 'three';

export interface PbrMaterialSet {
  concrete: THREE.MeshStandardMaterial;
  wetAsphalt: THREE.MeshStandardMaterial;
  rustedMetal: THREE.MeshStandardMaterial;
  barnWood: THREE.MeshStandardMaterial;
  plasterWall: THREE.MeshStandardMaterial;
  labTile: THREE.MeshStandardMaterial;
  soil: THREE.MeshStandardMaterial;
  warningStripe: THREE.MeshStandardMaterial;
  darkTrim: THREE.MeshStandardMaterial;
  gunMetal: THREE.MeshStandardMaterial;
  gunPolymer: THREE.MeshStandardMaterial;
  gunWood: THREE.MeshStandardMaterial;
  muzzleFlashTex: THREE.CanvasTexture;
  bulletHoleTex: THREE.CanvasTexture;
  bloodSplatterTex: THREE.CanvasTexture;
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

      const rg = Math.max(20, Math.min(250, Math.round(p.rough * 255)));
      rough[o] = rg;
      rough[o + 1] = rg;
      rough[o + 2] = rg;
      rough[o + 3] = 255;
    }
  }

  // Sobel normal map
  const strength = 2.6;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const xm = (x - 1 + size) % size;
      const xp = (x + 1) % size;
      const ym = (y - 1 + size) % size;
      const yp = (y + 1) % size;
      const dx = (heights[y * size + xp]! - heights[y * size + xm]!) * strength;
      const dy = (heights[yp * size + x]! - heights[ym * size + x]!) * strength;
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
         float macroVar = 0.88 + 0.14 * (mA * 0.5 + mB * 0.5);
         diffuseColor.rgb *= macroVar;`,
      );
  };
  mat.customProgramCacheKey = () => `macro_var_${scale}`;
}

export function createPbrMaterialSet(renderer: THREE.WebGLRenderer): PbrMaterialSet {
  const maxAniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  const texSize = 256;

  // 1. Cracked stained concrete
  const conc = generateTextureSet(texSize, maxAniso, 1, 1, (u, v) => {
    const n = fbm(u * 12, v * 12, 11, 4);
    const fine = valueNoise(u * 48, v * 48, 23);
    const seam = Math.abs(((u * 2) % 1) - 0.5) < 0.012 || Math.abs(((v * 2) % 1) - 0.5) < 0.012 ? 0.65 : 1;
    const base = (78 + n * 42 + fine * 14) * seam;
    return { r: base, g: base * 0.99, b: base * 0.95, h: n * 0.6 + fine * 0.25 - (1 - seam) * 0.4, rough: 0.72 + n * 0.2 };
  });
  const concrete = new THREE.MeshStandardMaterial({
    map: conc.map,
    normalMap: conc.normalMap,
    normalScale: new THREE.Vector2(0.9, 0.9),
    roughnessMap: conc.roughnessMap,
    roughness: 0.88,
    metalness: 0.05,
  });
  applyMacroWorldVariation(concrete, 0.14);

  // 2. Wet asphalt / yard gravel
  const asp = generateTextureSet(texSize, maxAniso, 1, 1, (u, v) => {
    const n = fbm(u * 10, v * 10, 31, 4);
    const grit = valueNoise(u * 64, v * 64, 41);
    const puddle = n < 0.38 ? 0.18 : 0.78;
    const base = 34 + n * 24 + grit * 14;
    return { r: base * 0.95, g: base, b: base * 1.05, h: grit * 0.35 + n * 0.4, rough: puddle };
  });
  const wetAsphalt = new THREE.MeshStandardMaterial({
    map: asp.map,
    normalMap: asp.normalMap,
    normalScale: new THREE.Vector2(0.85, 0.85),
    roughnessMap: asp.roughnessMap,
    roughness: 0.75,
    metalness: 0.1,
  });
  applyMacroWorldVariation(wetAsphalt, 0.09);

  // 3. Rusted corrugated metal
  const met = generateTextureSet(texSize, maxAniso, 1, 1, (u, v) => {
    const rib = Math.sin(u * Math.PI * 16) * 0.5 + 0.5;
    const rustNoise = fbm(u * 10, v * 10, 53, 4);
    const rust = rustNoise > 0.52 ? (rustNoise - 0.52) * 2.1 : 0;
    const steel = 72 + rib * 26;
    const r = steel * (1 - rust) + 112 * rust;
    const g = steel * (1 - rust) + 56 * rust;
    const b = steel * 1.05 * (1 - rust) + 34 * rust;
    return { r, g, b, h: rib * 0.6 + rustNoise * 0.35, rough: 0.35 + rust * 0.55 };
  });
  const rustedMetal = new THREE.MeshStandardMaterial({
    map: met.map,
    normalMap: met.normalMap,
    normalScale: new THREE.Vector2(1.1, 1.1),
    roughnessMap: met.roughnessMap,
    roughness: 0.65,
    metalness: 0.68,
  });

  // 4. Weathered barn wood planks
  const wd = generateTextureSet(texSize, maxAniso, 1, 1, (u, v) => {
    const plank = Math.floor(v * 6);
    const seam = Math.abs(((v * 6) % 1) - 0.04) < 0.03 ? 0.4 : 1.0;
    const grain = fbm(u * 4 + plank * 3.1, v * 36, 71, 4);
    const tint = 0.85 + hash2d(plank, 1, 7) * 0.3;
    const r = (84 + grain * 42) * tint * seam;
    const g = (60 + grain * 30) * tint * seam;
    const b = (42 + grain * 20) * tint * seam;
    return { r, g, b, h: grain * 0.5 - (1 - seam) * 0.5, rough: 0.78 + grain * 0.16 };
  });
  const barnWood = new THREE.MeshStandardMaterial({
    map: wd.map,
    normalMap: wd.normalMap,
    normalScale: new THREE.Vector2(1.0, 1.0),
    roughnessMap: wd.roughnessMap,
    roughness: 0.85,
    metalness: 0.04,
  });

  // 5. Farmhouse aged plaster
  const pl = generateTextureSet(texSize, maxAniso, 1, 1, (u, v) => {
    const n = fbm(u * 8, v * 8, 91, 4);
    const mold = fbm(u * 14, v * 14, 97, 3);
    const damp = mold > 0.62 ? 0.68 : 1.0;
    const r = (132 + n * 30) * damp;
    const g = (128 + n * 28) * (damp + 0.04);
    const b = (112 + n * 24) * damp;
    return { r, g, b, h: n * 0.45 + mold * 0.25, rough: 0.88 };
  });
  const plasterWall = new THREE.MeshStandardMaterial({
    map: pl.map,
    normalMap: pl.normalMap,
    normalScale: new THREE.Vector2(0.65, 0.65),
    roughnessMap: pl.roughnessMap,
    roughness: 0.9,
    metalness: 0.02,
  });
  applyMacroWorldVariation(plasterWall, 0.18);

  // 6. Lab Wing ceramic tiles
  const lt = generateTextureSet(texSize, maxAniso, 1, 1, (u, v) => {
    const gx = (u * 6) % 1;
    const gy = (v * 6) % 1;
    const grout = gx < 0.06 || gy < 0.06;
    const grime = fbm(u * 10, v * 10, 113, 3);
    if (grout) {
      return { r: 58, g: 64, b: 60, h: 0.1, rough: 0.92 };
    }
    const base = 152 + grime * 28;
    return { r: base * 0.9, g: base * 0.98, b: base * 0.93, h: 0.75 + grime * 0.1, rough: 0.28 + grime * 0.22 };
  });
  const labTile = new THREE.MeshStandardMaterial({
    map: lt.map,
    normalMap: lt.normalMap,
    normalScale: new THREE.Vector2(0.8, 0.8),
    roughnessMap: lt.roughnessMap,
    roughness: 0.42,
    metalness: 0.08,
  });

  // 7. Valley soil / fungal earth
  const sl = generateTextureSet(texSize, maxAniso, 1, 1, (u, v) => {
    const n = fbm(u * 12, v * 12, 131, 4);
    const grass = fbm(u * 26, v * 26, 139, 3);
    const r = 42 + n * 24 + grass * 10;
    const g = 46 + n * 26 + grass * 18;
    const b = 34 + n * 16;
    return { r, g, b, h: n * 0.7 + grass * 0.3, rough: 0.92 };
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

  // 8. Hazard chevron warning stripe
  const wrn = generateTextureSet(texSize, maxAniso, 1, 1, (u, v) => {
    const stripe = ((u * 4 + v * 4) % 1) < 0.5;
    const wear = fbm(u * 16, v * 16, 151, 3);
    const scratch = wear > 0.65 ? 0.5 : 1.0;
    if (stripe) {
      return { r: 196 * scratch, g: 146 * scratch, b: 34 * scratch, h: 0.5 + wear * 0.2, rough: 0.45 + (1 - scratch) * 0.3 };
    }
    return { r: 28, g: 30, b: 30, h: 0.45 + wear * 0.2, rough: 0.58 };
  });
  const warningStripe = new THREE.MeshStandardMaterial({
    map: wrn.map,
    normalMap: wrn.normalMap,
    roughnessMap: wrn.roughnessMap,
    roughness: 0.55,
    metalness: 0.35,
  });

  const darkTrim = new THREE.MeshStandardMaterial({
    color: 0x262928,
    roughness: 0.55,
    metalness: 0.65,
  });

  const gunMetal = new THREE.MeshStandardMaterial({
    color: 0x3b4046,
    roughness: 0.28,
    metalness: 0.88,
  });

  const gunPolymer = new THREE.MeshStandardMaterial({
    color: 0x1e2022,
    roughness: 0.68,
    metalness: 0.12,
  });

  const gunWood = new THREE.MeshStandardMaterial({
    map: wd.map,
    color: 0x7c5034,
    roughness: 0.55,
    metalness: 0.05,
  });

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

  return {
    concrete,
    wetAsphalt,
    rustedMetal,
    barnWood,
    plasterWall,
    labTile,
    soil,
    warningStripe,
    darkTrim,
    gunMetal,
    gunPolymer,
    gunWood,
    muzzleFlashTex,
    bulletHoleTex,
    bloodSplatterTex,
  };
}

export function createWallBuyChalkTexture(label: string, price: number): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 256;
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, 512, 256);

  // Chalk outline frame & silhouette
  ctx.strokeStyle = 'rgba(236, 232, 218, 0.88)';
  ctx.lineWidth = 4;
  ctx.setLineDash([12, 6]);
  ctx.strokeRect(18, 18, 476, 220);

  ctx.setLineDash([]);
  ctx.fillStyle = 'rgba(236, 232, 218, 0.12)';
  ctx.fillRect(22, 22, 468, 212);

  // Stylized weapon chalk silhouette
  ctx.strokeStyle = 'rgba(245, 242, 230, 0.92)';
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.moveTo(96, 118);
  ctx.lineTo(395, 118);
  ctx.lineTo(415, 134);
  ctx.lineTo(290, 134);
  ctx.lineTo(275, 174);
  ctx.lineTo(245, 174);
  ctx.lineTo(255, 138);
  ctx.lineTo(155, 138);
  ctx.lineTo(118, 168);
  ctx.lineTo(84, 164);
  ctx.closePath();
  ctx.stroke();

  ctx.font = '700 32px "Oswald", sans-serif';
  ctx.fillStyle = 'rgba(244, 240, 226, 0.95)';
  ctx.textAlign = 'center';
  ctx.fillText(label.toUpperCase(), 256, 72);

  ctx.font = '700 26px "JetBrains Mono", monospace';
  ctx.fillStyle = 'rgba(245, 196, 81, 0.95)';
  ctx.fillText(`${price} PTS`, 256, 216);

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
