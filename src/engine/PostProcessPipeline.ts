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
  private readonly useComposer: boolean;

  private composer: EffectComposer | null = null;
  private bloomEffect: BloomEffect | null = null;
  private vignetteEffect: VignetteEffect | null = null;
  private chromaticEffect: ChromaticAberrationEffect | null = null;
  private hueSatEffect: HueSaturationEffect | null = null;
  private noiseEffect: NoiseEffect | null = null;
  private smaaEffect: SMAAEffect | null = null;
  private smaaPass: EffectPass | null = null;
  private gradePass: EffectPass | null = null;
  private chromaticPass: EffectPass | null = null;

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
    const forcePost =
      typeof window !== 'undefined' && window.location.search.includes('forcePostProcess=1');
    this.useComposer = !isSoftwareGl || forcePost;
    this.initComposer();
  }

  private initComposer(): void {
    if (!this.useComposer) {
      // Software WebGL renders directly to avoid multi-pass stalls while preserving exact scene/lighting
      return;
    }

    try {
      const composer = new EffectComposer(this.renderer, {
        frameBufferType: THREE.HalfFloatType,
      });
      composer.addPass(new RenderPass(this.scene, this.camera));

      this.bloomEffect = new BloomEffect({
        intensity: 0.85,
        luminanceThreshold: 0.78,
        luminanceSmoothing: 0.28,
        mipmapBlur: true,
      });

      this.vignetteEffect = new VignetteEffect({
        eskil: false,
        offset: 0.24,
        darkness: 0.62,
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

      // Convolution effects (SMAAEffect & ChromaticAberrationEffect) cannot share an EffectPass.
      // Keep gradePass last and always enabled so the final pass always has renderToScreen = true.
      this.smaaPass = new EffectPass(this.camera, this.smaaEffect);
      this.chromaticPass = new EffectPass(this.camera, this.chromaticEffect);
      this.chromaticPass.enabled = false;
      this.gradePass = new EffectPass(
        this.camera,
        this.bloomEffect,
        this.hueSatEffect,
        this.vignetteEffect,
        this.noiseEffect,
        toneMapping,
      );

      composer.addPass(this.smaaPass);
      composer.addPass(this.chromaticPass);
      composer.addPass(this.gradePass);
      this.composer = composer;
    } catch (err) {
      console.warn('PostProcessPipeline initialization failed, using direct render:', err);
      this.composer = null;
    }
  }

  public applyQuality(quality: QualityPreset, resolutionScale: number): void {
    this.quality = quality;
    this.resolutionScale = resolutionScale;

    const baseRatio = this.isSoftwareGl
      ? this.useComposer
        ? 0.5
        : 0.65
      : Math.min(window.devicePixelRatio, 2);
    const scaleFactor =
      quality === 'low' ? 0.75 : quality === 'medium' ? 0.9 : 1.0;
    this.renderer.setPixelRatio(Math.max(0.5, baseRatio * resolutionScale * scaleFactor));

    if (this.smaaPass) {
      this.smaaPass.enabled = quality === 'high' || quality === 'ultra';
    }
    if (this.bloomEffect) {
      this.bloomEffect.blendMode.opacity.value = quality === 'low' ? 0 : quality === 'medium' ? 0.45 : 0.75;
    }
    if (this.noiseEffect) {
      this.noiseEffect.blendMode.opacity.value = quality === 'low' ? 0 : 0.055;
    }
    this.resize(window.innerWidth, window.innerHeight);
  }

  public setDamageAndHealthEffects(damageFlash: number, healthRatio: number): void {
    if (this.chromaticEffect && this.chromaticPass) {
      const amt = damageFlash * 0.0045;
      this.chromaticEffect.offset.set(amt, amt * 0.65);
      this.chromaticPass.enabled = damageFlash > 0.01;
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
    if (this.composer && this.quality !== 'low' && this.useComposer) {
      try {
        this.composer.render();
        return;
      } catch (err) {
        console.warn('PostProcessPipeline render failed, falling back to direct render:', err);
        this.composer = null;
      }
    }
    this.renderer.render(this.scene, this.camera);
  }

  public dispose(): void {
    this.composer?.dispose();
    this.composer = null;
  }
}
