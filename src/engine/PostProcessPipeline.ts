import * as THREE from 'three';
import {
  BloomEffect,
  ChromaticAberrationEffect,
  EffectComposer,
  EffectPass,
  HueSaturationEffect,
  NoiseEffect,
  RenderPass,
  SMAAEffect,
  ToneMappingEffect,
  ToneMappingMode,
  VignetteEffect,
} from 'postprocessing';
import type { QualityPreset } from '../game/types';

export class PostProcessPipeline {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene: THREE.Scene;
  private readonly camera: THREE.PerspectiveCamera;
  private readonly isSoftwareGl: boolean;

  private composer: EffectComposer | null = null;
  private bloomEffect: BloomEffect | null = null;
  private vignetteEffect: VignetteEffect | null = null;
  private chromaticEffect: ChromaticAberrationEffect | null = null;
  private hueSatEffect: HueSaturationEffect | null = null;
  private noiseEffect: NoiseEffect | null = null;
  private smaaEffect: SMAAEffect | null = null;
  private effectPass: EffectPass | null = null;

  private quality: QualityPreset = 'high';
  private resolutionScale = 1.0;

  constructor(
    renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
    camera: THREE.PerspectiveCamera,
    isSoftwareGl: boolean,
  ) {
    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;
    this.isSoftwareGl = isSoftwareGl;
    this.initComposer();
  }

  private initComposer(): void {
    if (this.isSoftwareGl) {
      // Software WebGL renders directly to avoid multi-pass stalls while preserving exact scene/lighting
      return;
    }

    const composer = new EffectComposer(this.renderer, {
      frameBufferType: THREE.HalfFloatType,
    });
    composer.addPass(new RenderPass(this.scene, this.camera));

    this.bloomEffect = new BloomEffect({
      intensity: 0.72,
      luminanceThreshold: 0.85,
      luminanceSmoothing: 0.25,
      mipmapBlur: true,
    });

    this.vignetteEffect = new VignetteEffect({
      eskil: false,
      offset: 0.26,
      darkness: 0.58,
    });

    this.chromaticEffect = new ChromaticAberrationEffect({
      offset: new THREE.Vector2(0, 0),
      radialModulation: true,
      modulationOffset: 0.2,
    });

    this.hueSatEffect = new HueSaturationEffect({
      hue: 0,
      saturation: 0,
    });

    this.noiseEffect = new NoiseEffect({
      premultiply: true,
    });
    this.noiseEffect.blendMode.opacity.value = 0.055;

    this.smaaEffect = new SMAAEffect();

    const toneMapping = new ToneMappingEffect({
      mode: ToneMappingMode.ACES_FILMIC,
    });

    this.effectPass = new EffectPass(
      this.camera,
      this.smaaEffect,
      this.bloomEffect,
      this.chromaticEffect,
      this.hueSatEffect,
      this.vignetteEffect,
      this.noiseEffect,
      toneMapping,
    );

    composer.addPass(this.effectPass);
    this.composer = composer;
  }

  public applyQuality(quality: QualityPreset, resolutionScale: number): void {
    this.quality = quality;
    this.resolutionScale = resolutionScale;

    const baseRatio = this.isSoftwareGl ? 0.5 : Math.min(window.devicePixelRatio, 2);
    const scaleFactor =
      quality === 'low' ? 0.75 : quality === 'medium' ? 0.9 : 1.0;
    this.renderer.setPixelRatio(Math.max(0.5, baseRatio * resolutionScale * scaleFactor));

    if (this.bloomEffect) {
      this.bloomEffect.blendMode.opacity.value = quality === 'low' ? 0 : quality === 'medium' ? 0.45 : 0.75;
    }
    if (this.noiseEffect) {
      this.noiseEffect.blendMode.opacity.value = quality === 'low' ? 0 : 0.055;
    }
    this.resize(window.innerWidth, window.innerHeight);
  }

  public setDamageAndHealthEffects(damageFlash: number, healthRatio: number): void {
    if (this.chromaticEffect) {
      const amt = damageFlash * 0.0045;
      this.chromaticEffect.offset.set(amt, amt * 0.65);
    }
    if (this.hueSatEffect) {
      const lowHealth = healthRatio < 0.45 ? 1 - healthRatio / 0.45 : 0;
      this.hueSatEffect.saturation = -lowHealth * 0.52;
    }
    if (this.vignetteEffect) {
      const lowHealth = healthRatio < 0.45 ? 1 - healthRatio / 0.45 : 0;
      this.vignetteEffect.darkness = 0.52 + lowHealth * 0.36 + damageFlash * 0.25;
    }
  }

  public resize(width: number, height: number): void {
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
    if (this.composer) {
      this.composer.setSize(width, height);
    }
  }

  public render(): void {
    if (this.composer && this.quality !== 'low' && !this.isSoftwareGl) {
      this.composer.render();
    } else {
      this.renderer.render(this.scene, this.camera);
    }
  }

  public dispose(): void {
    this.composer?.dispose();
    this.composer = null;
  }
}
