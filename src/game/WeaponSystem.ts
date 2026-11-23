import * as THREE from 'three';
import {
  BALANCE,
  type EnemyType,
  type PerkId,
  type WeaponConfig,
  type WeaponId,
} from '../config/balance';
import type { AudioEngine } from '../engine/AudioEngine';
import type { BvhWorld, SurfaceType } from '../engine/BvhWorld';
import type { PhysicsWorld, DynamicGrenadeBody } from '../engine/PhysicsWorld';
import type { PbrMaterialSet } from '../engine/ProceduralAssets';
import type { PlayerController, PlayerInputState } from './PlayerController';
import type { WeaponSlotState } from './types';
import type { HitZone, ZombieSystem } from './ZombieSystem';

interface ParticleItem {
  mesh: THREE.Mesh;
  vx: number;
  vy: number;
  vz: number;
  rx: number;
  ry: number;
  rz: number;
  life: number;
  maxLife: number;
  gravity: number;
  startScale: number;
  endScale: number;
  baseOpacity: number;
  bounce: boolean;
  active: boolean;
}

interface TracerItem {
  line: THREE.Mesh;
  life: number;
  active: boolean;
}

interface ShockwaveItem {
  mesh: THREE.Mesh;
  life: number;
  maxLife: number;
  maxRadius: number;
  active: boolean;
}

interface PhaseBolt {
  mesh: THREE.Group;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  life: number;
  upgraded: boolean;
  active: boolean;
}

interface ActiveGrenade {
  rb: DynamicGrenadeBody;
  mesh: THREE.Group;
  fuse: number;
}

interface LeftArmRig {
  group: THREE.Group;
  restPos: THREE.Vector3;
  restRot: THREE.Euler;
  magPos: THREE.Vector3;
  rackPos: THREE.Vector3;
}

export interface ShotCallbacks {
  onPoints: (amount: number, reason: string) => void;
  onHitMarker: (kind: 'hit' | 'kill' | 'headshot') => void;
  onKillEnemy: (
    enemyType: EnemyType,
    x: number,
    y: number,
    z: number,
    isHeadshot: boolean,
    isMelee: boolean,
    isExplosive: boolean,
  ) => void;
  onBloaterExplode: (x: number, y: number, z: number) => void;
  onHitStop: () => void;
  onShotStats: (fired: boolean, hit: boolean) => void;
}

interface WeaponSpec {
  len: number;
  height: number;
  width: number;
  hasStock: boolean;
  hasDrum: boolean;
  isLong: boolean;
  wood: boolean;
  isPhase?: boolean;
}

const WEAPON_SPECS: Record<WeaponId, WeaponSpec> = {
  service_pistol: { len: 0.24, height: 0.115, width: 0.038, hasStock: false, hasDrum: false, isLong: false, wood: false },
  hedgerow: { len: 0.72, height: 0.11, width: 0.052, hasStock: true, hasDrum: false, isLong: true, wood: true },
  rattler: { len: 0.44, height: 0.128, width: 0.048, hasStock: false, hasDrum: false, isLong: false, wood: false },
  ironsight: { len: 0.64, height: 0.128, width: 0.05, hasStock: true, hasDrum: false, isLong: true, wood: false },
  longbow: { len: 0.84, height: 0.118, width: 0.048, hasStock: true, hasDrum: false, isLong: true, wood: true },
  hammerfall: { len: 0.76, height: 0.155, width: 0.068, hasStock: true, hasDrum: true, isLong: true, wood: false },
  phase_cannon: { len: 0.56, height: 0.145, width: 0.074, hasStock: false, hasDrum: false, isLong: false, wood: false, isPhase: true },
};

const ADS_EYE_Y: Record<WeaponId, number> = {
  service_pistol: -0.082,
  hedgerow: -0.08,
  rattler: -0.09,
  ironsight: -0.09,
  longbow: -0.104,
  hammerfall: -0.106,
  phase_cannon: -0.102,
};

function createGlovedHand(
  gloveMat: THREE.Material,
  knuckleMat: THREE.Material,
  pose: 'grip' | 'cradle' | 'knife',
): THREE.Group {
  const hand = new THREE.Group();

  // Sculpted compact palm / metacarpal block
  const palm = new THREE.Mesh(new THREE.BoxGeometry(0.044, 0.046, 0.056), gloveMat);
  hand.add(palm);

  // Armored knuckle ridge
  const knuckle = new THREE.Mesh(new THREE.BoxGeometry(0.048, 0.013, 0.02), knuckleMat);
  knuckle.position.set(0, 0.019, -0.02);
  hand.add(knuckle);

  if (pose === 'grip' || pose === 'knife') {
    for (let i = 0; i < 3; i++) {
      const finger = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.011, 0.026), gloveMat);
      finger.position.set(0, -0.008 - i * 0.013, -0.032);
      finger.rotation.x = 0.25;
      hand.add(finger);
    }
    const indexFinger = new THREE.Mesh(new THREE.BoxGeometry(0.011, 0.011, 0.036), gloveMat);
    indexFinger.position.set(0.017, 0.009, -0.038);
    hand.add(indexFinger);

    const thumb = new THREE.Mesh(new THREE.BoxGeometry(0.013, 0.013, 0.034), gloveMat);
    thumb.position.set(-0.024, 0.016, -0.016);
    thumb.rotation.set(-0.3, 0.25, 0);
    hand.add(thumb);
  } else {
    for (let i = 0; i < 4; i++) {
      const finger = new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.032, 0.012), gloveMat);
      finger.position.set(0.02, 0.015, -0.02 + i * 0.013);
      finger.rotation.z = 0.34;
      hand.add(finger);
    }
    const thumb = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.03, 0.014), gloveMat);
    thumb.position.set(-0.022, 0.015, -0.006);
    thumb.rotation.z = -0.32;
    hand.add(thumb);
  }

  return hand;
}

export class WeaponSystem {
  public slots: WeaponSlotState[] = [];
  public activeSlot = 0;
  public isReloading = false;
  public reloadTimer = 0;
  public reloadDuration = 1.5;

  private fireCooldown = 0;
  private swapTimer = 0;
  private semiTriggerConsumed = false;
  private reloadCueInPlayed = false;
  private reloadCueRackPlayed = false;

  // Viewmodel hierarchy
  public readonly viewmodelRoot = new THREE.Group();
  private readonly weaponPivot = new THREE.Group();
  private readonly weaponModels = new Map<WeaponId, THREE.Group>();
  private readonly weaponMags = new Map<WeaponId, { mesh: THREE.Object3D; baseY: number }>();
  private readonly weaponSlides = new Map<WeaponId, { mesh: THREE.Object3D; baseZ: number }>();
  private readonly weaponPumps = new Map<WeaponId, { mesh: THREE.Object3D; baseZ: number }>();
  private readonly leftArms = new Map<WeaponId, LeftArmRig>();
  private readonly muzzleSprites = new Map<WeaponId, THREE.Sprite>();
  private readonly muzzleCrosses = new Map<WeaponId, THREE.Group>();
  private readonly knifeGroup = new THREE.Group();
  private readonly bottleGroup = new THREE.Group();
  private readonly bottleLiquidMat: THREE.MeshStandardMaterial;

  // Muzzle lights (capped at 2 simultaneous per §4)
  private readonly muzzleLights: { light: THREE.PointLight; timer: number }[] = [];
  private muzzleLightCursor = 0;

  // Pooled particles, brass casings, smoke, tracers, decals, shockwaves, phase bolts, grenades
  private readonly particles: ParticleItem[] = [];
  private readonly shellPool: ParticleItem[] = [];
  private readonly smokePool: ParticleItem[] = [];
  private readonly tracers: TracerItem[] = [];
  private readonly shockwaves: ShockwaveItem[] = [];
  private readonly decals: THREE.Mesh[] = [];
  private decalCursor = 0;
  private readonly phaseBolts: PhaseBolt[] = [];
  private phaseLight!: THREE.PointLight;
  private readonly activeGrenades: ActiveGrenade[] = [];

  private recoilOffsetZ = 0;
  private recoilOffsetPitch = 0;
  private recoilBloom = 0;
  private slideKick = 0;
  private pumpTimer = 0;
  private inspectTimer = 0;
  private readonly inspectDuration = 1.85;
  private lookSwayX = 0;
  private lookSwayY = 0;
  private swayX = 0;
  private swayY = 0;
  private bobPhase = 0;
  private muzzleFlashTimer = 0;

  private readonly scene: THREE.Scene;
  private readonly camera: THREE.PerspectiveCamera;
  private readonly bvh: BvhWorld;
  private readonly physics: PhysicsWorld;
  private readonly zombies: ZombieSystem;
  private readonly audio: AudioEngine;
  private readonly mats: PbrMaterialSet;

  private readonly tmpOrigin = new THREE.Vector3();
  private readonly tmpDir = new THREE.Vector3();
  private readonly tmpVec = new THREE.Vector3();
  private readonly tmpRight = new THREE.Vector3();
  private readonly tmpUp = new THREE.Vector3();
  private readonly tmpQuat = new THREE.Quaternion();

  private grenadeAssets: {
    bodyGeo: THREE.BufferGeometry;
    bandGeo: THREE.BufferGeometry;
    collarGeo: THREE.BufferGeometry;
    spoonGeo: THREE.BufferGeometry;
    ringGeo: THREE.BufferGeometry;
    castIronMat: THREE.MeshStandardMaterial;
    ringMat: THREE.MeshStandardMaterial;
  } | null = null;

  constructor(
    scene: THREE.Scene,
    camera: THREE.PerspectiveCamera,
    bvh: BvhWorld,
    physics: PhysicsWorld,
    zombies: ZombieSystem,
    audio: AudioEngine,
    mats: PbrMaterialSet,
  ) {
    this.scene = scene;
    this.camera = camera;
    this.bvh = bvh;
    this.physics = physics;
    this.zombies = zombies;
    this.audio = audio;
    this.mats = mats;

    this.bottleLiquidMat = new THREE.MeshStandardMaterial({
      color: 0x22c55e,
      emissive: 0x22c55e,
      emissiveIntensity: 0.7,
      roughness: 0.2,
    });

    this.camera.add(this.viewmodelRoot);
    this.viewmodelRoot.add(this.weaponPivot);
    this.buildAllViewmodels();
    this.allocatePools();
    this.reset();
  }

  public static buildWeaponShowcaseModel(id: WeaponId, mats: PbrMaterialSet): THREE.Group {
    const spec = WEAPON_SPECS[id];
    const g = new THREE.Group();
    const recH = spec.height * 0.52;
    const recY = 0.0;
    const topY = recY + recH * 0.5;

    const accentMat = new THREE.MeshStandardMaterial({
      color: 0x38bdf8,
      emissive: 0x0ea5e9,
      emissiveIntensity: 1.75,
      roughness: 0.2,
    });
    const tritiumMat = new THREE.MeshBasicMaterial({ color: 0x4ade80 });
    const glassMat = new THREE.MeshStandardMaterial({
      color: 0x0f3b4c,
      emissive: 0x0c4a6e,
      emissiveIntensity: 0.7,
      roughness: 0.08,
      metalness: 0.9,
    });

    // Lower receiver / frame + side bevel plates + flared magwell
    const recMat = spec.isPhase ? mats.gunMetal : mats.gunPolymer;
    const receiver = new THREE.Mesh(
      new THREE.BoxGeometry(spec.width, recH, spec.len * 0.54),
      recMat,
    );
    receiver.position.set(0, recY, -spec.len * 0.22);
    g.add(receiver);

    // Side bevel cheeks for faceted mechanical silhouette
    for (const side of [-1, 1]) {
      const cheek = new THREE.Mesh(
        new THREE.BoxGeometry(0.005, recH * 0.68, spec.len * 0.42),
        mats.darkTrim,
      );
      cheek.position.set(side * (spec.width * 0.5 + 0.0015), recY + 0.002, -spec.len * 0.22);
      g.add(cheek);
    }

    // Upper slide / dust cover / top rail assembly (tagged weapon_slide on pistol/phase/bolt)
    const slideGroup = new THREE.Group();
    const slideY = topY + recH * 0.28;
    slideGroup.position.set(0, slideY, -spec.len * 0.24);
    g.add(slideGroup);

    const upperShell = new THREE.Mesh(
      new THREE.BoxGeometry(spec.width * 0.9, recH * 0.62, spec.len * 0.56),
      mats.gunMetal,
    );
    slideGroup.add(upperShell);

    // Top Picatinny rail notches
    if (id !== 'hedgerow' && id !== 'service_pistol') {
      const railBar = new THREE.Mesh(
        new THREE.BoxGeometry(spec.width * 0.56, 0.007, spec.len * 0.44),
        mats.darkTrim,
      );
      railBar.position.y = recH * 0.34;
      slideGroup.add(railBar);
    }

    // Serrations on pistol slide or charging handle on rifles/SMG/LMG
    const boltPort = new THREE.Mesh(
      new THREE.BoxGeometry(0.005, recH * 0.34, spec.len * 0.14),
      mats.brushedSteel,
    );
    boltPort.position.set(spec.width * 0.45, 0, 0.02);

    if (id === 'service_pistol') {
      slideGroup.name = 'weapon_slide';
      slideGroup.add(boltPort);
      // Rear slide serration ribs
      for (let i = 0; i < 4; i++) {
        const ser = new THREE.Mesh(new THREE.BoxGeometry(spec.width * 0.94, recH * 0.42, 0.004), mats.darkTrim);
        ser.position.set(0, 0, spec.len * 0.22 - i * 0.01);
        slideGroup.add(ser);
      }
      // Tritium sights mounted on moving pistol slide
      const rearSight = new THREE.Mesh(new THREE.BoxGeometry(0.024, 0.014, 0.015), mats.gunMetal);
      rearSight.position.set(0, recH * 0.38, spec.len * 0.22);
      const frontPost = new THREE.Mesh(new THREE.BoxGeometry(0.007, 0.015, 0.012), mats.gunMetal);
      frontPost.position.set(0, recH * 0.38, -spec.len * 0.25);
      const frontDot = new THREE.Mesh(new THREE.BoxGeometry(0.004, 0.004, 0.004), tritiumMat);
      frontDot.position.set(0, recH * 0.43, -spec.len * 0.244);
      const rearDotL = new THREE.Mesh(new THREE.BoxGeometry(0.003, 0.004, 0.004), tritiumMat);
      rearDotL.position.set(-0.007, recH * 0.42, spec.len * 0.228);
      const rearDotR = rearDotL.clone();
      rearDotR.position.x = 0.007;
      slideGroup.add(rearSight, frontPost, frontDot, rearDotL, rearDotR);
    } else {
      // Stationary upper receiver; bolt carrier + charging handle reciprocates as weapon_slide!
      const boltCarrier = new THREE.Group();
      boltCarrier.name = 'weapon_slide';
      boltCarrier.position.set(0, slideY, -spec.len * 0.22);
      boltPort.position.set(spec.width * 0.46, 0, 0);
      boltCarrier.add(boltPort);
      const handleKnob = new THREE.Mesh(
        new THREE.CylinderGeometry(0.007, 0.007, 0.026, 8),
        mats.brushedSteel,
      );
      handleKnob.rotation.z = Math.PI / 2;
      handleKnob.position.set(spec.width * 0.56, 0.004, 0.02);
      boltCarrier.add(handleKnob);
      g.add(boltCarrier);
    }

    const slideTopY = slideY + recH * 0.31;

    // Primary barrel + stepped muzzle brake / crown
    const barrelRadius = spec.width * 0.23;
    const barrelLen = spec.len * 0.62;
    const barrel = new THREE.Mesh(
      new THREE.CylinderGeometry(barrelRadius, barrelRadius * 1.08, barrelLen, 14),
      mats.gunMetal,
    );
    barrel.rotation.x = Math.PI / 2;
    barrel.position.set(0, slideY - 0.004, -spec.len * 0.55);
    g.add(barrel);

    const muzzleBrake = new THREE.Mesh(
      new THREE.CylinderGeometry(barrelRadius * 1.38, barrelRadius * 1.24, 0.04, 12),
      mats.darkTrim,
    );
    muzzleBrake.rotation.x = Math.PI / 2;
    muzzleBrake.position.set(0, slideY - 0.004, -spec.len * 0.85);
    g.add(muzzleBrake);

    // Weapon-specific silhouette assemblies
    if (id === 'hedgerow') {
      const underTube = new THREE.Mesh(
        new THREE.CylinderGeometry(barrelRadius * 0.9, barrelRadius * 0.9, spec.len * 0.48, 12),
        mats.gunMetal,
      );
      underTube.rotation.x = Math.PI / 2;
      underTube.position.set(0, recY - 0.008, -spec.len * 0.54);
      g.add(underTube);

      // Animated pump-action forend group!
      const pumpGroup = new THREE.Group();
      pumpGroup.name = 'weapon_pump';
      pumpGroup.position.set(0, recY - 0.008, -spec.len * 0.5);
      const pump = new THREE.Mesh(
        new THREE.CylinderGeometry(spec.width * 0.54, spec.width * 0.52, spec.len * 0.26, 12),
        mats.gunWood,
      );
      pump.rotation.x = Math.PI / 2;
      pumpGroup.add(pump);
      for (const rz of [-0.055, 0, 0.055]) {
        const ring = new THREE.Mesh(
          new THREE.TorusGeometry(spec.width * 0.53, 0.004, 6, 14),
          mats.darkTrim,
        );
        ring.position.z = rz;
        pumpGroup.add(ring);
      }
      g.add(pumpGroup);
    } else if (id === 'rattler') {
      const shroud = new THREE.Mesh(
        new THREE.CylinderGeometry(barrelRadius * 1.7, barrelRadius * 1.7, spec.len * 0.28, 10),
        mats.darkTrim,
      );
      shroud.rotation.x = Math.PI / 2;
      shroud.position.set(0, slideY - 0.004, -spec.len * 0.58);
      g.add(shroud);

      const foreGrip = new THREE.Mesh(
        new THREE.BoxGeometry(spec.width * 0.62, 0.075, 0.032),
        mats.gunPolymer,
      );
      foreGrip.position.set(0, -0.056, -spec.len * 0.52);
      g.add(foreGrip);
    } else if (spec.isLong) {
      const forend = new THREE.Mesh(
        new THREE.BoxGeometry(spec.width * 0.96, recH * 0.58, spec.len * 0.34),
        spec.wood ? mats.gunWood : mats.gunPolymer,
      );
      forend.position.set(0, recY - 0.004, -spec.len * 0.5);
      g.add(forend);

      if (id === 'ironsight') {
        const gasBlock = new THREE.Mesh(
          new THREE.BoxGeometry(spec.width * 0.5, 0.036, 0.032),
          mats.gunMetal,
        );
        gasBlock.position.set(0, slideTopY + 0.01, -spec.len * 0.64);
        g.add(gasBlock);
      } else if (id === 'hammerfall') {
        const carryBar = new THREE.Mesh(
          new THREE.BoxGeometry(0.018, 0.018, 0.16),
          mats.gunMetal,
        );
        carryBar.position.set(0, slideTopY + 0.028, -spec.len * 0.35);
        g.add(carryBar);
        for (const side of [-1, 1]) {
          const leg = new THREE.Mesh(
            new THREE.CylinderGeometry(0.008, 0.008, 0.18, 8),
            mats.darkTrim,
          );
          leg.rotation.x = Math.PI / 2;
          leg.position.set(side * 0.034, recY - 0.018, -spec.len * 0.66);
          g.add(leg);
        }
      }
    }

    // Ergonomic angled grip + trigger guard + trigger
    const grip = new THREE.Mesh(
      new THREE.BoxGeometry(spec.width * 0.78, 0.125, 0.044),
      spec.wood ? mats.gunWood : mats.gunPolymer,
    );
    grip.position.set(0, -0.072, -0.022);
    grip.rotation.x = 0.24;
    g.add(grip);

    const triggerGuardBottom = new THREE.Mesh(
      new THREE.BoxGeometry(spec.width * 0.34, 0.006, 0.056),
      mats.gunMetal,
    );
    triggerGuardBottom.position.set(0, -0.046, -0.072);
    const triggerGuardFront = new THREE.Mesh(
      new THREE.BoxGeometry(spec.width * 0.34, 0.024, 0.007),
      mats.gunMetal,
    );
    triggerGuardFront.position.set(0, -0.035, -0.098);
    g.add(triggerGuardBottom, triggerGuardFront);

    const trigger = new THREE.Mesh(
      new THREE.BoxGeometry(0.008, 0.02, 0.012),
      mats.brushedSteel,
    );
    trigger.position.set(0, -0.03, -0.068);
    trigger.rotation.x = 0.3;
    g.add(trigger);

    // Detachable Magazine or Drum (tagged weapon_mag for reload animation)
    if (spec.hasDrum) {
      const drum = new THREE.Mesh(
        new THREE.CylinderGeometry(0.066, 0.066, 0.088, 16),
        mats.gunMetal,
      );
      drum.rotation.x = Math.PI / 2;
      drum.position.set(0, -0.078, -0.2);
      drum.name = 'weapon_mag';
      g.add(drum);
    } else if (id === 'service_pistol') {
      const pistolMag = new THREE.Mesh(
        new THREE.BoxGeometry(spec.width * 0.56, 0.11, 0.034),
        mats.gunMetal,
      );
      pistolMag.position.set(0, -0.088, -0.025);
      pistolMag.rotation.x = 0.24;
      pistolMag.name = 'weapon_mag';
      g.add(pistolMag);
    } else if (id !== 'hedgerow') {
      const magLen = id === 'rattler' ? 0.15 : 0.13;
      const mag = new THREE.Mesh(
        new THREE.BoxGeometry(spec.width * 0.6, magLen, 0.042),
        mats.gunMetal,
      );
      mag.position.set(0, -0.085, -spec.len * 0.27);
      mag.rotation.x = id === 'ironsight' ? -0.22 : -0.1;
      mag.name = 'weapon_mag';
      g.add(mag);
    }

    // Stock + rubber buttpad for long guns
    if (spec.hasStock) {
      const stock = new THREE.Mesh(
        new THREE.BoxGeometry(spec.width * 0.82, 0.078, 0.22),
        spec.wood ? mats.gunWood : mats.gunPolymer,
      );
      stock.position.set(0, -0.018, 0.07);
      g.add(stock);

      const buttPad = new THREE.Mesh(
        new THREE.BoxGeometry(spec.width * 0.86, 0.086, 0.018),
        mats.gunPolymer,
      );
      buttPad.position.set(0, -0.02, 0.18);
      g.add(buttPad);
    }

    // Sights / Longbow Optics / Phase Cannon Coils & Core
    if (id === 'longbow') {
      const mountA = new THREE.Mesh(new THREE.BoxGeometry(0.022, 0.024, 0.024), mats.gunMetal);
      mountA.position.set(0, slideTopY + 0.011, -0.16);
      const mountB = mountA.clone();
      mountB.position.z = -0.28;
      const scope = new THREE.Mesh(
        new THREE.CylinderGeometry(0.022, 0.025, 0.25, 14),
        mats.gunMetal,
      );
      scope.rotation.x = Math.PI / 2;
      scope.position.set(0, slideTopY + 0.034, -0.22);
      const lens = new THREE.Mesh(new THREE.CircleGeometry(0.019, 12), glassMat);
      lens.position.set(0, slideTopY + 0.034, -0.094);
      g.add(mountA, mountB, scope, lens);
    } else if (spec.isPhase) {
      const coreMat = new THREE.MeshStandardMaterial({
        color: 0x6366f1,
        emissive: 0x818cf8,
        emissiveIntensity: 2.1,
        roughness: 0.15,
      });
      const chamber = new THREE.Mesh(
        new THREE.CylinderGeometry(0.028, 0.028, 0.18, 12),
        coreMat,
      );
      chamber.rotation.x = Math.PI / 2;
      chamber.position.set(0, slideTopY + 0.014, -0.18);
      g.add(chamber);

      for (const cz of [-0.32, -0.4, -0.47]) {
        const coil = new THREE.Mesh(new THREE.TorusGeometry(0.044, 0.009, 8, 18), coreMat);
        coil.position.set(0, slideY, cz);
        g.add(coil);
      }
      for (const side of [-1, 1]) {
        const railFin = new THREE.Mesh(
          new THREE.BoxGeometry(0.012, 0.048, 0.28),
          mats.brushedSteel,
        );
        railFin.position.set(side * (spec.width * 0.56), slideY, -0.34);
        g.add(railFin);
      }
    } else if (id !== 'service_pistol') {
      const rearSight = new THREE.Mesh(new THREE.BoxGeometry(0.024, 0.014, 0.016), mats.gunMetal);
      rearSight.position.set(0, slideTopY + 0.007, -spec.len * 0.02);
      const frontPost = new THREE.Mesh(new THREE.BoxGeometry(0.007, 0.016, 0.012), mats.gunMetal);
      frontPost.position.set(0, slideTopY + 0.007, -spec.len * 0.51);
      g.add(rearSight, frontPost);

      const frontDot = new THREE.Mesh(new THREE.BoxGeometry(0.004, 0.004, 0.004), tritiumMat);
      frontDot.position.set(0, slideTopY + 0.012, -spec.len * 0.503);
      const rearDotL = new THREE.Mesh(new THREE.BoxGeometry(0.003, 0.004, 0.004), tritiumMat);
      rearDotL.position.set(-0.007, slideTopY + 0.011, -spec.len * 0.012);
      const rearDotR = rearDotL.clone();
      rearDotR.position.x = 0.007;
      g.add(frontDot, rearDotL, rearDotR);
    }

    // Overclock emissive rail
    const ocAccent = new THREE.Mesh(
      new THREE.BoxGeometry(spec.width + 0.006, 0.009, spec.len * 0.42),
      accentMat,
    );
    ocAccent.name = 'overclock_accent';
    ocAccent.position.set(0, slideTopY + 0.002, -spec.len * 0.24);
    ocAccent.visible = false;
    g.add(ocAccent);

    return g;
  }

  public reset(): void {
    this.slots = [this.createSlotState('service_pistol', false)];
    this.activeSlot = 0;
    this.isReloading = false;
    this.reloadTimer = 0;
    this.fireCooldown = 0;
    this.swapTimer = 0;
    this.inspectTimer = 0;
    this.slideKick = 0;
    this.pumpTimer = 0;
    this.lookSwayX = 0;
    this.lookSwayY = 0;
    this.recoilOffsetZ = 0;
    this.recoilOffsetPitch = 0;
    this.recoilBloom = 0;
    this.activeGrenades.forEach((g) => {
      this.scene.remove(g.mesh);
      this.physics.removeGrenadeBody(g.rb.id);
    });
    this.activeGrenades.length = 0;
    this.syncVisibleViewmodel();
  }

  public addLookSway(dx: number, dy: number): void {
    this.lookSwayX = THREE.MathUtils.clamp(this.lookSwayX - dx * 0.00024, -0.028, 0.028);
    this.lookSwayY = THREE.MathUtils.clamp(this.lookSwayY + dy * 0.0002, -0.022, 0.022);
  }

  public triggerInspect(): void {
    if (this.isReloading || this.swapTimer > 0) return;
    this.inspectTimer = this.inspectDuration;
  }

  public createSlotState(id: WeaponId, upgraded: boolean): WeaponSlotState {
    const cfg = BALANCE.weapons[id];
    const magSize = upgraded ? Math.round(cfg.magSize * BALANCE.overclock.magMult) : cfg.magSize;
    const reserveMax = upgraded
      ? Math.round(cfg.reserveMax * BALANCE.overclock.magMult)
      : cfg.reserveMax;
    return {
      id,
      name: upgraded ? cfg.upgradedName : cfg.name,
      mag: magSize,
      magSize,
      reserve: reserveMax,
      reserveMax,
      upgraded,
    };
  }

  public getActiveWeapon(): WeaponSlotState {
    return this.slots[this.activeSlot] ?? this.slots[0]!;
  }

  public getActiveConfig(): WeaponConfig {
    return BALANCE.weapons[this.getActiveWeapon().id];
  }

  public getCrosshairSpread(player: PlayerController): number {
    const cfg = this.getActiveConfig();
    const base = player.isAds ? cfg.spreadAds : cfg.spreadHip;
    const moveSpeed = Math.hypot(player.velocity.x, player.velocity.z);
    const moveFactor = Math.min(1, moveSpeed / BALANCE.player.sprintSpeed);
    const sprintBoost = player.isSprinting ? 0.45 : moveFactor * 0.2;
    const crouchTighten = player.isCrouching ? 0.72 : 1.0;
    const normalized = Math.min(1, base * 11 * crouchTighten + sprintBoost + this.recoilBloom);
    return Number(normalized.toFixed(3));
  }

  public giveWeapon(id: WeaponId, upgraded = false): void {
    this.inspectTimer = 0;
    const existingIdx = this.slots.findIndex((s) => s.id === id);
    if (existingIdx !== -1) {
      const s = this.slots[existingIdx]!;
      s.mag = s.magSize;
      s.reserve = s.reserveMax;
      this.activeSlot = existingIdx;
      this.isReloading = false;
      this.syncVisibleViewmodel();
      return;
    }

    const next = this.createSlotState(id, upgraded);
    if (this.slots.length < 2) {
      this.slots.push(next);
      this.activeSlot = this.slots.length - 1;
    } else {
      this.slots[this.activeSlot] = next;
    }
    this.isReloading = false;
    this.swapTimer = 0.25;
    this.syncVisibleViewmodel();
  }

  public upgradeActiveWeapon(): void {
    const slot = this.getActiveWeapon();
    if (slot.upgraded) return;
    const upgraded = this.createSlotState(slot.id, true);
    this.slots[this.activeSlot] = upgraded;
    this.isReloading = false;
    this.inspectTimer = this.inspectDuration * 0.85;
    this.syncVisibleViewmodel();
  }

  public refillAllAmmo(): void {
    for (const s of this.slots) {
      s.mag = s.magSize;
      s.reserve = s.reserveMax;
    }
    this.isReloading = false;
  }

  public refillWeaponAmmo(id: WeaponId): boolean {
    const s = this.slots.find((slot) => slot.id === id);
    if (!s) return false;
    s.reserve = s.reserveMax;
    return true;
  }

  public hasWeapon(id: WeaponId): boolean {
    return this.slots.some((s) => s.id === id);
  }

  public syncVisibleViewmodel(): void {
    const active = this.getActiveWeapon();
    for (const [id, grp] of this.weaponModels) {
      grp.visible = id === active.id;
      const accent = grp.getObjectByName('overclock_accent') as THREE.Mesh | undefined;
      if (accent) {
        accent.visible = active.upgraded;
      }
    }
  }

  private buildAllViewmodels(): void {
    const sleeveMat = new THREE.MeshStandardMaterial({ color: 0x2c3630, roughness: 0.84 });
    const cuffMat = new THREE.MeshStandardMaterial({ color: 0x1d2420, roughness: 0.9 });
    const gloveMat = new THREE.MeshStandardMaterial({ color: 0x1b1c1f, roughness: 0.68 });
    const knuckleMat = new THREE.MeshStandardMaterial({ color: 0x2a2c31, roughness: 0.45, metalness: 0.25 });
    const watchFaceMat = new THREE.MeshStandardMaterial({
      color: 0x0f172a,
      emissive: 0x22c55e,
      emissiveIntensity: 0.45,
      roughness: 0.2,
    });

    (Object.keys(WEAPON_SPECS) as WeaponId[]).forEach((id) => {
      const spec = WEAPON_SPECS[id];
      const g = WeaponSystem.buildWeaponShowcaseModel(id, this.mats);

      const magObj = g.getObjectByName('weapon_mag');
      if (magObj) {
        this.weaponMags.set(id, { mesh: magObj, baseY: magObj.position.y });
      }
      const slideObj = g.getObjectByName('weapon_slide');
      if (slideObj) {
        this.weaponSlides.set(id, { mesh: slideObj, baseZ: slideObj.position.z });
      }
      const pumpObj = g.getObjectByName('weapon_pump');
      if (pumpObj) {
        this.weaponPumps.set(id, { mesh: pumpObj, baseZ: pumpObj.position.z });
      }

      // Articulated Right Forearm, Cuff, Tactical Watch & Gloved Trigger Hand
      const rightGroup = new THREE.Group();
      const rightArm = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.043, 0.3, 12), sleeveMat);
      rightArm.rotation.set(Math.PI / 2 - 0.22, 0, -0.2);
      rightArm.position.set(0.052, -0.105, 0.14);
      rightGroup.add(rightArm);

      const cuff = new THREE.Mesh(new THREE.CylinderGeometry(0.037, 0.038, 0.032, 12), cuffMat);
      cuff.rotation.set(Math.PI / 2 - 0.22, 0, -0.2);
      cuff.position.set(0.025, -0.088, 0.025);
      rightGroup.add(cuff);

      const rHand = createGlovedHand(gloveMat, knuckleMat, 'grip');
      rHand.position.set(0, -0.068, -0.015);
      rightGroup.add(rHand);
      g.add(rightGroup);

      // Articulated Left Support Arm
      const leftArmGroup = new THREE.Group();
      const isPistolLike = !spec.isLong && !spec.isPhase && id !== 'rattler';
      const restGripPos = isPistolLike
        ? new THREE.Vector3(-0.022, -0.092, 0.006)
        : id === 'rattler'
          ? new THREE.Vector3(-0.015, -0.05, -spec.len * 0.48)
          : new THREE.Vector3(-0.014, -0.024, -spec.len * 0.49);

      leftArmGroup.position.copy(restGripPos);
      const restRot = new THREE.Euler(0, isPistolLike ? 0.35 : 0, 0);
      leftArmGroup.rotation.copy(restRot);

      const lHand = createGlovedHand(gloveMat, knuckleMat, isPistolLike ? 'grip' : 'cradle');
      leftArmGroup.add(lHand);

      // Wristwatch & sleeve extending diagonally back toward left shoulder
      const lCuff = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.037, 0.034, 12), cuffMat);
      lCuff.position.set(-0.04, -0.045, 0.075);
      lCuff.rotation.set(Math.PI / 2 - 0.38, 0.35, 0.2);
      leftArmGroup.add(lCuff);

      const watch = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.01, 10), this.mats.brushedSteel);
      watch.position.set(-0.026, -0.018, 0.065);
      watch.rotation.z = 0.7;
      const dial = new THREE.Mesh(new THREE.CircleGeometry(0.011, 10), watchFaceMat);
      dial.position.set(-0.031, -0.014, 0.065);
      dial.rotation.y = -Math.PI / 2;
      leftArmGroup.add(watch, dial);

      const sleeve = new THREE.Mesh(new THREE.CylinderGeometry(0.034, 0.042, 0.34, 12), sleeveMat);
      sleeve.position.set(-0.115, -0.115, 0.21);
      sleeve.rotation.set(Math.PI / 2 - 0.38, 0.36, 0.2);
      leftArmGroup.add(sleeve);

      g.add(leftArmGroup);

      const magAnchor = magObj
        ? new THREE.Vector3(magObj.position.x - 0.02, magObj.position.y - 0.02, magObj.position.z + 0.02)
        : new THREE.Vector3(-0.015, -0.05, -spec.len * 0.32);
      const rackAnchor = new THREE.Vector3(-0.03, 0.035, -spec.len * 0.16);

      this.leftArms.set(id, {
        group: leftArmGroup,
        restPos: restGripPos.clone(),
        restRot,
        magPos: magAnchor,
        rackPos: rackAnchor,
      });

      // Muzzle flash sprite + crossed star flash planes at barrel crown
      const muzzlePos = new THREE.Vector3(0, spec.height * 0.28, -spec.len * 0.9);
      const flashColor = spec.isPhase ? 0x818cf8 : 0xffd28a;
      const mfMat = new THREE.SpriteMaterial({
        map: this.mats.muzzleFlashTex,
        color: flashColor,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });
      const mf = new THREE.Sprite(mfMat);
      mf.position.copy(muzzlePos);
      mf.scale.set(0.26, 0.26, 0.26);
      g.add(mf);

      const crossGrp = new THREE.Group();
      crossGrp.position.copy(muzzlePos);
      const crossMat = new THREE.MeshBasicMaterial({
        map: this.mats.muzzleFlashTex,
        color: flashColor,
        transparent: true,
        opacity: 0.9,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
      });
      const planeA = new THREE.Mesh(new THREE.PlaneGeometry(0.18, 0.26), crossMat);
      planeA.rotation.x = Math.PI / 2;
      const planeB = planeA.clone();
      planeB.rotation.z = Math.PI / 2;
      crossGrp.add(planeA, planeB);
      crossGrp.visible = false;
      g.add(crossGrp);

      this.muzzleSprites.set(id, mf);
      this.muzzleCrosses.set(id, crossGrp);
      this.weaponModels.set(id, g);
      this.weaponPivot.add(g);
    });

    // Combat Bowie Knife Viewmodel with Forearm Sleeve + Cuff + Gloved Hand
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.008, 0.038, 0.22), this.mats.brushedSteel);
    blade.position.set(0, 0, -0.14);
    const bladeEdge = new THREE.Mesh(new THREE.BoxGeometry(0.003, 0.01, 0.21), this.mats.gunMetal);
    bladeEdge.position.set(0, 0.018, -0.135);
    const bladeTip = new THREE.Mesh(new THREE.ConeGeometry(0.019, 0.065, 4), this.mats.brushedSteel);
    bladeTip.rotation.x = -Math.PI / 2;
    bladeTip.rotation.z = Math.PI / 4;
    bladeTip.position.set(0, 0, -0.275);
    const guard = new THREE.Mesh(new THREE.BoxGeometry(0.018, 0.068, 0.016), this.mats.gunBrass);
    guard.position.set(0, 0, -0.03);
    const kHandle = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.018, 0.12, 10), this.mats.gunWood);
    kHandle.rotation.x = Math.PI / 2;
    kHandle.position.set(0, 0, 0.035);
    const kHand = createGlovedHand(gloveMat, knuckleMat, 'knife');
    kHand.position.set(0, -0.004, 0.035);
    const kArm = new THREE.Mesh(new THREE.CylinderGeometry(0.034, 0.042, 0.28, 10), sleeveMat);
    kArm.rotation.set(Math.PI / 2 - 0.15, 0, -0.18);
    kArm.position.set(0.038, -0.035, 0.17);
    this.knifeGroup.add(blade, bladeEdge, bladeTip, guard, kHandle, kHand, kArm);
    this.knifeGroup.visible = false;
    this.viewmodelRoot.add(this.knifeGroup);

    // Perk Drink Glass Bottle Viewmodel + Forearm & Glove
    const outerGlassMat = new THREE.MeshStandardMaterial({
      color: 0x1e2924,
      roughness: 0.12,
      metalness: 0.25,
      transparent: true,
      opacity: 0.74,
    });
    const labelMat = new THREE.MeshStandardMaterial({ color: 0xe6dec8, roughness: 0.85 });
    const glassBody = new THREE.Mesh(new THREE.CylinderGeometry(0.034, 0.036, 0.17, 14), outerGlassMat);
    const innerLiquid = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.03, 0.14, 12), this.bottleLiquidMat);
    const bottleLabel = new THREE.Mesh(new THREE.CylinderGeometry(0.0355, 0.0355, 0.072, 14), labelMat);
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.028, 0.065, 12), outerGlassMat);
    neck.position.y = 0.115;
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.014, 12), this.mats.brushedSteel);
    cap.position.y = 0.15;
    const bHand = createGlovedHand(gloveMat, knuckleMat, 'grip');
    bHand.position.set(0.01, -0.02, 0.01);
    const bArm = new THREE.Mesh(new THREE.CylinderGeometry(0.034, 0.042, 0.28, 10), sleeveMat);
    bArm.rotation.set(Math.PI / 2 - 0.25, 0, -0.25);
    bArm.position.set(0.06, -0.09, 0.14);
    this.bottleGroup.add(glassBody, innerLiquid, bottleLabel, neck, cap, bHand, bArm);
    this.bottleGroup.position.set(0.05, -0.18, -0.35);
    this.bottleGroup.visible = false;
    this.viewmodelRoot.add(this.bottleGroup);
  }

  private buildGrenadeMesh(): THREE.Group {
    if (!this.grenadeAssets) {
      this.grenadeAssets = {
        bodyGeo: new THREE.SphereGeometry(0.088, 12, 10),
        bandGeo: new THREE.CylinderGeometry(0.082, 0.082, 0.026, 12),
        collarGeo: new THREE.CylinderGeometry(0.026, 0.032, 0.045, 10),
        spoonGeo: new THREE.BoxGeometry(0.018, 0.1, 0.01),
        ringGeo: new THREE.TorusGeometry(0.024, 0.004, 6, 12),
        castIronMat: new THREE.MeshStandardMaterial({
          color: 0x384534,
          roughness: 0.68,
          metalness: 0.45,
        }),
        ringMat: new THREE.MeshStandardMaterial({
          color: 0xeab308,
          metalness: 0.85,
          roughness: 0.25,
        }),
      };
    }
    const assets = this.grenadeAssets;
    const grp = new THREE.Group();

    const body = new THREE.Mesh(assets.bodyGeo, assets.castIronMat);
    body.scale.set(0.88, 1.18, 0.88);
    grp.add(body);

    const band = new THREE.Mesh(assets.bandGeo, this.mats.darkTrim);
    grp.add(band);

    const fuseCollar = new THREE.Mesh(assets.collarGeo, this.mats.brushedSteel);
    fuseCollar.position.y = 0.11;
    grp.add(fuseCollar);

    const spoon = new THREE.Mesh(assets.spoonGeo, this.mats.brushedSteel);
    spoon.position.set(0.045, 0.075, 0);
    spoon.rotation.z = -0.24;
    grp.add(spoon);

    const pinRing = new THREE.Mesh(assets.ringGeo, assets.ringMat);
    pinRing.position.set(-0.035, 0.12, 0);
    grp.add(pinRing);

    return grp;
  }

  private allocatePools(): void {
    // 2 pooled dynamic muzzle lights
    for (let i = 0; i < BALANCE.perf.maxDynamicMuzzleLights; i++) {
      const light = new THREE.PointLight(0xffb454, 0, 9, 2);
      this.scene.add(light);
      this.muzzleLights.push({ light, timer: 0 });
    }

    // Pooled impact & blood particles
    const pGeo = new THREE.BoxGeometry(0.048, 0.048, 0.048);
    for (let i = 0; i < BALANCE.perf.maxParticles; i++) {
      const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9 });
      const mesh = new THREE.Mesh(pGeo, mat);
      mesh.visible = false;
      this.scene.add(mesh);
      this.particles.push({
        mesh,
        vx: 0,
        vy: 0,
        vz: 0,
        rx: 0,
        ry: 0,
        rz: 0,
        life: 0,
        maxLife: 0.5,
        gravity: 9.8,
        startScale: 1,
        endScale: 0.65,
        baseOpacity: 0.95,
        bounce: true,
        active: false,
      });
    }

    // Pooled spinning 3D brass shell casings
    const shellGeo = new THREE.CylinderGeometry(0.008, 0.008, 0.032, 7);
    shellGeo.rotateX(Math.PI / 2);
    for (let i = 0; i < 20; i++) {
      const mesh = new THREE.Mesh(shellGeo, this.mats.gunBrass);
      mesh.visible = false;
      this.scene.add(mesh);
      this.shellPool.push({
        mesh,
        vx: 0,
        vy: 0,
        vz: 0,
        rx: 0,
        ry: 0,
        rz: 0,
        life: 0,
        maxLife: 0.85,
        gravity: 11.0,
        startScale: 1,
        endScale: 1,
        baseOpacity: 1,
        bounce: true,
        active: false,
      });
    }

    // Pooled barrel muzzle smoke puffs
    const smokeGeo = new THREE.DodecahedronGeometry(0.08, 0);
    for (let i = 0; i < 18; i++) {
      const mat = new THREE.MeshBasicMaterial({
        color: 0xb0b8b4,
        transparent: true,
        opacity: 0.35,
        depthWrite: false,
      });
      const mesh = new THREE.Mesh(smokeGeo, mat);
      mesh.visible = false;
      this.scene.add(mesh);
      this.smokePool.push({
        mesh,
        vx: 0,
        vy: 0,
        vz: 0,
        rx: 0,
        ry: 0,
        rz: 0,
        life: 0,
        maxLife: 0.55,
        gravity: -0.45,
        startScale: 0.45,
        endScale: 2.3,
        baseOpacity: 0.36,
        bounce: false,
        active: false,
      });
    }

    // Pooled tracers
    const tGeo = new THREE.BoxGeometry(0.018, 0.018, 1);
    for (let i = 0; i < 24; i++) {
      const mat = new THREE.MeshBasicMaterial({
        color: 0xffd27a,
        transparent: true,
        opacity: 0.85,
      });
      const line = new THREE.Mesh(tGeo, mat);
      line.visible = false;
      this.scene.add(line);
      this.tracers.push({ line, life: 0, active: false });
    }

    // Pooled explosion shockwave rings
    const swGeo = new THREE.RingGeometry(0.85, 1.0, 24);
    swGeo.rotateX(-Math.PI / 2);
    for (let i = 0; i < 6; i++) {
      const mat = new THREE.MeshBasicMaterial({
        color: 0xf97316,
        transparent: true,
        opacity: 0.85,
        side: THREE.DoubleSide,
        depthWrite: false,
      });
      const mesh = new THREE.Mesh(swGeo, mat);
      mesh.visible = false;
      this.scene.add(mesh);
      this.shockwaves.push({ mesh, life: 0, maxLife: 0.35, maxRadius: 4.5, active: false });
    }

    // Pooled decals (bullet holes, blood & scorch)
    const dGeo = new THREE.PlaneGeometry(0.24, 0.24);
    for (let i = 0; i < BALANCE.perf.maxDecals; i++) {
      const mat = new THREE.MeshBasicMaterial({
        map: this.mats.bulletHoleTex,
        transparent: true,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -2,
      });
      const decal = new THREE.Mesh(dGeo, mat);
      decal.visible = false;
      this.scene.add(decal);
      this.decals.push(decal);
    }

    // Phase Cannon energy bolts
    this.phaseLight = new THREE.PointLight(0x818cf8, 0, 7, 1.8);
    this.scene.add(this.phaseLight);
    const coreGeo = new THREE.SphereGeometry(0.11, 10, 10);
    const haloGeo = new THREE.SphereGeometry(0.2, 10, 10);
    for (let i = 0; i < 8; i++) {
      const boltGroup = new THREE.Group();
      const core = new THREE.Mesh(coreGeo, new THREE.MeshBasicMaterial({ color: 0xe0e7ff }));
      const halo = new THREE.Mesh(
        haloGeo,
        new THREE.MeshBasicMaterial({
          color: 0x6366f1,
          transparent: true,
          opacity: 0.45,
          depthWrite: false,
        }),
      );
      boltGroup.add(core, halo);
      boltGroup.visible = false;
      this.scene.add(boltGroup);
      this.phaseBolts.push({
        mesh: boltGroup,
        pos: new THREE.Vector3(),
        vel: new THREE.Vector3(),
        life: 0,
        upgraded: false,
        active: false,
      });
    }
  }

  public update(
    dt: number,
    player: PlayerController,
    input: PlayerInputState,
    perks: Set<PerkId>,
    activePowerUps: { instaKill: boolean },
    round: number,
    callbacks: ShotCallbacks,
  ): void {
    this.fireCooldown = Math.max(0, this.fireCooldown - dt);
    this.swapTimer = Math.max(0, this.swapTimer - dt);
    this.muzzleFlashTimer = Math.max(0, this.muzzleFlashTimer - dt);
    this.pumpTimer = Math.max(0, this.pumpTimer - dt);
    this.inspectTimer = Math.max(0, this.inspectTimer - dt);

    for (const ml of this.muzzleLights) {
      if (ml.timer > 0) {
        ml.timer -= dt;
        if (ml.timer <= 0) ml.light.intensity = 0;
      }
    }

    if (!input.fireHeld) {
      this.semiTriggerConsumed = false;
    }

    if (player.isAds || player.isSprinting || this.isReloading || input.fireHeld) {
      this.inspectTimer = 0;
    }

    const active = this.getActiveWeapon();
    const cfg = BALANCE.weapons[active.id];

    // Swap weapon
    if (input.swapPressed && this.slots.length > 1 && this.swapTimer <= 0 && !player.isReviving) {
      this.activeSlot = (this.activeSlot + 1) % this.slots.length;
      this.isReloading = false;
      this.inspectTimer = 0;
      this.pumpTimer = 0;
      const nextCfg = this.getActiveConfig();
      const speedMult = perks.has('quickhands') ? 2.0 : 1.0;
      this.swapTimer = nextCfg.swapTime / speedMult;
      this.syncVisibleViewmodel();
    }

    // Start reload
    if (
      input.reloadPressed &&
      !this.isReloading &&
      active.mag < active.magSize &&
      active.reserve > 0 &&
      this.swapTimer <= 0 &&
      !player.isReviving
    ) {
      this.beginReload(active, cfg, perks);
    }

    // Update reload progress
    if (this.isReloading) {
      this.reloadTimer += dt;
      const frac = this.reloadTimer / this.reloadDuration;
      if (!this.reloadCueInPlayed && frac > 0.45) {
        this.reloadCueInPlayed = true;
        this.audio.playReloadCue('in');
      }
      if (!this.reloadCueRackPlayed && frac > 0.78) {
        this.reloadCueRackPlayed = true;
        this.audio.playReloadCue('rack');
      }
      if (this.reloadTimer >= this.reloadDuration) {
        const needed = active.magSize - active.mag;
        const take = Math.min(needed, active.reserve);
        active.mag += take;
        active.reserve -= take;
        this.isReloading = false;
      }
    }

    // Melee knife
    if (input.meleePressed && player.meleeCooldown <= 0 && !player.isReviving) {
      player.meleeCooldown = BALANCE.player.knifeCooldown;
      player.knifeAnimTimer = 0.3;
      player.applyKnifeLunge(player.yaw);
      this.isReloading = false;
      this.inspectTimer = 0;
      this.audio.playMeleeSwing();

      this.camera.getWorldPosition(this.tmpOrigin);
      this.camera.getWorldDirection(this.tmpDir);
      const wallHit = this.bvh.raycast(this.tmpOrigin, this.tmpDir, BALANCE.player.knifeRange);
      const maxMeleeDist = wallHit ? wallHit.distance : BALANCE.player.knifeRange;
      const hit =
        this.zombies.raycastShot(this.tmpOrigin, this.tmpDir, maxMeleeDist) ??
        this.zombies.raycastMeleeCone(this.tmpOrigin, this.tmpDir, maxMeleeDist + 0.35, 0.55);
      if (hit) {
        const dmg =
          BALANCE.player.knifeDamageBase +
          Math.max(0, round - 1) * BALANCE.player.knifeDamagePerRoundStep;
        const res = this.zombies.applyDamageToEntity(
          hit.poolIdx,
          dmg,
          'torso',
          this.tmpDir.x,
          this.tmpDir.z,
          activePowerUps.instaKill,
        );
        this.spawnParticles(hit.point, 0x8b1111, 10, 3.2);
        callbacks.onHitMarker(res.killed ? 'kill' : 'hit');
        this.audio.playHitMarker(false);
        if (res.killed) {
          callbacks.onPoints(BALANCE.economy.meleeKillPoints, 'Melee Kill');
          callbacks.onKillEnemy(res.enemyType, res.x, res.y, res.z, false, true, false);
          callbacks.onHitStop();
          if (res.explodedBloater) callbacks.onBloaterExplode(res.x, res.y, res.z);
        } else {
          callbacks.onPoints(BALANCE.economy.hitPoints, 'Hit');
        }
      }
    }

    // Throw composite frag grenade
    if (input.grenadePressed && player.grenades > 0 && !player.isReviving) {
      player.grenades--;
      this.camera.getWorldPosition(this.tmpOrigin);
      this.camera.getWorldDirection(this.tmpDir);
      const spawnP = this.tmpOrigin.clone().addScaledVector(this.tmpDir, 0.55);
      const vx = this.tmpDir.x * BALANCE.player.grenadeThrowSpeed;
      const vy = this.tmpDir.y * BALANCE.player.grenadeThrowSpeed + 3.5;
      const vz = this.tmpDir.z * BALANCE.player.grenadeThrowSpeed;
      const rb = this.physics.spawnGrenadeBody(spawnP.x, spawnP.y, spawnP.z, vx, vy, vz);
      const mesh = this.buildGrenadeMesh();
      mesh.position.copy(spawnP);
      this.scene.add(mesh);
      this.activeGrenades.push({ rb, mesh, fuse: BALANCE.player.grenadeFuse });
    }

    // Fire weapon
    const canFireMode =
      cfg.fireMode === 'auto'
        ? input.fireHeld
        : input.firePressed || (input.fireHeld && !this.semiTriggerConsumed);

    if (
      canFireMode &&
      !this.isReloading &&
      this.swapTimer <= 0 &&
      this.fireCooldown <= 0 &&
      !player.isSprinting &&
      !player.isReviving &&
      player.drinkAnimTimer <= 0
    ) {
      if (cfg.fireMode !== 'auto') {
        this.semiTriggerConsumed = true;
      }

      if (active.mag <= 0) {
        this.audio.playDryFire();
        this.fireCooldown = 0.22;
        if (active.reserve > 0) {
          this.beginReload(active, cfg, perks);
        }
      } else {
        this.fireWeapon(active, cfg, player, perks, activePowerUps.instaKill, callbacks);
      }
    }

    this.updateViewmodelTransform(dt, player, cfg);
    this.updateParticlesAndProjectiles(dt, activePowerUps.instaKill, callbacks);
  }

  private beginReload(active: WeaponSlotState, cfg: WeaponConfig, perks: Set<PerkId>): void {
    this.isReloading = true;
    this.inspectTimer = 0;
    this.reloadTimer = 0;
    this.reloadCueInPlayed = false;
    this.reloadCueRackPlayed = false;
    const baseDur = active.mag === 0 ? cfg.emptyReloadTime : cfg.reloadTime;
    const quickMult = perks.has('quickhands') ? 2.0 : 1.0;
    const ocMult = active.upgraded ? BALANCE.overclock.reloadSpeedMult : 1.0;
    this.reloadDuration = baseDur / (quickMult * ocMult);
    this.audio.playReloadCue('out');
  }

  private fireWeapon(
    active: WeaponSlotState,
    cfg: WeaponConfig,
    player: PlayerController,
    perks: Set<PerkId>,
    instaKill: boolean,
    callbacks: ShotCallbacks,
  ): void {
    active.mag--;
    const twinMult = perks.has('twin_barrel') ? 1.33 : 1.0;
    const effectiveRpm = cfg.rpm * twinMult;
    this.fireCooldown = 60 / effectiveRpm;

    this.audio.playGunshot(active.id, active.upgraded);
    player.addRecoil(
      cfg.recoilPitch * (player.isAds ? 0.68 : 1.0),
      (Math.random() - 0.5) * cfg.recoilYaw * 2,
      cfg.cameraKick,
    );
    this.recoilOffsetZ = Math.min(0.092, this.recoilOffsetZ + 0.06);
    this.recoilOffsetPitch = Math.min(0.28, this.recoilOffsetPitch + 0.135);
    this.recoilBloom = Math.min(0.75, this.recoilBloom + (player.isAds ? 0.14 : 0.28));
    this.slideKick = 0.044;
    if (active.id === 'hedgerow') {
      this.pumpTimer = Math.min(0.55, this.fireCooldown * 0.85);
    }
    this.muzzleFlashTimer = 0.058;

    // Pooled dynamic muzzle light (max 2)
    const ml = this.muzzleLights[this.muzzleLightCursor]!;
    this.muzzleLightCursor = (this.muzzleLightCursor + 1) % this.muzzleLights.length;
    this.camera.getWorldPosition(this.tmpOrigin);
    this.camera.getWorldDirection(this.tmpDir);
    this.tmpRight.set(1, 0, 0).applyQuaternion(this.camera.quaternion).normalize();
    this.tmpUp.set(0, 1, 0).applyQuaternion(this.camera.quaternion).normalize();

    ml.light.position.copy(this.tmpOrigin).addScaledVector(this.tmpDir, 0.75);
    ml.light.color.setHex(active.id === 'phase_cannon' ? 0x818cf8 : 0xffb85c);
    ml.light.intensity = 3.2;
    ml.timer = 0.05;

    // Spinning 3D brass shell ejection + barrel smoke puff
    if (active.id !== 'phase_cannon') {
      const ejectPos = this.tmpOrigin
        .clone()
        .addScaledVector(this.tmpDir, 0.38)
        .addScaledVector(this.tmpRight, 0.19)
        .addScaledVector(this.tmpUp, -0.09);
      this.spawnShellCasing(ejectPos, this.tmpRight, this.tmpUp, this.tmpDir);
    }
    const muzzleSmokePos = this.tmpOrigin
      .clone()
      .addScaledVector(this.tmpDir, 0.85)
      .addScaledVector(this.tmpRight, player.isAds ? 0 : 0.12)
      .addScaledVector(this.tmpUp, -0.06);
    this.spawnSmokePuff(muzzleSmokePos, this.tmpDir);

    // Phase Cannon fires slow energy bolt
    if (cfg.fireMode === 'projectile') {
      const bolt = this.phaseBolts.find((b) => !b.active);
      if (bolt) {
        bolt.active = true;
        bolt.life = 4.0;
        bolt.upgraded = active.upgraded;
        bolt.pos.copy(this.tmpOrigin).addScaledVector(this.tmpDir, 0.2);
        bolt.vel.copy(this.tmpDir).multiplyScalar(cfg.projectileSpeed);
        bolt.mesh.position.copy(bolt.pos);
        bolt.mesh.visible = true;
        this.phaseLight.position.copy(bolt.pos);
        this.phaseLight.intensity = 2.8;
      }
      callbacks.onShotStats(true, false);
      return;
    }

    // Hitscan pellets
    const spread = player.isAds ? cfg.spreadAds : cfg.spreadHip;
    const baseDamage =
      cfg.damage *
      (active.upgraded ? BALANCE.overclock.damageMult : 1.0) *
      twinMult;

    let anyHit = false;
    let bestMarker: 'none' | 'hit' | 'kill' | 'headshot' = 'none';
    let anyHeadshot = false;
    let anyKill = false;

    for (let p = 0; p < cfg.pellets; p++) {
      const sx = (Math.random() - 0.5) * spread * 2;
      const sy = (Math.random() - 0.5) * spread * 2;
      const shotDir = this.tmpDir
        .clone()
        .addScaledVector(this.tmpRight, sx)
        .addScaledVector(this.tmpUp, sy)
        .normalize();

      const worldHit = this.bvh.raycast(this.tmpOrigin, shotDir, 120);
      const maxZDist = worldHit ? worldHit.distance : 120;
      const zHit = this.zombies.raycastShot(this.tmpOrigin, shotDir, maxZDist);

      if (zHit) {
        anyHit = true;
        const zoneMult = this.getZoneMultiplier(cfg, zHit.hitZone);
        const falloff = this.computeFalloff(cfg, zHit.distance);
        const dmg = baseDamage * zoneMult * falloff;
        const res = this.zombies.applyDamageToEntity(
          zHit.poolIdx,
          dmg,
          zHit.hitZone,
          shotDir.x,
          shotDir.z,
          instaKill,
        );

        const isHeadHit = zHit.hitZone === 'head';
        this.spawnParticles(zHit.point, isHeadHit ? 0xb91c1c : 0x8b1111, isHeadHit ? 14 : 7, isHeadHit ? 3.8 : 2.8);
        if (isHeadHit) anyHeadshot = true;

        if (res.killed) {
          anyKill = true;
          const isHs = zHit.hitZone === 'head';
          bestMarker = isHs ? 'headshot' : 'kill';
          callbacks.onPoints(
            isHs ? BALANCE.economy.headshotKillPoints : BALANCE.economy.bodyKillPoints,
            isHs ? 'Headshot' : 'Kill',
          );
          callbacks.onKillEnemy(res.enemyType, res.x, res.y, res.z, isHs, false, false);
          if (res.explodedBloater) callbacks.onBloaterExplode(res.x, res.y, res.z);
        } else {
          if (bestMarker === 'none') bestMarker = 'hit';
          callbacks.onPoints(BALANCE.economy.hitPoints, 'Hit');
        }

        if (cfg.hasTracer && p === 0) {
          this.spawnTracer(
            this.tmpOrigin,
            zHit.point,
            active.upgraded ? cfg.upgradedTracerColor : cfg.tracerColor,
          );
        }
      } else if (worldHit) {
        this.spawnImpactBySurface(worldHit.point, worldHit.normal, worldHit.surface);
        this.spawnDecal(worldHit.point, worldHit.normal, 'bullet');
        this.audio.playSurfaceImpact(worldHit.surface, worldHit.point.x, worldHit.point.y, worldHit.point.z);
        if (cfg.hasTracer && p === 0) {
          this.spawnTracer(
            this.tmpOrigin,
            worldHit.point,
            active.upgraded ? cfg.upgradedTracerColor : cfg.tracerColor,
          );
        }
      } else if (cfg.hasTracer && p === 0) {
        const end = this.tmpOrigin.clone().addScaledVector(shotDir, 60);
        this.spawnTracer(
          this.tmpOrigin,
          end,
          active.upgraded ? cfg.upgradedTracerColor : cfg.tracerColor,
        );
      }
    }

    callbacks.onShotStats(true, anyHit);
    if (bestMarker !== 'none') {
      callbacks.onHitMarker(bestMarker);
      this.audio.playHitMarker(anyHeadshot);
    }
    if (anyKill) {
      callbacks.onHitStop();
    }
  }

  private getZoneMultiplier(cfg: WeaponConfig, zone: HitZone): number {
    if (zone === 'head') return cfg.headshotMult;
    if (zone === 'limb') return cfg.limbMult;
    return cfg.torsoMult;
  }

  private computeFalloff(cfg: WeaponConfig, dist: number): number {
    if (dist <= cfg.falloffStart) return 1.0;
    if (dist >= cfg.falloffEnd) return cfg.falloffMinMult;
    const t = (dist - cfg.falloffStart) / (cfg.falloffEnd - cfg.falloffStart);
    return THREE.MathUtils.lerp(1.0, cfg.falloffMinMult, t);
  }

  private updateViewmodelTransform(
    dt: number,
    player: PlayerController,
    cfg: WeaponConfig,
  ): void {
    this.recoilOffsetZ = THREE.MathUtils.damp(this.recoilOffsetZ, 0, 18, dt);
    this.recoilOffsetPitch = THREE.MathUtils.damp(this.recoilOffsetPitch, 0, 18, dt);
    this.recoilBloom = Math.max(0, this.recoilBloom - dt * 2.4);
    this.slideKick = THREE.MathUtils.damp(this.slideKick, 0, 28, dt);
    this.lookSwayX = THREE.MathUtils.damp(this.lookSwayX, 0, 11, dt);
    this.lookSwayY = THREE.MathUtils.damp(this.lookSwayY, 0, 11, dt);

    // Wall-clip prevention raycast
    this.camera.getWorldPosition(this.tmpOrigin);
    this.camera.getWorldDirection(this.tmpDir);
    const wallCheck = this.bvh.raycast(this.tmpOrigin, this.tmpDir, 0.85);
    const wallPushback = wallCheck ? Math.max(0, 0.85 - wallCheck.distance) * 0.45 : 0;

    // Perk drink bottle uncork/gulp animation
    if (player.drinkAnimTimer > 0) {
      this.weaponPivot.visible = false;
      this.knifeGroup.visible = false;
      this.bottleGroup.visible = true;
      this.bottleLiquidMat.color.setHex(player.drinkPerkColor);
      this.bottleLiquidMat.emissive.setHex(player.drinkPerkColor);
      const t = 1 - player.drinkAnimTimer / BALANCE.perks.drinkDuration;
      const lift = Math.sin(t * Math.PI);
      const gulpBounce = t > 0.35 && t < 0.72 ? Math.sin((t - 0.35) * 26) * 0.08 : 0;
      this.bottleGroup.position.set(
        THREE.MathUtils.lerp(0.18, 0.01, lift),
        THREE.MathUtils.lerp(-0.24, -0.04, lift) + gulpBounce * 0.15,
        -0.34,
      );
      this.bottleGroup.rotation.set(lift * 1.18 + gulpBounce, 0, lift * -0.22);
      return;
    }

    this.bottleGroup.visible = false;

    // Diagonal Bowie Knife Slash Animation
    if (player.knifeAnimTimer > 0) {
      this.weaponPivot.visible = false;
      this.knifeGroup.visible = true;
      const t = 1 - player.knifeAnimTimer / 0.3;
      const swing = t < 0.55 ? t / 0.55 : 1 - (t - 0.55) / 0.45;
      const eased = Math.sin(swing * Math.PI * 0.5);
      this.knifeGroup.position.set(
        THREE.MathUtils.lerp(0.26, -0.22, t),
        THREE.MathUtils.lerp(-0.08, -0.17, t) + Math.sin(t * Math.PI) * 0.03,
        -0.36 - eased * 0.24,
      );
      this.knifeGroup.rotation.set(
        THREE.MathUtils.lerp(0.28, -0.22, t),
        THREE.MathUtils.lerp(-0.55, 1.05, t),
        THREE.MathUtils.lerp(-0.25, -0.92, t),
      );
      return;
    }

    this.knifeGroup.visible = false;
    this.weaponPivot.visible = true;

    const activeId = this.getActiveWeapon().id;
    const adsAlpha = player.isAds ? 1 : 0;
    const adsY = ADS_EYE_Y[cfg.id];
    const targetX = THREE.MathUtils.lerp(0.195, 0.0, adsAlpha);
    const targetY = THREE.MathUtils.lerp(-0.17, adsY, adsAlpha);
    const targetZ = THREE.MathUtils.lerp(-0.335, -0.245, adsAlpha) + this.recoilOffsetZ + wallPushback;

    const horizSpeed = Math.hypot(player.velocity.x, player.velocity.z);
    const moveAmt = Math.min(1, horizSpeed / 5);
    const tNow = performance.now() * 0.001;
    const cadence = player.isSprinting ? 13.5 : 8.2;
    this.bobPhase += dt * cadence * (0.25 + moveAmt * 0.75);

    // Subtle idle breathing + crisp locomotion sway
    const idleX = Math.sin(tNow * 1.4) * 0.0022 * (1 - adsAlpha * 0.8);
    const idleY = Math.cos(tNow * 2.1) * 0.0022 * (1 - adsAlpha * 0.8);
    const bobAmp = player.isSprinting ? 0.017 : 0.0085;
    this.swayX =
      Math.cos(this.bobPhase) * bobAmp * moveAmt * (1 - adsAlpha * 0.8) +
      idleX +
      this.lookSwayX * (1 - adsAlpha * 0.65);
    this.swayY =
      Math.abs(Math.sin(this.bobPhase)) * bobAmp * 0.85 * moveAmt * (1 - adsAlpha * 0.8) +
      idleY +
      this.lookSwayY * (1 - adsAlpha * 0.65);

    // CoD-style Multi-stage Reload Choreography (Tilt -> Mag Drop -> Left Hand Slam -> Slide Rack)
    const reloadFrac = this.isReloading ? this.reloadTimer / Math.max(0.1, this.reloadDuration) : 0;
    let reloadTilt = 0;
    let reloadBumpY = 0;
    let rackPull = 0;
    if (this.isReloading) {
      reloadTilt = Math.sin(Math.min(1, reloadFrac * 1.15) * Math.PI);
      if (reloadFrac > 0.56 && reloadFrac < 0.7) {
        reloadBumpY = Math.sin(((reloadFrac - 0.56) / 0.14) * Math.PI) * 0.022;
      }
      if (reloadFrac > 0.74 && reloadFrac < 0.9) {
        rackPull = Math.sin(((reloadFrac - 0.74) / 0.16) * Math.PI) * 0.055;
      }
    }

    // Magazine drop & re-insert motion
    const magEntry = this.weaponMags.get(activeId);
    if (magEntry) {
      let magDrop = 0;
      if (this.isReloading) {
        if (reloadFrac < 0.25) {
          magDrop = (reloadFrac / 0.25) * 0.19;
        } else if (reloadFrac < 0.45) {
          magDrop = 0.19;
        } else if (reloadFrac < 0.62) {
          magDrop = (1 - (reloadFrac - 0.45) / 0.17) * 0.19;
        }
      }
      magEntry.mesh.position.y = magEntry.baseY - magDrop;
    }

    // Shotgun pump cycle offset (tracks both wooden forend AND left hand!)
    let pumpBack = 0;
    if (activeId === 'hedgerow' && this.pumpTimer > 0) {
      const pDur = Math.min(0.55, this.fireCooldown * 0.85);
      const pFrac = 1 - this.pumpTimer / Math.max(0.05, pDur);
      // Slight delay right after blast so recoil finishes, then sharp pump back-and-forward
      if (pFrac > 0.18 && pFrac < 0.88) {
        pumpBack = Math.sin(((pFrac - 0.18) / 0.7) * Math.PI) * 0.088;
      }
    }
    const pumpObj = this.weaponPumps.get(activeId);
    if (pumpObj) {
      pumpObj.mesh.position.z = pumpObj.baseZ + pumpBack;
    }

    // Recoil blowback + reload rack on weapon slide / bolt carrier
    const slideObj = this.weaponSlides.get(activeId);
    if (slideObj) {
      slideObj.mesh.position.z = slideObj.baseZ + this.slideKick + rackPull;
    }

    // Left Support Arm Animation (Pump follow-through, Mag Swap, Bolt Rack)
    const leftRig = this.leftArms.get(activeId);
    if (leftRig) {
      if (this.isReloading) {
        if (reloadFrac < 0.22) {
          const u = reloadFrac / 0.22;
          leftRig.group.position.lerpVectors(leftRig.restPos, leftRig.magPos, u);
          leftRig.group.position.y -= u * 0.05;
        } else if (reloadFrac < 0.44) {
          const u = (reloadFrac - 0.22) / 0.22;
          leftRig.group.position.copy(leftRig.magPos);
          leftRig.group.position.y -= 0.16 * Math.sin(u * Math.PI * 0.5);
        } else if (reloadFrac < 0.62) {
          const u = (reloadFrac - 0.44) / 0.18;
          leftRig.group.position.copy(leftRig.magPos);
          leftRig.group.position.y -= (1 - u) * 0.16;
        } else if (reloadFrac < 0.76) {
          const u = (reloadFrac - 0.62) / 0.14;
          leftRig.group.position.lerpVectors(leftRig.magPos, leftRig.rackPos, u);
        } else if (reloadFrac < 0.9) {
          const u = (reloadFrac - 0.76) / 0.14;
          leftRig.group.position.copy(leftRig.rackPos);
          leftRig.group.position.z += Math.sin(u * Math.PI) * 0.06;
        } else {
          const u = (reloadFrac - 0.9) / 0.1;
          leftRig.group.position.lerpVectors(leftRig.rackPos, leftRig.restPos, u);
        }
      } else {
        leftRig.group.position.copy(leftRig.restPos);
        leftRig.group.position.z += pumpBack;
      }
    }

    // Tactical Diagonal Sprint Carry vs Inspect Spin vs Ready Aim
    const sprintFactor = player.isSprinting && !this.isReloading ? 1 : 0;
    const sprintPosX = sprintFactor * -0.075;
    const sprintPosY = sprintFactor * -0.05;
    const sprintRotX = sprintFactor * -0.14;
    const sprintRotY = sprintFactor * 0.62;
    const sprintRotZ = sprintFactor * 0.34;

    let inspectPosX = 0;
    let inspectPosY = 0;
    let inspectPosZ = 0;
    let inspectRotX = 0;
    let inspectRotY = 0;
    let inspectRotZ = 0;
    if (this.inspectTimer > 0) {
      const inf = 1 - this.inspectTimer / this.inspectDuration;
      const env = Math.sin(inf * Math.PI);
      inspectPosX = -0.095 * env;
      inspectPosY = 0.03 * env;
      inspectPosZ = -0.03 * env;
      inspectRotY = 0.78 * env;
      inspectRotX = 0.22 * Math.sin(inf * Math.PI * 2);
      inspectRotZ = -0.42 * env;
    }

    const swapDrop = this.swapTimer > 0 ? -(this.swapTimer / Math.max(0.1, cfg.swapTime)) * 0.18 : 0;

    this.weaponPivot.position.set(
      THREE.MathUtils.damp(
        this.weaponPivot.position.x,
        targetX + this.swayX + sprintPosX + inspectPosX - reloadTilt * 0.04,
        18,
        dt,
      ),
      THREE.MathUtils.damp(
        this.weaponPivot.position.y,
        targetY - this.swayY + swapDrop + sprintPosY + inspectPosY - reloadTilt * 0.1 + reloadBumpY,
        18,
        dt,
      ),
      THREE.MathUtils.damp(
        this.weaponPivot.position.z,
        targetZ + inspectPosZ,
        18,
        dt,
      ),
    );
    this.weaponPivot.rotation.set(
      this.recoilOffsetPitch - reloadTilt * 0.34 + sprintRotX + inspectRotX + this.lookSwayY * 2.2,
      sprintRotY + inspectRotY - reloadTilt * 0.3 + this.lookSwayX * 2.8,
      reloadTilt * 0.56 + sprintRotZ + inspectRotZ - this.lookSwayX * 3.5,
    );

    const mf = this.muzzleSprites.get(activeId);
    if (mf) {
      const mat = mf.material as THREE.SpriteMaterial;
      mat.opacity = this.muzzleFlashTimer > 0 ? 0.96 : 0;
      mat.rotation = Math.random() * Math.PI * 2;
    }
    const mc = this.muzzleCrosses.get(activeId);
    if (mc) {
      mc.visible = this.muzzleFlashTimer > 0;
      if (mc.visible) {
        mc.rotation.z = Math.random() * Math.PI;
        const s = 0.8 + Math.random() * 0.5;
        mc.scale.set(s, s, s);
      }
    }
  }

  private spawnShellCasing(
    origin: THREE.Vector3,
    right: THREE.Vector3,
    up: THREE.Vector3,
    fwd: THREE.Vector3,
  ): void {
    const p = this.shellPool.find((item) => !item.active);
    if (!p) return;
    p.active = true;
    p.maxLife = 0.85;
    p.life = p.maxLife;
    const ejectSpeed = 2.0 + Math.random() * 0.8;
    p.vx = right.x * ejectSpeed + fwd.x * 0.35 + (Math.random() - 0.5) * 0.4;
    p.vy = up.y * (1.7 + Math.random() * 0.7) + 0.5;
    p.vz = right.z * ejectSpeed + fwd.z * 0.35 + (Math.random() - 0.5) * 0.4;
    p.rx = (Math.random() - 0.5) * 28;
    p.ry = (Math.random() - 0.5) * 28;
    p.rz = (Math.random() - 0.5) * 28;
    p.mesh.position.copy(origin);
    p.mesh.scale.setScalar(1);
    p.mesh.visible = true;
  }

  private spawnSmokePuff(origin: THREE.Vector3, fwd: THREE.Vector3): void {
    const p = this.smokePool.find((item) => !item.active);
    if (!p) return;
    p.active = true;
    p.maxLife = 0.5;
    p.life = p.maxLife;
    p.vx = fwd.x * 0.65 + (Math.random() - 0.5) * 0.28;
    p.vy = 0.45 + Math.random() * 0.35;
    p.vz = fwd.z * 0.65 + (Math.random() - 0.5) * 0.28;
    p.rx = 1.5;
    p.ry = 1.2;
    p.rz = 0.8;
    p.mesh.position.copy(origin);
    p.mesh.scale.setScalar(p.startScale);
    (p.mesh.material as THREE.MeshBasicMaterial).opacity = p.baseOpacity;
    p.mesh.visible = true;
  }

  private stepParticlePool(pool: ParticleItem[], dt: number): void {
    for (const p of pool) {
      if (!p.active) continue;
      p.life -= dt;
      if (p.life <= 0) {
        p.active = false;
        p.mesh.visible = false;
        continue;
      }
      p.vy -= p.gravity * dt;
      p.mesh.position.x += p.vx * dt;
      p.mesh.position.y += p.vy * dt;
      p.mesh.position.z += p.vz * dt;
      p.mesh.rotation.x += p.rx * dt;
      p.mesh.rotation.y += p.ry * dt;
      p.mesh.rotation.z += p.rz * dt;

      if (p.bounce && p.mesh.position.y < 0.03) {
        p.mesh.position.y = 0.03;
        p.vy = -p.vy * 0.38;
        p.vx *= 0.62;
        p.vz *= 0.62;
        p.rx *= 0.5;
        p.rz *= 0.5;
      }

      const frac = 1 - p.life / p.maxLife;
      if (p.startScale !== p.endScale) {
        const s = THREE.MathUtils.lerp(p.startScale, p.endScale, frac);
        p.mesh.scale.setScalar(s);
      }
      const mat = p.mesh.material as THREE.MeshBasicMaterial | THREE.MeshStandardMaterial;
      if (mat.transparent) {
        mat.opacity = Math.max(0, (1 - frac) * p.baseOpacity);
      }
    }
  }

  private updateParticlesAndProjectiles(
    dt: number,
    instaKill: boolean,
    callbacks: ShotCallbacks,
  ): void {
    this.stepParticlePool(this.particles, dt);
    this.stepParticlePool(this.shellPool, dt);
    this.stepParticlePool(this.smokePool, dt);

    for (const t of this.tracers) {
      if (!t.active) continue;
      t.life -= dt;
      if (t.life <= 0) {
        t.active = false;
        t.line.visible = false;
      } else {
        (t.line.material as THREE.MeshBasicMaterial).opacity = t.life / 0.06;
      }
    }

    for (const sw of this.shockwaves) {
      if (!sw.active) continue;
      sw.life -= dt;
      if (sw.life <= 0) {
        sw.active = false;
        sw.mesh.visible = false;
      } else {
        const prog = 1 - sw.life / sw.maxLife;
        const r = 0.3 + prog * sw.maxRadius;
        sw.mesh.scale.set(r, 1, r);
        (sw.mesh.material as THREE.MeshBasicMaterial).opacity = (1 - prog) * 0.8;
      }
    }

    // Phase Cannon bolts
    let activeBoltPos: THREE.Vector3 | null = null;
    for (const b of this.phaseBolts) {
      if (!b.active) continue;
      b.life -= dt;
      const stepDist = b.vel.length() * dt;
      const dir = this.tmpVec.copy(b.vel).normalize();
      const sweepOrigin = this.tmpOrigin.copy(b.pos).addScaledVector(dir, -0.15);
      const zHit = this.zombies.raycastShot(sweepOrigin, dir, stepDist + 0.5);
      const wHit = this.bvh.raycast(sweepOrigin, dir, stepDist + 0.4);

      if (zHit || wHit || b.life <= 0) {
        const impactPos = zHit ? zHit.point : wHit ? wHit.point : b.pos;
        const cfg = BALANCE.weapons.phase_cannon;
        const mult = b.upgraded ? BALANCE.overclock.damageMult : 1.0;
        const kills = this.zombies.applySplashDamage(
          impactPos.x,
          impactPos.y,
          impactPos.z,
          cfg.splashRadius,
          cfg.damage * mult,
          cfg.splashDamage * mult,
          instaKill,
          (ent) => {
            callbacks.onPoints(BALANCE.economy.bodyKillPoints, 'Phase Kill');
            callbacks.onKillEnemy(ent.type, ent.x, ent.y + 1, ent.z, false, false, true);
            if (ent.type === 'bloater') callbacks.onBloaterExplode(ent.x, ent.y + 1, ent.z);
          },
        );
        if (kills > 0) callbacks.onHitMarker('kill');
        this.spawnParticles(impactPos, 0x818cf8, 16, 4.5);
        this.spawnShockwave(impactPos.x, Math.max(0.06, impactPos.y), impactPos.z, cfg.splashRadius, 0x818cf8);
        this.audio.playExplosion(impactPos.x, impactPos.y, impactPos.z);
        b.active = false;
        b.mesh.visible = false;
        continue;
      }

      b.pos.addScaledVector(b.vel, dt);
      b.mesh.position.copy(b.pos);
      if (!activeBoltPos) activeBoltPos = b.pos;
    }
    if (activeBoltPos) {
      this.phaseLight.position.copy(activeBoltPos);
      this.phaseLight.intensity = 2.8;
    } else {
      this.phaseLight.intensity = 0;
    }

    // Active thrown grenades
    for (let i = this.activeGrenades.length - 1; i >= 0; i--) {
      const g = this.activeGrenades[i]!;
      const t = g.rb.body.translation();
      const r = g.rb.body.rotation();
      g.mesh.position.set(t.x, t.y, t.z);
      this.tmpQuat.set(r.x, r.y, r.z, r.w);
      g.mesh.quaternion.copy(this.tmpQuat);
      g.fuse -= dt;
      if (g.fuse <= 0) {
        this.audio.playExplosion(t.x, t.y, t.z);
        this.spawnParticles(new THREE.Vector3(t.x, t.y + 0.2, t.z), 0xf97316, 22, 6.5);
        this.spawnShockwave(t.x, 0.08, t.z, BALANCE.player.grenadeRadius, 0xf97316);
        this.spawnDecal(
          new THREE.Vector3(t.x, 0.03, t.z),
          new THREE.Vector3(0, 1, 0),
          'scorch',
        );
        const kills = this.zombies.applySplashDamage(
          t.x,
          t.y,
          t.z,
          BALANCE.player.grenadeRadius,
          BALANCE.player.grenadeDamageInner,
          BALANCE.player.grenadeDamageOuter,
          instaKill,
          (ent) => {
            callbacks.onPoints(BALANCE.economy.explosiveKillPoints, 'Explosive Kill');
            callbacks.onKillEnemy(ent.type, ent.x, ent.y + 1, ent.z, false, false, true);
          },
        );
        if (kills > 0) callbacks.onHitMarker('kill');
        this.scene.remove(g.mesh);
        this.physics.removeGrenadeBody(g.rb.id);
        this.activeGrenades.splice(i, 1);
      }
    }
  }

  public spawnShockwave(x: number, y: number, z: number, maxRadius: number, colorHex: number): void {
    const sw = this.shockwaves.find((item) => !item.active);
    if (!sw) return;
    sw.active = true;
    sw.maxLife = 0.35;
    sw.life = sw.maxLife;
    sw.maxRadius = maxRadius;
    sw.mesh.position.set(x, y, z);
    sw.mesh.scale.set(0.3, 1, 0.3);
    (sw.mesh.material as THREE.MeshBasicMaterial).color.setHex(colorHex);
    (sw.mesh.material as THREE.MeshBasicMaterial).opacity = 0.85;
    sw.mesh.visible = true;
  }

  public spawnImpactBySurface(point: THREE.Vector3, normal: THREE.Vector3, surface: SurfaceType): void {
    const colorMap: Record<SurfaceType, number> = {
      concrete: 0x9ca3af,
      metal: 0xfbbf24,
      wood: 0x92623a,
      dirt: 0x57534e,
    };
    this.spawnParticles(point.clone().addScaledVector(normal, 0.04), colorMap[surface], 6, 3.2);
  }

  public spawnParticles(origin: THREE.Vector3, colorHex: number, count: number, speed: number): void {
    for (let i = 0; i < count; i++) {
      this.spawnSingleParticle(
        origin,
        (Math.random() - 0.5) * speed * 2,
        Math.random() * speed * 1.2 + 0.5,
        (Math.random() - 0.5) * speed * 2,
        colorHex,
        0.35 + Math.random() * 0.25,
      );
    }
  }

  private spawnSingleParticle(
    origin: THREE.Vector3,
    vx: number,
    vy: number,
    vz: number,
    colorHex: number,
    maxLife: number,
  ): void {
    const p = this.particles.find((item) => !item.active);
    if (!p) return;
    p.active = true;
    p.life = maxLife;
    p.maxLife = maxLife;
    p.vx = vx;
    p.vy = vy;
    p.vz = vz;
    p.rx = (Math.random() - 0.5) * 14;
    p.ry = (Math.random() - 0.5) * 14;
    p.rz = (Math.random() - 0.5) * 14;
    p.mesh.position.copy(origin);
    p.mesh.scale.setScalar(1);
    (p.mesh.material as THREE.MeshBasicMaterial).color.setHex(colorHex);
    (p.mesh.material as THREE.MeshBasicMaterial).opacity = 0.95;
    p.mesh.visible = true;
  }

  private spawnTracer(start: THREE.Vector3, end: THREE.Vector3, colorHex: number): void {
    const t = this.tracers.find((item) => !item.active);
    if (!t) return;
    const dist = start.distanceTo(end);
    if (dist < 0.5) return;
    t.active = true;
    t.life = 0.06;
    const mid = start.clone().lerp(end, 0.5);
    t.line.position.copy(mid);
    t.line.scale.set(1, 1, dist);
    t.line.lookAt(end);
    (t.line.material as THREE.MeshBasicMaterial).color.setHex(colorHex);
    t.line.visible = true;
  }

  public spawnDecal(
    point: THREE.Vector3,
    normal: THREE.Vector3,
    kind: 'bullet' | 'blood' | 'scorch',
  ): void {
    const decal = this.decals[this.decalCursor]!;
    this.decalCursor = (this.decalCursor + 1) % this.decals.length;
    const mat = decal.material as THREE.MeshBasicMaterial;
    mat.map =
      kind === 'blood'
        ? this.mats.bloodSplatterTex
        : kind === 'scorch'
          ? this.mats.scorchDecalTex
          : this.mats.bulletHoleTex;
    mat.needsUpdate = true;

    const scale =
      kind === 'scorch'
        ? 4.6
        : kind === 'blood'
          ? 1.8 + Math.random() * 1.4
          : 0.45 + Math.random() * 0.25;
    decal.scale.set(scale, scale, 1);
    decal.position.copy(point).addScaledVector(normal, 0.025);
    decal.lookAt(point.clone().add(normal));
    decal.rotateZ(Math.random() * Math.PI * 2);
    decal.visible = true;
  }
}
