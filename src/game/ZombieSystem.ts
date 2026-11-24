import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import {
  BALANCE,
  calculateZombieHealth,
  DIFFICULTY_PRESETS,
  getSpeedClassWeights,
  type DifficultyId,
  type EnemyType,
  type ZoneId,
} from '../config/balance';
import type { AudioEngine } from '../engine/AudioEngine';
import type { BvhWorld } from '../engine/BvhWorld';
import type { NavGrid } from '../engine/NavGrid';
import type { PbrMaterialSet } from '../engine/ProceduralAssets';
import {
  canZombieStrikePlayer,
  computeDirectionalFall,
  resolvePlayerZombieStandoff,
  selectSafeSpawnPoint,
} from './combatPhysics';
import type { SpawnPoint, WindowBarricade } from './MapBuilder';
import type { BossHudState, DamageSource, SeededRng } from './types';

export type ZombieState =
  | 'approach_window'
  | 'tear_board'
  | 'climb_in'
  | 'chase'
  | 'attack'
  | 'brute_telegraph'
  | 'brute_charge'
  | 'bloater_fuse'
  | 'dying'
  | 'dead';

export type HitZone = 'head' | 'torso' | 'limb' | 'back_weakpoint';

export interface ZombieHitResult {
  zombieId: number;
  enemyType: EnemyType;
  hitZone: HitZone;
  point: THREE.Vector3;
  normal: THREE.Vector3;
  distance: number;
  killed: boolean;
  isCrawler: boolean;
}

interface ZombieEntity {
  id: number;
  active: boolean;
  type: EnemyType;
  bossRole: 'none' | 'warden' | 'alpha_boss';
  speedClass: 'walk' | 'run' | 'sprint';
  moveSpeed: number;
  health: number;
  maxHealth: number;
  state: ZombieState;
  stateTimer: number;
  bloaterBeepTimer: number;
  attackCooldown: number;
  attackDealt: boolean;
  chargeCooldown: number;
  groanTimer: number;
  stepSoundTimer: number;
  hitReactTimer: number;
  hitReactDirX: number;
  hitReactDirZ: number;
  hitReactZone: HitZone;
  hitFlashTimer: number;
  hitFlashActive: boolean;
  deathFallRoll: number;
  deathPitchTarget: number;
  deathRollTarget: number;
  deathVx: number;
  deathVz: number;
  staggerTimer: number;
  isCrawler: boolean;
  woundedShown: boolean;

  x: number;
  y: number;
  z: number;
  prevX: number;
  prevZ: number;
  yaw: number;
  vx: number;
  vz: number;
  kbVx: number;
  kbVz: number;
  strideBlend: number;

  // Stuck detection
  lastProgressX: number;
  lastProgressZ: number;
  stuckTimer: number;
  stuckCount: number;

  // Barricade link
  windowId: string | null;

  // Corpse dissolve
  corpseTimer: number;
  dissolveUniform: { value: number };

  // Visual rigs
  root: THREE.Group;
  bodyGroup: THREE.Group;
  humanoidGroup: THREE.Group;
  houndGroup: THREE.Group;
  contactShadow: THREE.Mesh;
  torsoPivot: THREE.Group;
  headPivot: THREE.Group;
  headMesh: THREE.Mesh;
  torsoMesh: THREE.Mesh;
  leftArm: THREE.Group;
  leftForearm: THREE.Group;
  rightArm: THREE.Group;
  rightForearm: THREE.Group;
  leftLeg: THREE.Group;
  leftShin: THREE.Group;
  rightLeg: THREE.Group;
  rightShin: THREE.Group;
  houndLegs: [THREE.Group, THREE.Group, THREE.Group, THREE.Group];
  houndHead: THREE.Group;
  weakPointMesh: THREE.Mesh;
  bruteGearGroup: THREE.Group;
  bloaterCystsGroup: THREE.Group;
  fungalGrowthMesh: THREE.Mesh;
  eyesMesh: THREE.Mesh;
  eyeHalos: [THREE.Sprite, THREE.Sprite];
  houndEyeHalos: [THREE.Sprite, THREE.Sprite];
  headStumpMesh: THREE.Mesh;
  headPopped: boolean;
  bloodWoundMesh: THREE.Mesh;
  hitboxMeshes: THREE.Mesh[];
  baseMaterials: [
    THREE.MeshStandardMaterial,
    THREE.MeshStandardMaterial,
    THREE.MeshStandardMaterial,
    THREE.MeshStandardMaterial,
  ];
  dissolveMaterials:
    | [
        THREE.MeshStandardMaterial,
        THREE.MeshStandardMaterial,
        THREE.MeshStandardMaterial,
        THREE.MeshStandardMaterial,
      ]
    | null;
  rigMeshes: {
    skinMeshes: THREE.Mesh[];
    clothMeshes: THREE.Mesh[];
    pantsMeshes: THREE.Mesh[];
    bloodMeshes: THREE.Mesh[];
    houndMeshes: THREE.Mesh[];
  };
  animPhase: number;
  spawnFogTimer: number;
  spawnRiseTimer: number;
  spawnFogRing: THREE.Mesh;
}

const MAX_ZOMBIES = BALANCE.rounds.maxAlive;

export class ZombieSystem {
  public readonly entities: ZombieEntity[] = [];
  public stuckTeleportCount = 0;
  public onBossKilled: ((role: 'warden' | 'alpha_boss', x: number, y: number, z: number) => void) | null = null;

  private readonly scene: THREE.Scene;
  private readonly nav: NavGrid;
  private readonly bvh: BvhWorld;
  private readonly audio: AudioEngine;
  private readonly mats: PbrMaterialSet;
  private readonly isSoftwareGl: boolean;

  private readonly posX = new Float32Array(MAX_ZOMBIES);
  private readonly posZ = new Float32Array(MAX_ZOMBIES);
  private readonly activeFlags = new Uint8Array(MAX_ZOMBIES);
  private readonly flowSample = { x: 0, z: 0 };
  private readonly sepSample = { x: 0, z: 0 };
  private readonly raycaster = new THREE.Raycaster();
  private readonly tmpVec = new THREE.Vector3();
  private readonly tmpZombieEye = new THREE.Vector3();
  private readonly tmpPlayerEye = new THREE.Vector3();
  private readonly allHitboxes: THREE.Mesh[] = [];

  private nextZombieId = 1;
  private aiFrameCounter = 0;

  // Shared sculpted geometries (split for articulated elbows & knees)
  private readonly headGeo = ZombieSystem.buildHeadGeo();
  private readonly torsoGeo = ZombieSystem.buildTorsoGeo();
  private readonly upperArmGeo = ZombieSystem.buildUpperArmGeo();
  private readonly forearmGeo = ZombieSystem.buildForearmGeo();
  private readonly thighGeo = ZombieSystem.buildThighGeo();
  private readonly shinGeo = ZombieSystem.buildShinGeo();
  private readonly eyesGeo = ZombieSystem.buildEyesGeo();
  private readonly houndBodyGeo = ZombieSystem.buildHoundBodyGeo();
  private readonly houndHeadGeo = ZombieSystem.buildHoundHeadGeo();
  private readonly houndLegGeo = ZombieSystem.buildHoundLegGeo();
  private readonly houndEyesGeo = ZombieSystem.buildHoundEyesGeo();

  private readonly headProxyGeo = new THREE.SphereGeometry(0.25, 8, 6);
  private readonly headProxyMat = new THREE.MeshBasicMaterial({
    transparent: true,
    opacity: 0,
    colorWrite: false,
    depthWrite: false,
  });
  private readonly contactShadowGeo = new THREE.PlaneGeometry(1.15, 1.15);
  private readonly contactShadowMat: THREE.MeshBasicMaterial;

  private readonly eyeMat = new THREE.MeshBasicMaterial({ color: 0xfef08a });
  private readonly houndEyeMat = new THREE.MeshBasicMaterial({ color: 0xf87171 });
  private readonly bloaterEyeMat = new THREE.MeshBasicMaterial({ color: 0xbef264 });

  private readonly houndSkinMat = new THREE.MeshStandardMaterial({
    color: 0x3b2926,
    roughness: 0.72,
    metalness: 0.08,
  });
  private readonly bloaterSkinMat = new THREE.MeshStandardMaterial({
    color: 0x627a44,
    roughness: 0.65,
    metalness: 0.08,
  });
  private readonly bloaterClothMat = new THREE.MeshStandardMaterial({
    color: 0x455432,
    roughness: 0.85,
    metalness: 0.08,
  });
  private readonly bloaterCystMat = new THREE.MeshStandardMaterial({
    color: 0x84cc16,
    emissive: 0x65a30d,
    emissiveIntensity: 1.25,
    roughness: 0.35,
  });
  private readonly bruteSkinMat = new THREE.MeshStandardMaterial({
    color: 0x44454a,
    roughness: 0.68,
    metalness: 0.12,
  });
  private readonly bruteArmorMat = new THREE.MeshStandardMaterial({
    color: 0x232528,
    roughness: 0.45,
    metalness: 0.65,
  });
  private readonly fungalGrowthMat = new THREE.MeshStandardMaterial({
    color: 0xf59e0b,
    emissive: 0xb45309,
    emissiveIntensity: 0.95,
    roughness: 0.6,
  });
  private readonly hitFlashSkinMat = new THREE.MeshStandardMaterial({
    color: 0xfca5a5,
    emissive: 0xb91c1c,
    emissiveIntensity: 1.15,
    roughness: 0.45,
  });
  private readonly hitFlashClothMat = new THREE.MeshStandardMaterial({
    color: 0xfecaca,
    emissive: 0x991b1b,
    emissiveIntensity: 1.0,
    roughness: 0.5,
  });

  constructor(
    scene: THREE.Scene,
    nav: NavGrid,
    bvh: BvhWorld,
    audio: AudioEngine,
    mats: PbrMaterialSet,
    isSoftwareGl: boolean,
  ) {
    this.scene = scene;
    this.nav = nav;
    this.bvh = bvh;
    this.audio = audio;
    this.mats = mats;
    this.isSoftwareGl = isSoftwareGl;
    for (const g of [
      this.headGeo,
      this.torsoGeo,
      this.upperArmGeo,
      this.forearmGeo,
      this.thighGeo,
      this.shinGeo,
      this.eyesGeo,
      this.houndBodyGeo,
      this.houndHeadGeo,
      this.houndLegGeo,
      this.houndEyesGeo,
    ]) {
      g.computeBoundingSphere();
    }
    this.contactShadowGeo.rotateX(-Math.PI / 2);
    this.contactShadowMat = new THREE.MeshBasicMaterial({
      map: mats.contactShadowTex,
      transparent: true,
      depthWrite: false,
      opacity: 0.72,
    });
    this.allocatePool();
  }

  private static buildHeadGeo(): THREE.BufferGeometry {
    const cranium = new THREE.SphereGeometry(0.145, 10, 8);
    cranium.scale(0.92, 1.08, 1.02);
    cranium.translate(0, 0.04, 0);

    const jaw = new THREE.CylinderGeometry(0.095, 0.072, 0.13, 8);
    jaw.scale(1.0, 1.0, 1.08);
    jaw.translate(0, -0.07, 0.025);

    const brow = new THREE.BoxGeometry(0.21, 0.045, 0.08);
    brow.translate(0, 0.06, 0.1);

    const merged = mergeGeometries([cranium, jaw, brow]);
    cranium.dispose();
    jaw.dispose();
    brow.dispose();
    return merged ?? new THREE.SphereGeometry(0.15, 8, 8);
  }

  private static buildTorsoGeo(): THREE.BufferGeometry {
    const chest = new THREE.CylinderGeometry(0.24, 0.18, 0.42, 10);
    chest.scale(1.12, 1.0, 0.7);
    chest.translate(0, 0.1, 0);

    const pelvis = new THREE.CylinderGeometry(0.185, 0.195, 0.24, 10);
    pelvis.scale(1.08, 1.0, 0.72);
    pelvis.translate(0, -0.2, 0);

    const shoulderBar = new THREE.CylinderGeometry(0.08, 0.08, 0.56, 8);
    shoulderBar.rotateZ(Math.PI / 2);
    shoulderBar.translate(0, 0.25, -0.01);

    const merged = mergeGeometries([chest, pelvis, shoulderBar]);
    chest.dispose();
    pelvis.dispose();
    shoulderBar.dispose();
    return merged ?? new THREE.CylinderGeometry(0.22, 0.18, 0.62, 10);
  }

  private static buildUpperArmGeo(): THREE.BufferGeometry {
    const shoulder = new THREE.SphereGeometry(0.078, 8, 6);
    const upper = new THREE.CylinderGeometry(0.064, 0.052, 0.27, 8);
    upper.translate(0, -0.135, 0);
    const elbow = new THREE.SphereGeometry(0.052, 7, 5);
    elbow.translate(0, -0.27, 0);

    const merged = mergeGeometries([shoulder, upper, elbow]);
    shoulder.dispose();
    upper.dispose();
    elbow.dispose();
    return merged ?? new THREE.CylinderGeometry(0.06, 0.05, 0.28, 8);
  }

  private static buildForearmGeo(): THREE.BufferGeometry {
    const forearm = new THREE.CylinderGeometry(0.05, 0.038, 0.26, 8);
    forearm.translate(0, -0.13, 0);
    const palm = new THREE.BoxGeometry(0.072, 0.09, 0.048);
    palm.translate(0, -0.28, 0.01);
    const claw = new THREE.ConeGeometry(0.036, 0.07, 5);
    claw.rotateX(Math.PI);
    claw.scale(1.1, 1.0, 0.55);
    claw.translate(0, -0.35, 0.02);

    const merged = mergeGeometries([forearm, palm, claw]);
    forearm.dispose();
    palm.dispose();
    claw.dispose();
    return merged ?? new THREE.CylinderGeometry(0.05, 0.04, 0.28, 8);
  }

  private static buildThighGeo(): THREE.BufferGeometry {
    const hip = new THREE.SphereGeometry(0.092, 8, 6);
    const thigh = new THREE.CylinderGeometry(0.095, 0.074, 0.34, 8);
    thigh.translate(0, -0.17, 0);
    const knee = new THREE.SphereGeometry(0.07, 7, 5);
    knee.translate(0, -0.34, 0);

    const merged = mergeGeometries([hip, thigh, knee]);
    hip.dispose();
    thigh.dispose();
    knee.dispose();
    return merged ?? new THREE.CylinderGeometry(0.08, 0.07, 0.35, 8);
  }

  private static buildShinGeo(): THREE.BufferGeometry {
    const shin = new THREE.CylinderGeometry(0.07, 0.052, 0.33, 8);
    shin.translate(0, -0.165, 0);
    const boot = new THREE.BoxGeometry(0.115, 0.095, 0.22);
    boot.translate(0, -0.34, 0.05);

    const merged = mergeGeometries([shin, boot]);
    shin.dispose();
    boot.dispose();
    return merged ?? new THREE.CylinderGeometry(0.07, 0.05, 0.35, 8);
  }

  private static buildEyesGeo(): THREE.BufferGeometry {
    const left = new THREE.SphereGeometry(0.022, 6, 6);
    left.scale(1.2, 0.75, 0.6);
    left.translate(-0.052, 0.025, 0.135);
    const right = new THREE.SphereGeometry(0.022, 6, 6);
    right.scale(1.2, 0.75, 0.6);
    right.translate(0.052, 0.025, 0.135);
    const merged = mergeGeometries([left, right]);
    left.dispose();
    right.dispose();
    return merged ?? new THREE.BoxGeometry(0.14, 0.03, 0.03);
  }

  private static buildHoundBodyGeo(): THREE.BufferGeometry {
    const ribcage = new THREE.CylinderGeometry(0.22, 0.16, 0.56, 9);
    ribcage.rotateX(Math.PI / 2);
    ribcage.scale(0.88, 1.08, 1.0);
    ribcage.translate(0, 0.03, 0.14);

    const abdomen = new THREE.CylinderGeometry(0.15, 0.17, 0.44, 8);
    abdomen.rotateX(Math.PI / 2);
    abdomen.scale(0.82, 0.92, 1.0);
    abdomen.translate(0, 0.01, -0.26);

    const neck = new THREE.CylinderGeometry(0.11, 0.15, 0.28, 8);
    neck.rotateX(0.95);
    neck.translate(0, 0.14, 0.44);

    const tail = new THREE.ConeGeometry(0.045, 0.34, 6);
    tail.rotateX(-1.15);
    tail.translate(0, 0.09, -0.58);

    const spineA = new THREE.ConeGeometry(0.035, 0.11, 5);
    spineA.translate(0, 0.22, 0.12);
    const spineB = new THREE.ConeGeometry(0.03, 0.1, 5);
    spineB.translate(0, 0.2, -0.06);
    const spineC = new THREE.ConeGeometry(0.028, 0.09, 5);
    spineC.translate(0, 0.18, -0.24);

    const merged = mergeGeometries([ribcage, abdomen, neck, tail, spineA, spineB, spineC]);
    ribcage.dispose();
    abdomen.dispose();
    neck.dispose();
    tail.dispose();
    spineA.dispose();
    spineB.dispose();
    spineC.dispose();
    return merged ?? new THREE.BoxGeometry(0.32, 0.32, 0.85);
  }

  private static buildHoundHeadGeo(): THREE.BufferGeometry {
    const skull = new THREE.SphereGeometry(0.135, 8, 7);
    skull.scale(0.92, 0.88, 1.15);

    const snout = new THREE.CylinderGeometry(0.055, 0.088, 0.24, 7);
    snout.rotateX(Math.PI / 2);
    snout.translate(0, -0.02, 0.18);

    const earL = new THREE.ConeGeometry(0.038, 0.12, 5);
    earL.rotateZ(0.28);
    earL.translate(-0.085, 0.12, -0.02);

    const earR = new THREE.ConeGeometry(0.038, 0.12, 5);
    earR.rotateZ(-0.28);
    earR.translate(0.085, 0.12, -0.02);

    const merged = mergeGeometries([skull, snout, earL, earR]);
    skull.dispose();
    snout.dispose();
    earL.dispose();
    earR.dispose();
    return merged ?? new THREE.BoxGeometry(0.22, 0.2, 0.34);
  }

  private static buildHoundLegGeo(): THREE.BufferGeometry {
    const upper = new THREE.CylinderGeometry(0.06, 0.045, 0.25, 7);
    upper.rotateX(0.24);
    upper.translate(0, -0.11, -0.02);

    const lower = new THREE.CylinderGeometry(0.042, 0.03, 0.27, 7);
    lower.rotateX(-0.22);
    lower.translate(0, -0.34, 0.01);

    const paw = new THREE.BoxGeometry(0.07, 0.05, 0.11);
    paw.translate(0, -0.47, 0.04);

    const merged = mergeGeometries([upper, lower, paw]);
    upper.dispose();
    lower.dispose();
    paw.dispose();
    return merged ?? new THREE.BoxGeometry(0.09, 0.45, 0.09);
  }

  private static buildHoundEyesGeo(): THREE.BufferGeometry {
    const l = new THREE.SphereGeometry(0.02, 6, 5);
    l.translate(-0.055, 0.035, 0.11);
    const r = new THREE.SphereGeometry(0.02, 6, 5);
    r.translate(0.055, 0.035, 0.11);
    const merged = mergeGeometries([l, r]);
    l.dispose();
    r.dispose();
    return merged ?? new THREE.BoxGeometry(0.12, 0.03, 0.03);
  }

  private allocatePool(): void {
    const skinCount = this.mats.zombieSkins.length;
    const clothCount = this.mats.zombieCloths.length;

    for (let i = 0; i < MAX_ZOMBIES; i++) {
      const skinMat = this.mats.zombieSkins[i % skinCount]!;
      const clothMat = this.mats.zombieCloths[i % clothCount]!;
      const pantsMat = this.mats.zombiePants;
      const bloodMat = this.mats.zombieBlood;
      const dissolveUniform = { value: 0 };

      const root = new THREE.Group();
      root.visible = false;

      const bodyGroup = new THREE.Group();
      root.add(bodyGroup);

      const contactShadow = new THREE.Mesh(this.contactShadowGeo, this.contactShadowMat);
      contactShadow.position.y = 0.015;
      root.add(contactShadow);

      // =====================================================
      // A. ARTICULATED SCULPTED HUMANOID RIG (Shambler, Bloater, Brute)
      // =====================================================
      const humanoidGroup = new THREE.Group();
      bodyGroup.add(humanoidGroup);

      // Upper torso spine pivot (at waist y=0.72) so zombies crouch, twist & recoil organically
      const torsoPivot = new THREE.Group();
      torsoPivot.position.set(0, 0.72, 0);
      humanoidGroup.add(torsoPivot);

      const torsoMesh = new THREE.Mesh(this.torsoGeo, clothMat);
      torsoMesh.position.y = 0.3;
      torsoMesh.castShadow = !this.isSoftwareGl;
      torsoMesh.userData = { poolIdx: i, hitZone: 'torso' as HitZone };
      torsoPivot.add(torsoMesh);

      // Torn bloodied chest/shoulder gash tucked flush into torso & dynamic low-health wound patch
      const chestBlood = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.24, 0.23), bloodMat);
      chestBlood.position.set((i % 2 === 0 ? 1 : -1) * 0.04, 0.04, 0.015);
      chestBlood.rotation.z = i % 2 === 0 ? 0.18 : -0.18;
      torsoMesh.add(chestBlood);

      const bloodWoundMesh = new THREE.Mesh(new THREE.SphereGeometry(0.12, 7, 7), bloodMat);
      bloodWoundMesh.scale.set(1.1, 1.15, 0.32);
      bloodWoundMesh.position.set(-0.04, 0.08, 0.115);
      bloodWoundMesh.visible = false;
      torsoMesh.add(bloodWoundMesh);

      // Fungal Bloom outgrowth on shoulder for visual variety
      const fungalGrowthMesh = new THREE.Mesh(new THREE.DodecahedronGeometry(0.11, 0), this.fungalGrowthMat);
      fungalGrowthMesh.position.set(i % 2 === 0 ? 0.2 : -0.2, 0.28, 0.02);
      torsoMesh.add(fungalGrowthMesh);

      // Neck & Head pivot + glowing eyes + generous invisible head hit sphere
      const headPivot = new THREE.Group();
      headPivot.position.set(0, 0.76, 0.03);
      torsoPivot.add(headPivot);

      const headMesh = new THREE.Mesh(this.headGeo, skinMat);
      headMesh.scale.setScalar(1.1);
      headMesh.castShadow = !this.isSoftwareGl;
      headMesh.userData = { poolIdx: i, hitZone: 'head' as HitZone };
      headPivot.add(headMesh);

      const headHitProxy = new THREE.Mesh(this.headProxyGeo, this.headProxyMat);
      headHitProxy.userData = { poolIdx: i, hitZone: 'head' as HitZone };
      headPivot.add(headHitProxy);

      const eyesMesh = new THREE.Mesh(this.eyesGeo, this.eyeMat);
      headMesh.add(eyesMesh);

      const eyeHalos = ([-0.052, 0.052] as const).map((ex) => {
        const sp = new THREE.Sprite(
          new THREE.SpriteMaterial({
            map: this.mats.eyeGlowTex,
            color: 0xfbbf24,
            transparent: true,
            opacity: 0.56,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
          }),
        );
        sp.position.set(ex, 0.025, 0.142);
        sp.scale.set(0.11, 0.11, 1);
        headMesh.add(sp);
        return sp;
      }) as [THREE.Sprite, THREE.Sprite];

      const headStumpMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.068, 0.082, 0.09, 8), bloodMat);
      headStumpMesh.position.set(0, 0.72, 0.02);
      headStumpMesh.visible = false;
      torsoPivot.add(headStumpMesh);

      // Brute armored pauldrons & chest plate + glowing back weakpoint canister
      const bruteGearGroup = new THREE.Group();
      bruteGearGroup.visible = false;
      const pauldronL = new THREE.Mesh(new THREE.SphereGeometry(0.16, 8, 6), this.bruteArmorMat);
      pauldronL.scale.set(1.1, 0.85, 1.1);
      pauldronL.position.set(-0.32, 0.58, 0);
      const pauldronR = pauldronL.clone();
      pauldronR.position.x = 0.32;
      const chestRig = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.38, 0.36), this.bruteArmorMat);
      chestRig.position.set(0, 0.38, 0.02);
      const hornA = new THREE.Mesh(new THREE.ConeGeometry(0.045, 0.2, 6), this.fungalGrowthMat);
      hornA.position.set(-0.09, 0.94, 0.03);
      hornA.rotation.z = 0.35;
      const hornB = hornA.clone();
      hornB.position.x = 0.09;
      hornB.rotation.z = -0.35;
      bruteGearGroup.add(pauldronL, pauldronR, chestRig, hornA, hornB);
      torsoPivot.add(bruteGearGroup);

      const weakPointMesh = new THREE.Mesh(
        new THREE.CylinderGeometry(0.14, 0.14, 0.32, 10),
        new THREE.MeshStandardMaterial({
          color: 0xf97316,
          emissive: 0xea580c,
          emissiveIntensity: 1.5,
          roughness: 0.35,
        }),
      );
      weakPointMesh.position.set(0, 0.42, -0.24);
      weakPointMesh.visible = false;
      weakPointMesh.userData = { poolIdx: i, hitZone: 'back_weakpoint' as HitZone };
      torsoPivot.add(weakPointMesh);

      // Bloater toxic pustules cluster
      const bloaterCystsGroup = new THREE.Group();
      bloaterCystsGroup.visible = false;
      const cystOffsets = [
        [0.14, 0.33, 0.17, 0.16],
        [-0.12, 0.2, 0.18, 0.18],
        [0.02, 0.46, 0.15, 0.14],
        [0.16, 0.52, -0.12, 0.14],
        [-0.15, 0.28, -0.15, 0.17],
      ] as const;
      for (const [cx, cy, cz, rad] of cystOffsets) {
        const cyst = new THREE.Mesh(new THREE.SphereGeometry(rad, 8, 7), this.bloaterCystMat);
        cyst.position.set(cx, cy, cz);
        bloaterCystsGroup.add(cyst);
      }
      torsoPivot.add(bloaterCystsGroup);

      // Articulated Arms (Shoulder -> UpperArm + Elbow Pivot -> Forearm/Claw)
      const leftArm = new THREE.Group();
      leftArm.position.set(-0.31, 0.52, 0);
      leftArm.rotation.z = -0.14;
      const laMesh = new THREE.Mesh(this.upperArmGeo, skinMat);
      laMesh.userData = { poolIdx: i, hitZone: 'limb' as HitZone };
      const laSleeve = new THREE.Mesh(new THREE.CylinderGeometry(0.072, 0.068, 0.2, 8), clothMat);
      laSleeve.position.y = -0.1;
      const leftForearm = new THREE.Group();
      leftForearm.position.set(0, -0.27, 0);
      const lfaMesh = new THREE.Mesh(this.forearmGeo, skinMat);
      lfaMesh.userData = { poolIdx: i, hitZone: 'limb' as HitZone };
      leftForearm.add(lfaMesh);
      leftArm.add(laMesh, laSleeve, leftForearm);
      torsoPivot.add(leftArm);

      const rightArm = new THREE.Group();
      rightArm.position.set(0.31, 0.52, 0);
      rightArm.rotation.z = 0.14;
      const raMesh = new THREE.Mesh(this.upperArmGeo, skinMat);
      raMesh.userData = { poolIdx: i, hitZone: 'limb' as HitZone };
      const raSleeve = new THREE.Mesh(new THREE.CylinderGeometry(0.072, 0.068, 0.2, 8), clothMat);
      raSleeve.position.y = -0.1;
      const rightForearm = new THREE.Group();
      rightForearm.position.set(0, -0.27, 0);
      const rfaMesh = new THREE.Mesh(this.forearmGeo, skinMat);
      rfaMesh.userData = { poolIdx: i, hitZone: 'limb' as HitZone };
      rightForearm.add(rfaMesh);
      rightArm.add(raMesh, raSleeve, rightForearm);
      torsoPivot.add(rightArm);

      // Articulated Legs (Hip -> Thigh + Knee Pivot -> Shin/Boot)
      const leftLeg = new THREE.Group();
      leftLeg.position.set(-0.13, 0.72, 0);
      const llMesh = new THREE.Mesh(this.thighGeo, pantsMat);
      llMesh.userData = { poolIdx: i, hitZone: 'limb' as HitZone };
      const leftShin = new THREE.Group();
      leftShin.position.set(0, -0.34, 0);
      const lsMesh = new THREE.Mesh(this.shinGeo, pantsMat);
      lsMesh.userData = { poolIdx: i, hitZone: 'limb' as HitZone };
      leftShin.add(lsMesh);
      leftLeg.add(llMesh, leftShin);
      humanoidGroup.add(leftLeg);

      const rightLeg = new THREE.Group();
      rightLeg.position.set(0.13, 0.72, 0);
      const rlMesh = new THREE.Mesh(this.thighGeo, pantsMat);
      rlMesh.userData = { poolIdx: i, hitZone: 'limb' as HitZone };
      const rightShin = new THREE.Group();
      rightShin.position.set(0, -0.34, 0);
      const rsMesh = new THREE.Mesh(this.shinGeo, pantsMat);
      rsMesh.userData = { poolIdx: i, hitZone: 'limb' as HitZone };
      rightShin.add(rsMesh);
      rightLeg.add(rlMesh, rightShin);
      humanoidGroup.add(rightLeg);

      // =====================================================
      // B. TRUE QUADRUPED HOUND RIG
      // =====================================================
      const houndGroup = new THREE.Group();
      houndGroup.visible = false;
      bodyGroup.add(houndGroup);

      const hBody = new THREE.Mesh(this.houndBodyGeo, this.houndSkinMat);
      hBody.position.set(0, 0.52, 0);
      hBody.castShadow = !this.isSoftwareGl;
      hBody.userData = { poolIdx: i, hitZone: 'torso' as HitZone };
      houndGroup.add(hBody);

      const houndHead = new THREE.Group();
      houndHead.position.set(0, 0.66, 0.52);
      const hHeadMesh = new THREE.Mesh(this.houndHeadGeo, this.houndSkinMat);
      hHeadMesh.userData = { poolIdx: i, hitZone: 'head' as HitZone };
      const hEyes = new THREE.Mesh(this.houndEyesGeo, this.houndEyeMat);
      houndHead.add(hHeadMesh, hEyes);
      const houndEyeHalos = ([-0.055, 0.055] as const).map((ex) => {
        const sp = new THREE.Sprite(
          new THREE.SpriteMaterial({
            map: this.mats.eyeGlowTex,
            color: 0xef4444,
            transparent: true,
            opacity: 0.95,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
          }),
        );
        sp.position.set(ex, 0.035, 0.118);
        sp.scale.set(0.15, 0.15, 1);
        houndHead.add(sp);
        return sp;
      }) as [THREE.Sprite, THREE.Sprite];
      houndGroup.add(houndHead);

      const houndLegCoords = [
        [-0.14, 0.48, 0.28],
        [0.14, 0.48, 0.28],
        [-0.14, 0.48, -0.3],
        [0.14, 0.48, -0.3],
      ] as const;
      const houndLegs = houndLegCoords.map(([lx, ly, lz]) => {
        const lg = new THREE.Group();
        lg.position.set(lx, ly, lz);
        const lm = new THREE.Mesh(this.houndLegGeo, this.houndSkinMat);
        lm.userData = { poolIdx: i, hitZone: 'limb' as HitZone };
        lg.add(lm);
        houndGroup.add(lg);
        return lg;
      }) as [THREE.Group, THREE.Group, THREE.Group, THREE.Group];

      // Spawn ground fog burst ring (used when Hounds emerge)
      const spawnFogRing = new THREE.Mesh(
        new THREE.RingGeometry(0.35, 1.05, 16),
        new THREE.MeshBasicMaterial({
          color: 0xa3e635,
          transparent: true,
          opacity: 0,
          side: THREE.DoubleSide,
          depthWrite: false,
        }),
      );
      spawnFogRing.rotation.x = -Math.PI / 2;
      spawnFogRing.position.y = 0.06;
      spawnFogRing.visible = false;
      root.add(spawnFogRing);

      const hitboxMeshes = [
        headHitProxy,
        headMesh,
        torsoMesh,
        laMesh,
        lfaMesh,
        raMesh,
        rfaMesh,
        llMesh,
        lsMesh,
        rlMesh,
        rsMesh,
        weakPointMesh,
        hBody,
        hHeadMesh,
        ...(houndLegs.map((lg) => lg.children[0] as THREE.Mesh)),
      ];
      this.allHitboxes.push(...hitboxMeshes);

      this.scene.add(root);

      this.entities.push({
        id: 0,
        active: false,
        type: 'shambler',
        bossRole: 'none',
        speedClass: 'walk',
        moveSpeed: BALANCE.enemies.shambler.walkSpeed,
        health: 150,
        maxHealth: 150,
        state: 'dead',
        stateTimer: 0,
        bloaterBeepTimer: 0,
        attackCooldown: 0,
        attackDealt: false,
        chargeCooldown: 4,
        groanTimer: 2,
        stepSoundTimer: 0.4,
        hitReactTimer: 0,
        hitReactDirX: 0,
        hitReactDirZ: 0,
        hitReactZone: 'torso',
        hitFlashTimer: 0,
        hitFlashActive: false,
        deathFallRoll: 0,
        deathPitchTarget: -Math.PI * 0.48,
        deathRollTarget: 0,
        deathVx: 0,
        deathVz: 0,
        staggerTimer: 0,
        isCrawler: false,
        woundedShown: false,
        x: 0,
        y: 0,
        z: 0,
        prevX: 0,
        prevZ: 0,
        yaw: 0,
        vx: 0,
        vz: 0,
        kbVx: 0,
        kbVz: 0,
        strideBlend: 0,
        lastProgressX: 0,
        lastProgressZ: 0,
        stuckTimer: 0,
        stuckCount: 0,
        windowId: null,
        corpseTimer: 0,
        dissolveUniform,
        root,
        bodyGroup,
        humanoidGroup,
        houndGroup,
        contactShadow,
        torsoPivot,
        headPivot,
        headMesh,
        torsoMesh,
        leftArm,
        leftForearm,
        rightArm,
        rightForearm,
        leftLeg,
        leftShin,
        rightLeg,
        rightShin,
        houndLegs,
        houndHead,
        weakPointMesh,
        bruteGearGroup,
        bloaterCystsGroup,
        fungalGrowthMesh,
        eyesMesh,
        eyeHalos,
        houndEyeHalos,
        headStumpMesh,
        headPopped: false,
        bloodWoundMesh,
        hitboxMeshes,
        baseMaterials: [skinMat, clothMat, pantsMat, bloodMat],
        dissolveMaterials: null,
        rigMeshes: {
          skinMeshes: [headMesh, laMesh, lfaMesh, raMesh, rfaMesh],
          clothMeshes: [torsoMesh, laSleeve, raSleeve],
          pantsMeshes: [llMesh, lsMesh, rlMesh, rsMesh],
          bloodMeshes: [chestBlood, bloodWoundMesh, headStumpMesh],
          houndMeshes: [hBody, hHeadMesh, ...(houndLegs.map((lg) => lg.children[0] as THREE.Mesh))],
        },
        animPhase: i * 1.13,
        spawnFogTimer: 0,
        spawnRiseTimer: 0,
        spawnFogRing,
      });
    }
  }

  private createDissolveMaterial(
    srcMat: THREE.MeshStandardMaterial,
    dissolveUniform: { value: number },
  ): THREE.MeshStandardMaterial {
    const mat = new THREE.MeshStandardMaterial({
      color: srcMat.color.getHex(),
      map: srcMat.map,
      normalMap: srcMat.normalMap,
      roughnessMap: srcMat.roughnessMap,
      roughness: srcMat.roughness,
      metalness: srcMat.metalness,
    });
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uDissolve = dissolveUniform;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vLocalDissolve;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvLocalDissolve = position;');
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
           uniform float uDissolve;
           varying vec3 vLocalDissolve;
           float dHash(vec3 p) { return fract(sin(dot(p, vec3(12.9898,78.233,37.719))) * 43758.5453); }`,
        )
        .replace(
          '#include <clipping_planes_fragment>',
          `#include <clipping_planes_fragment>
           if (uDissolve > 0.001) {
             float n = dHash(floor(vLocalDissolve * 18.0));
             if (n < uDissolve) discard;
           }`,
        );
    };
    mat.customProgramCacheKey = () => `zombie_dissolve_${mat.map ? 'tex' : 'flat'}`;
    return mat;
  }

  public getAliveCount(): number {
    let c = 0;
    for (const e of this.entities) {
      if (e.active && e.state !== 'dying' && e.state !== 'dead') c++;
    }
    return c;
  }

  public getActiveEnemyTypes(): EnemyType[] {
    const set = new Set<EnemyType>();
    for (const e of this.entities) {
      if (e.active && e.state !== 'dying' && e.state !== 'dead') set.add(e.type);
    }
    return Array.from(set);
  }

  public getActiveBossState(): BossHudState | null {
    for (const e of this.entities) {
      if (!e.active || e.state === 'dying' || e.state === 'dead' || e.bossRole === 'none') continue;
      return {
        name: e.bossRole === 'alpha_boss' ? 'ALPHA BLOOM BRUTE' : 'CONTAINMENT WARDEN',
        health: Math.max(0, Math.ceil(e.health)),
        maxHealth: Math.max(1, Math.ceil(e.maxHealth)),
      };
    }
    return null;
  }

  public getActiveBossPosition(role: 'warden' | 'alpha_boss'): { x: number; z: number } | null {
    for (const e of this.entities) {
      if (!e.active || e.state === 'dying' || e.state === 'dead') continue;
      if (e.bossRole === role) return { x: e.x, z: e.z };
    }
    return null;
  }

  public getNearestFusingBloaterDist(playerPos: THREE.Vector3): number | null {
    let best: number | null = null;
    for (const e of this.entities) {
      if (!e.active || e.type !== 'bloater' || e.state !== 'bloater_fuse') continue;
      const d = Math.hypot(e.x - playerPos.x, e.z - playerPos.z);
      if (best === null || d < best) best = d;
    }
    return best;
  }

  public spawnBoss(
    role: 'warden' | 'alpha_boss',
    round: number,
    spawnPoint: SpawnPoint,
    rng: SeededRng,
    difficulty: DifficultyId = 'survivor',
  ): boolean {
    let slot = this.entities.find((e) => !e.active);
    if (!slot) {
      // Reclaim a non-boss normal zombie slot so campaign bosses always spawn
      slot = this.entities.find((e) => e.active && e.bossRole === 'none');
      if (!slot) return false;
      slot.active = false;
      slot.state = 'dead';
      slot.root.visible = false;
    }
    const ok = this.spawnEnemy('brute', round, spawnPoint, rng, difficulty);
    if (!ok) return false;
    const spawned =
      this.entities.find((e) => e.active && e.type === 'brute' && e.bossRole === 'none') ?? slot;
    spawned.bossRole = role;
    const baseHp = calculateZombieHealth(Math.max(4, round), difficulty);
    const diffMult = DIFFICULTY_PRESETS[difficulty]?.healthMult ?? 1.0;
    if (role === 'warden') {
      spawned.maxHealth = Math.round(baseHp * BALANCE.campaign.wardenHealthMult);
      spawned.health = spawned.maxHealth;
      spawned.moveSpeed = 2.65 * (DIFFICULTY_PRESETS[difficulty]?.speedMult ?? 1.0);
      spawned.root.scale.set(1.44, 1.44, 1.44);
      for (const sp of spawned.eyeHalos) {
        (sp.material as THREE.SpriteMaterial).color.setHex(0xf97316);
      }
    } else {
      spawned.maxHealth = Math.round(
        (BALANCE.campaign.alphaBossBaseHealth + round * BALANCE.campaign.alphaBossPerRoundHealth) *
          diffMult,
      );
      spawned.health = spawned.maxHealth;
      spawned.moveSpeed = 2.85 * (DIFFICULTY_PRESETS[difficulty]?.speedMult ?? 1.0);
      const s = BALANCE.campaign.alphaBossScale;
      spawned.root.scale.set(s, s, s);
      spawned.fungalGrowthMesh.visible = true;
      for (const sp of spawned.eyeHalos) {
        (sp.material as THREE.SpriteMaterial).color.setHex(0xfbbf24);
      }
    }
    spawned.windowId = null;
    spawned.state = 'chase';
    spawned.root.updateMatrixWorld(true);
    this.audio.playBruteChargeRoar(spawned.x, 1.6, spawned.z);
    return true;
  }

  public spawnEnemy(
    type: EnemyType,
    round: number,
    spawnPoint: SpawnPoint,
    rng: SeededRng,
    difficulty: DifficultyId = 'survivor',
  ): boolean {
    const slot = this.entities.find((e) => !e.active);
    if (!slot) return false;

    const preset = DIFFICULTY_PRESETS[difficulty] ?? DIFFICULTY_PRESETS.survivor;
    const baseHp = calculateZombieHealth(round, difficulty);
    let hp = baseHp;
    let speedClass: 'walk' | 'run' | 'sprint' = 'walk';
    let moveSpeed: number = BALANCE.enemies.shambler.walkSpeed;

    if (type === 'shambler') {
      const weights = getSpeedClassWeights(round);
      const r = rng.next();
      if (r < weights.walk) {
        speedClass = 'walk';
        moveSpeed = BALANCE.enemies.shambler.walkSpeed;
      } else if (r < weights.walk + weights.run) {
        speedClass = 'run';
        moveSpeed = BALANCE.enemies.shambler.runSpeed;
      } else {
        speedClass = 'sprint';
        moveSpeed = BALANCE.enemies.shambler.sprintSpeed;
      }
      moveSpeed *= 0.94 + rng.next() * 0.12;
    } else if (type === 'hound') {
      hp = Math.max(40, Math.round(baseHp * BALANCE.enemies.hound.healthRatio));
      speedClass = 'sprint';
      moveSpeed = BALANCE.enemies.hound.speed;
    } else if (type === 'bloater') {
      hp = Math.round(baseHp * BALANCE.enemies.bloater.healthMult);
      speedClass = 'walk';
      moveSpeed = BALANCE.enemies.bloater.speed;
    } else if (type === 'brute') {
      hp = Math.round(baseHp * BALANCE.enemies.brute.healthMult);
      speedClass = 'run';
      moveSpeed = BALANCE.enemies.brute.speed;
    }
    moveSpeed *= preset.speedMult;

    slot.id = this.nextZombieId++;
    slot.active = true;
    slot.type = type;
    slot.bossRole = 'none';
    slot.speedClass = speedClass;
    slot.moveSpeed = moveSpeed;
    slot.health = hp;
    slot.maxHealth = hp;
    slot.isCrawler = false;
    slot.woundedShown = false;
    slot.dissolveUniform.value = 0;
    slot.corpseTimer = 0;
    slot.bloaterBeepTimer = 0;
    slot.attackCooldown = 0;
    slot.attackDealt = false;
    slot.chargeCooldown = 4.0;
    slot.hitReactTimer = 0;
    slot.hitReactZone = 'torso';
    slot.hitFlashTimer = 0;
    slot.hitFlashActive = false;
    slot.deathFallRoll = ((slot.id % 5) - 2) * 0.16;
    slot.deathPitchTarget = -Math.PI * 0.48;
    slot.deathRollTarget = slot.deathFallRoll;
    slot.deathVx = 0;
    slot.deathVz = 0;
    slot.staggerTimer = 0;
    slot.groanTimer = 1 + rng.next() * 4;
    slot.stepSoundTimer = 0.25 + rng.next() * 0.35;

    const jitterX = spawnPoint.position.x + (rng.next() - 0.5) * 1.2;
    const jitterZ = spawnPoint.position.z + (rng.next() - 0.5) * 1.2;
    if (!spawnPoint.windowId && !this.nav.isWalkableWorld(jitterX, jitterZ)) {
      slot.x = spawnPoint.position.x;
      slot.z = spawnPoint.position.z;
    } else {
      slot.x = jitterX;
      slot.z = jitterZ;
    }
    slot.y = 0;
    slot.prevX = slot.x;
    slot.prevZ = slot.z;
    slot.vx = 0;
    slot.vz = 0;
    slot.kbVx = 0;
    slot.kbVz = 0;
    slot.strideBlend = 0;
    slot.lastProgressX = slot.x;
    slot.lastProgressZ = slot.z;
    slot.stuckTimer = 0;

    // Reset rig transforms
    slot.leftLeg.visible = true;
    slot.rightLeg.visible = true;
    slot.headMesh.visible = true;
    slot.headStumpMesh.visible = false;
    slot.headPopped = false;
    slot.bloodWoundMesh.visible = false;
    slot.contactShadow.visible = true;
    slot.bodyGroup.position.set(0, 0, 0);
    slot.bodyGroup.rotation.set(0, 0, 0);
    slot.torsoPivot.rotation.set(0, 0, 0);
    slot.headPivot.rotation.set(0, 0, 0);
    slot.leftForearm.rotation.set(0, 0, 0);
    slot.rightForearm.rotation.set(0, 0, 0);
    slot.leftShin.rotation.set(0, 0, 0);
    slot.rightShin.rotation.set(0, 0, 0);

    if (type === 'hound') {
      slot.humanoidGroup.visible = false;
      slot.houndGroup.visible = true;
      slot.bruteGearGroup.visible = false;
      slot.bloaterCystsGroup.visible = false;
      slot.weakPointMesh.visible = false;
      slot.root.scale.set(1.0, 1.0, 1.0);
      const groundRise = !spawnPoint.windowId;
      slot.spawnFogTimer = groundRise ? 1.0 : 0;
      slot.spawnRiseTimer = groundRise ? 0.4 : 0;
      (slot.spawnFogRing.material as THREE.MeshBasicMaterial).color.setHex(0xef4444);
      slot.spawnFogRing.visible = groundRise;
      slot.baseMaterials[0] = this.houndSkinMat;
      this.applyHoundMaterial(slot, this.houndSkinMat);
      if (groundRise) {
        this.audio.playSpawnEruption(slot.x, 0.4, slot.z);
      }
    } else {
      slot.humanoidGroup.visible = true;
      slot.houndGroup.visible = false;
      const groundRise = !spawnPoint.windowId;
      slot.spawnRiseTimer = groundRise ? 0.65 : 0;
      slot.spawnFogTimer = groundRise ? 0.85 : 0;
      (slot.spawnFogRing.material as THREE.MeshBasicMaterial).color.setHex(0xd97706);
      slot.spawnFogRing.visible = groundRise;
      if (groundRise) {
        this.audio.playSpawnEruption(slot.x, 0.4, slot.z);
      }

      slot.weakPointMesh.visible = type === 'brute';
      slot.bruteGearGroup.visible = type === 'brute';
      slot.bloaterCystsGroup.visible = type === 'bloater';
      slot.fungalGrowthMesh.visible = type === 'shambler' && slot.id % 2 === 0;

      if (type === 'bloater') {
        slot.root.scale.set(1.36, 1.04, 1.38);
        slot.baseMaterials[0] = this.bloaterSkinMat;
        slot.baseMaterials[1] = this.bloaterClothMat;
        slot.eyesMesh.material = this.bloaterEyeMat;
        for (const sp of slot.eyeHalos) {
          (sp.material as THREE.SpriteMaterial).color.setHex(0xa3e635);
        }
      } else if (type === 'brute') {
        slot.root.scale.set(1.38, 1.36, 1.36);
        slot.baseMaterials[0] = this.bruteSkinMat;
        slot.baseMaterials[1] = this.bruteArmorMat;
        slot.eyesMesh.material = this.houndEyeMat;
        for (const sp of slot.eyeHalos) {
          (sp.material as THREE.SpriteMaterial).color.setHex(0xef4444);
        }
      } else {
        const skinVar = (slot.id + Math.floor(rng.next() * 3)) % this.mats.zombieSkins.length;
        const clothVar = (slot.id + Math.floor(rng.next() * 6)) % this.mats.zombieCloths.length;
        const hScale = 0.95 + rng.next() * 0.1;
        slot.root.scale.set(0.98 + rng.next() * 0.08, hScale, 1.0);
        slot.baseMaterials[0] = this.mats.zombieSkins[skinVar]!;
        slot.baseMaterials[1] = this.mats.zombieCloths[clothVar]!;
        slot.eyesMesh.material = this.eyeMat;
        for (const sp of slot.eyeHalos) {
          (sp.material as THREE.SpriteMaterial).color.setHex(0xfbbf24);
        }
      }
      this.applyMaterialsToRig(slot, slot.baseMaterials);
    }

    if (spawnPoint.windowId) {
      slot.windowId = spawnPoint.windowId;
      slot.state = 'approach_window';
    } else {
      slot.windowId = null;
      slot.state = 'chase';
    }

    slot.root.position.set(slot.x, slot.y, slot.z);
    slot.root.visible = true;
    slot.root.updateMatrixWorld(true);
    return true;
  }

  private static isVisibleInHierarchy(obj: THREE.Object3D): boolean {
    let cur: THREE.Object3D | null = obj;
    while (cur) {
      if (!cur.visible) return false;
      cur = cur.parent;
    }
    return true;
  }

  public raycastShot(
    origin: THREE.Vector3,
    direction: THREE.Vector3,
    maxDistance: number,
  ): {
    poolIdx: number;
    hitZone: HitZone;
    point: THREE.Vector3;
    normal: THREE.Vector3;
    distance: number;
  } | null {
    if (maxDistance <= 0.05) return null;
    this.raycaster.set(origin, direction);
    this.raycaster.near = 0.02;
    this.raycaster.far = maxDistance;
    const hits = this.raycaster.intersectObjects(this.allHitboxes, false);
    const validHits: {
      poolIdx: number;
      hitZone: HitZone;
      point: THREE.Vector3;
      normal: THREE.Vector3;
      distance: number;
    }[] = [];

    for (const h of hits) {
      const poolIdx = h.object.userData.poolIdx as number | undefined;
      if (poolIdx === undefined) continue;
      const ent = this.entities[poolIdx];
      if (!ent || !ent.active || ent.state === 'dying' || ent.state === 'dead') continue;
      if (!ZombieSystem.isVisibleInHierarchy(h.object)) continue;
      validHits.push({
        poolIdx,
        hitZone: (h.object.userData.hitZone as HitZone) ?? 'torso',
        point: h.point.clone(),
        normal: h.face ? h.face.normal.clone() : new THREE.Vector3(0, 1, 0),
        distance: h.distance,
      });
    }

    if (validHits.length === 0) return null;
    const first = validHits[0]!;
    if (first.hitZone !== 'limb') return first;

    // Outstretched zombie arms must not shield torso, weakpoint, or headshots on the same zombie
    const zonePriority: Record<HitZone, number> = {
      head: 4,
      back_weakpoint: 3,
      torso: 2,
      limb: 1,
    };
    let best = first;
    for (let i = 1; i < validHits.length; i++) {
      const cand = validHits[i]!;
      if (cand.poolIdx !== first.poolIdx) break;
      if (cand.distance - first.distance > 0.65) break;
      if (zonePriority[cand.hitZone] > zonePriority[best.hitZone]) {
        best = cand;
      }
    }
    return best;
  }

  public raycastMeleeCone(
    origin: THREE.Vector3,
    direction: THREE.Vector3,
    maxDistance: number,
    minCos = 0.55,
  ): {
    poolIdx: number;
    hitZone: HitZone;
    point: THREE.Vector3;
    distance: number;
  } | null {
    let bestIdx = -1;
    let bestDist = maxDistance;
    const bestPoint = new THREE.Vector3();

    for (let i = 0; i < this.entities.length; i++) {
      const e = this.entities[i]!;
      if (!e.active || e.state === 'dying' || e.state === 'dead') continue;
      const targetY = e.y + (e.type === 'hound' ? 0.5 : e.isCrawler ? 0.42 : 1.05);
      const tx = e.x - origin.x;
      const ty = targetY - origin.y;
      const tz = e.z - origin.z;
      const dist = Math.hypot(tx, ty, tz);
      if (dist > bestDist || dist < 0.001) continue;
      const dot = (tx * direction.x + ty * direction.y + tz * direction.z) / dist;
      if (dot < minCos) continue;
      bestDist = dist;
      bestIdx = i;
      bestPoint.set(e.x, targetY, e.z);
    }

    if (bestIdx === -1) return null;
    return {
      poolIdx: bestIdx,
      hitZone: 'torso',
      point: bestPoint,
      distance: bestDist,
    };
  }

  public applyDamageToEntity(
    poolIdx: number,
    damage: number,
    hitZone: HitZone,
    dirX: number,
    dirZ: number,
    instaKill: boolean,
  ): { killed: boolean; enemyType: EnemyType; x: number; y: number; z: number; explodedBloater: boolean } {
    const e = this.entities[poolIdx]!;
    let finalDamage = damage;
    if (hitZone === 'back_weakpoint' && e.type === 'brute') {
      finalDamage *= BALANCE.enemies.brute.backWeakpointMult;
    }
    if (instaKill) {
      finalDamage = e.type === 'brute' ? Math.max(finalDamage, e.maxHealth * 0.45) : e.health + 999;
    }

    e.health -= finalDamage;
    e.hitReactTimer = 0.26;
    e.hitReactDirX = dirX;
    e.hitReactDirZ = dirZ;
    e.hitReactZone = hitZone;
    e.hitFlashTimer = 0.065;

    // Velocity-based knockback stagger away from bullet/melee trajectory
    const dirLen = Math.hypot(dirX, dirZ);
    if (dirLen > 0.001 && e.state !== 'climb_in') {
      const ndx = dirX / dirLen;
      const ndz = dirZ / dirLen;
      const kbSpeed = e.type === 'brute' ? 0.85 : hitZone === 'head' ? 3.8 : 2.6;
      e.kbVx = THREE.MathUtils.clamp(e.kbVx + ndx * kbSpeed, -6.5, 6.5);
      e.kbVz = THREE.MathUtils.clamp(e.kbVz + ndz * kbSpeed, -6.5, 6.5);
    }

    // Show heavy chest wound when below 55% health
    if (!e.woundedShown && e.health > 0 && e.health < e.maxHealth * 0.55 && e.type !== 'hound') {
      e.woundedShown = true;
      e.bloodWoundMesh.visible = true;
    }

    if (
      hitZone === 'limb' &&
      e.type === 'shambler' &&
      e.health > 0 &&
      e.health < e.maxHealth * 0.32 &&
      !e.isCrawler
    ) {
      e.isCrawler = true;
      e.moveSpeed = 1.05;
      e.leftLeg.visible = false;
      e.rightLeg.visible = false;
    }

    if (e.type !== 'brute') {
      e.staggerTimer = Math.max(e.staggerTimer, hitZone === 'head' ? 0.22 : 0.14);
    }

    if (e.health <= 0) {
      if (hitZone === 'head' && e.type !== 'hound' && e.type !== 'brute') {
        e.headPopped = true;
        e.headMesh.visible = false;
        e.headStumpMesh.visible = true;
      }
      const wasBloater = e.type === 'bloater';
      this.killEntity(e, dirX, dirZ, hitZone === 'head' ? 3.8 : 2.7);
      return {
        killed: true,
        enemyType: e.type,
        x: e.x,
        y: e.y + 1.0,
        z: e.z,
        explodedBloater: wasBloater,
      };
    }

    return {
      killed: false,
      enemyType: e.type,
      x: e.x,
      y: e.y + 1.0,
      z: e.z,
      explodedBloater: false,
    };
  }

  public applySplashDamage(
    cx: number,
    cy: number,
    cz: number,
    radius: number,
    innerDamage: number,
    outerDamage: number,
    instaKill: boolean,
    onKill: (e: ZombieEntity) => void,
  ): number {
    let kills = 0;
    const rSq = radius * radius;
    for (const e of this.entities) {
      if (!e.active || e.state === 'dying' || e.state === 'dead') continue;
      const dx = e.x - cx;
      const dy = e.y + 0.9 - cy;
      const dz = e.z - cz;
      const dSq = dx * dx + dy * dy + dz * dz;
      if (dSq > rSq) continue;
      const distHoriz = Math.hypot(dx, dz);
      const rdx = distHoriz > 0.01 ? dx / distHoriz : Math.sin(e.yaw);
      const rdz = distHoriz > 0.01 ? dz / distHoriz : Math.cos(e.yaw);
      const t = Math.sqrt(dSq) / radius;
      const dmg = instaKill
        ? e.type === 'brute'
          ? e.maxHealth * 0.5
          : e.health + 999
        : THREE.MathUtils.lerp(innerDamage, outerDamage, t);
      e.health -= dmg;
      e.hitFlashTimer = 0.075;
      if (e.health <= 0) {
        this.killEntity(e, rdx, rdz, 5.4 * (1 - t * 0.4));
        onKill(e);
        kills++;
      } else {
        e.staggerTimer = 0.32;
        const push = (e.type === 'brute' ? 2.2 : 5.2) * (1 - t * 0.5);
        e.kbVx = THREE.MathUtils.clamp(e.kbVx + rdx * push, -7.5, 7.5);
        e.kbVz = THREE.MathUtils.clamp(e.kbVz + rdz * push, -7.5, 7.5);
      }
    }
    return kills;
  }

  public pushAwayFrom(cx: number, cz: number, radius: number, strength: number): void {
    const rSq = radius * radius;
    for (const e of this.entities) {
      if (!e.active || e.state === 'dying' || e.state === 'dead') continue;
      const dx = e.x - cx;
      const dz = e.z - cz;
      const dSq = dx * dx + dz * dz;
      if (dSq < rSq && dSq > 0.001) {
        const d = Math.sqrt(dSq);
        const nx = e.x + (dx / d) * strength;
        const nz = e.z + (dz / d) * strength;
        if (this.nav.isWalkableWorld(nx, nz)) {
          e.x = nx;
          e.z = nz;
        }
        e.kbVx += (dx / d) * 4.5;
        e.kbVz += (dz / d) * 4.5;
        e.staggerTimer = 1.4;
      }
    }
  }

  public killAllNonBoss(onKill: (e: ZombieEntity) => void): void {
    for (const e of this.entities) {
      if (!e.active || e.state === 'dying' || e.state === 'dead') continue;
      if (e.bossRole !== 'none') {
        e.health = Math.max(1, e.health - e.maxHealth * 0.15);
        continue;
      }
      if (e.type === 'brute') {
        e.health -= e.maxHealth * 0.4;
        if (e.health <= 0) {
          this.killEntity(e);
          onKill(e);
        }
        continue;
      }
      this.killEntity(e);
      onKill(e);
    }
  }

  public killAll(): void {
    for (const e of this.entities) {
      if (!e.active) continue;
      e.active = false;
      e.state = 'dead';
      e.root.visible = false;
    }
  }

  private applyHoundMaterial(e: ZombieEntity, mat: THREE.MeshStandardMaterial): void {
    for (const m of e.rigMeshes.houndMeshes) {
      m.material = mat;
    }
  }

  private applyMaterialsToRig(
    e: ZombieEntity,
    mats: [
      THREE.MeshStandardMaterial,
      THREE.MeshStandardMaterial,
      THREE.MeshStandardMaterial,
      THREE.MeshStandardMaterial,
    ],
  ): void {
    for (const m of e.rigMeshes.skinMeshes) m.material = mats[0];
    for (const m of e.rigMeshes.clothMeshes) m.material = mats[1];
    for (const m of e.rigMeshes.pantsMeshes) m.material = mats[2];
    for (const m of e.rigMeshes.bloodMeshes) m.material = mats[3];
  }

  private killEntity(e: ZombieEntity, dirX = 0, dirZ = 0, impulseSpeed = 2.4): void {
    e.state = 'dying';
    e.stateTimer = 0;
    e.corpseTimer = 0;
    e.hitFlashTimer = 0;
    e.hitFlashActive = false;
    if (e.bossRole !== 'none') {
      const role = e.bossRole;
      e.bossRole = 'none';
      this.onBossKilled?.(role, e.x, e.y + 1.0, e.z);
    }

    const fall = computeDirectionalFall(
      dirX,
      dirZ,
      e.yaw,
      impulseSpeed,
      ((e.id % 5) - 2) * 0.14,
    );
    e.deathPitchTarget = fall.targetPitchX;
    e.deathRollTarget = fall.targetRollZ;
    e.deathVx = fall.slideVx + e.kbVx * 0.5;
    e.deathVz = fall.slideVz + e.kbVz * 0.5;
    e.kbVx = 0;
    e.kbVz = 0;

    if (!e.dissolveMaterials) {
      e.dissolveMaterials = [
        this.createDissolveMaterial(e.baseMaterials[0], e.dissolveUniform),
        this.createDissolveMaterial(e.baseMaterials[1], e.dissolveUniform),
        this.createDissolveMaterial(e.baseMaterials[2], e.dissolveUniform),
        this.createDissolveMaterial(e.baseMaterials[3], e.dissolveUniform),
      ];
    } else {
      for (let idx = 0; idx < 4; idx++) {
        const dm = e.dissolveMaterials[idx]!;
        const src = e.baseMaterials[idx]!;
        const mapChanged = dm.map !== src.map;
        dm.color.copy(src.color);
        dm.map = src.map;
        dm.normalMap = src.normalMap;
        dm.roughnessMap = src.roughnessMap;
        dm.roughness = src.roughness;
        dm.metalness = src.metalness;
        if (mapChanged) dm.needsUpdate = true;
      }
    }

    if (e.type === 'hound') {
      this.applyHoundMaterial(e, e.dissolveMaterials[0]);
    } else {
      this.applyMaterialsToRig(e, e.dissolveMaterials);
    }
  }

  public hasCombatLineOfSight(e: ZombieEntity, playerPos: THREE.Vector3): boolean {
    const playerFeetY = playerPos.y - BALANCE.player.capsuleHeight * 0.5;
    const lowStartY = e.y + (e.type === 'hound' || e.isCrawler ? 0.38 : 0.58);
    const lowEndY = playerFeetY + (e.type === 'hound' || e.isCrawler ? 0.42 : 0.58);
    this.tmpZombieEye.set(e.x, lowStartY, e.z);
    this.tmpPlayerEye.set(playerPos.x, lowEndY, playerPos.z);
    if (!this.bvh.hasLineOfSight(this.tmpZombieEye, this.tmpPlayerEye)) {
      return false;
    }

    const highStartY = e.y + (e.type === 'hound' || e.isCrawler ? 0.62 : 1.25);
    const highEndY = playerFeetY + (e.type === 'hound' || e.isCrawler ? 0.82 : 1.25);
    this.tmpZombieEye.set(e.x, highStartY, e.z);
    this.tmpPlayerEye.set(playerPos.x, highEndY, playerPos.z);
    return this.bvh.hasLineOfSight(this.tmpZombieEye, this.tmpPlayerEye);
  }

  public update(
    dt: number,
    playerPos: THREE.Vector3,
    windows: Map<string, WindowBarricade>,
    unlockedZones: Set<ZoneId>,
    spawnPoints: SpawnPoint[],
    onMeleeHitPlayer: (damage: number, ax: number, az: number, source: DamageSource) => void,
    onBloaterExplode: (x: number, y: number, z: number) => void,
    onPlayerShove?: (vx: number, vz: number) => void,
  ): void {
    this.aiFrameCounter++;
    let anyFusingBloater = false;

    let activeAttackers = 0;
    for (let i = 0; i < MAX_ZOMBIES; i++) {
      const e = this.entities[i]!;
      const alive = e.active && e.state !== 'dying' && e.state !== 'dead';
      this.activeFlags[i] = alive ? 1 : 0;
      this.posX[i] = e.x;
      this.posZ[i] = e.z;
      if (alive && e.state === 'attack') {
        activeAttackers++;
      }
      if (alive && e.type === 'bloater' && e.state === 'bloater_fuse') {
        anyFusingBloater = true;
      }
    }
    this.bloaterCystMat.emissiveIntensity = anyFusingBloater
      ? 2.4 + Math.sin(performance.now() * 0.028) * 1.6
      : 1.25;
    this.nav.rebuildSpatialHash(this.posX, this.posZ, this.activeFlags, MAX_ZOMBIES);

    let shoveTotalX = 0;
    let shoveTotalZ = 0;

    for (let i = 0; i < MAX_ZOMBIES; i++) {
      const e = this.entities[i]!;
      if (!e.active) continue;

      if (e.spawnFogTimer > 0) {
        e.spawnFogTimer -= dt;
        const p = 1 - Math.max(0, e.spawnFogTimer / 1.0);
        const ringMat = e.spawnFogRing.material as THREE.MeshBasicMaterial;
        ringMat.opacity = (1 - p) * 0.65;
        const s = 0.7 + p * 2.2;
        e.spawnFogRing.scale.set(s, s, 1);
        if (e.spawnFogTimer <= 0) {
          e.spawnFogRing.visible = false;
        }
      }

      if (e.spawnRiseTimer > 0) {
        e.spawnRiseTimer = Math.max(0, e.spawnRiseTimer - dt);
      }

      if (e.state === 'dying') {
        e.stateTimer += dt;
        if (Math.hypot(e.deathVx, e.deathVz) > 0.05) {
          const dnx = e.x + e.deathVx * dt;
          const dnz = e.z + e.deathVz * dt;
          if (this.nav.isWalkableWorld(dnx, dnz)) {
            e.x = dnx;
            e.z = dnz;
          } else {
            e.deathVx *= 0.25;
            e.deathVz *= 0.25;
          }
          const damp = Math.exp(-7.5 * dt);
          e.deathVx *= damp;
          e.deathVz *= damp;
        }

        const fallT = Math.min(1, e.stateTimer / 0.36);
        const ease = 1 - Math.pow(1 - fallT, 2.2);
        const fallingBack = e.deathPitchTarget > 0;
        e.bodyGroup.rotation.x = THREE.MathUtils.lerp(0, e.deathPitchTarget, ease);
        e.bodyGroup.rotation.z = THREE.MathUtils.lerp(0, e.deathRollTarget, ease);
        e.bodyGroup.position.y = THREE.MathUtils.lerp(
          0,
          e.type === 'hound' ? 0.14 : fallingBack ? 0.18 : 0.22,
          ease,
        );
        e.torsoPivot.rotation.x = THREE.MathUtils.lerp(
          e.torsoPivot.rotation.x,
          fallingBack ? -0.25 : 0.48,
          ease,
        );
        e.leftShin.rotation.x = THREE.MathUtils.lerp(
          e.leftShin.rotation.x,
          fallingBack ? 0.25 : 0.9,
          ease,
        );
        e.rightShin.rotation.x = THREE.MathUtils.lerp(
          e.rightShin.rotation.x,
          fallingBack ? 0.4 : 0.85,
          ease,
        );
        e.leftArm.rotation.x = THREE.MathUtils.lerp(
          e.leftArm.rotation.x,
          fallingBack ? -1.45 : -0.35,
          ease * 0.7,
        );
        e.rightArm.rotation.x = THREE.MathUtils.lerp(
          e.rightArm.rotation.x,
          fallingBack ? -1.15 : -0.25,
          ease * 0.7,
        );
        e.root.position.set(e.x, e.y, e.z);
        e.contactShadow.visible = e.corpseTimer < 1.2;
        e.corpseTimer += dt;
        if (e.corpseTimer > BALANCE.enemies.shambler.corpseFadeDelay) {
          const fadeT =
            (e.corpseTimer - BALANCE.enemies.shambler.corpseFadeDelay) /
            BALANCE.enemies.shambler.corpseFadeDuration;
          e.dissolveUniform.value = Math.min(1, fadeT);
          if (fadeT >= 1) {
            e.active = false;
            e.state = 'dead';
            e.root.visible = false;
          }
        }
        e.root.updateMatrixWorld(true);
        continue;
      }

      e.prevX = e.x;
      e.prevZ = e.z;
      e.attackCooldown = Math.max(0, e.attackCooldown - dt);
      e.chargeCooldown = Math.max(0, e.chargeCooldown - dt);
      e.hitReactTimer = Math.max(0, e.hitReactTimer - dt);
      e.staggerTimer = Math.max(0, e.staggerTimer - dt);

      // Update brief emissive hit-flash feedback
      if (e.hitFlashTimer > 0) {
        e.hitFlashTimer = Math.max(0, e.hitFlashTimer - dt);
        if (!e.hitFlashActive) {
          e.hitFlashActive = true;
          if (e.type === 'hound') {
            this.applyHoundMaterial(e, this.hitFlashSkinMat);
          } else {
            for (const m of e.rigMeshes.skinMeshes) m.material = this.hitFlashSkinMat;
            for (const m of e.rigMeshes.clothMeshes) m.material = this.hitFlashClothMat;
          }
        }
      } else if (e.hitFlashActive) {
        e.hitFlashActive = false;
        if (e.type === 'hound') {
          this.applyHoundMaterial(e, e.baseMaterials[0]);
        } else {
          this.applyMaterialsToRig(e, e.baseMaterials);
        }
      }

      // Integrate velocity knockback impulse with ground friction
      if (Math.hypot(e.kbVx, e.kbVz) > 0.04) {
        const kx = e.x + e.kbVx * dt;
        const kz = e.z + e.kbVz * dt;
        if (this.nav.isWalkableWorld(kx, kz)) {
          e.x = kx;
          e.z = kz;
        } else {
          if (this.nav.isWalkableWorld(kx, e.z)) e.x = kx;
          else if (this.nav.isWalkableWorld(e.x, kz)) e.z = kz;
        }
        const kbDamp = Math.exp(-10.5 * dt);
        e.kbVx *= kbDamp;
        e.kbVz *= kbDamp;
      } else {
        e.kbVx = 0;
        e.kbVz = 0;
      }

      const dxToP = playerPos.x - e.x;
      const dzToP = playerPos.z - e.z;
      const distToP = Math.hypot(dxToP, dzToP);
      const playerFeetY = playerPos.y - BALANCE.player.capsuleHeight * 0.5;
      const entityMinStandoff =
        e.type === 'hound'
          ? 1.68
          : e.isCrawler
            ? 1.72
            : e.type === 'brute'
              ? 1.54
              : e.type === 'bloater'
                ? 1.44
                : 1.36;

      e.groanTimer -= dt;
      if (e.groanTimer <= 0) {
        e.groanTimer = 3.5 + Math.random() * 5.0;
        const distSq = dxToP * dxToP + dzToP * dzToP;
        if (
          e.spawnRiseTimer <= 0 &&
          e.root.visible &&
          e.state !== 'approach_window' &&
          e.state !== 'tear_board' &&
          e.state !== 'climb_in' &&
          Math.abs(playerFeetY - e.y) < 1.55 &&
          distSq < 18 * 18 &&
          this.hasCombatLineOfSight(e, playerPos)
        ) {
          this.audio.playZombieSound(
            e.type === 'hound' ? 'hound' : e.type === 'brute' ? 'brute' : 'groan',
            e.x,
            e.y + 1.25,
            e.z,
          );
        }
      }

      // Ground-emerging spawns must visibly finish rising before chasing or swinging
      if (e.spawnRiseTimer > 0 && e.state === 'chase') {
        const targetYaw = Math.atan2(dxToP, dzToP);
        let diff = targetYaw - e.yaw;
        while (diff > Math.PI) diff -= Math.PI * 2;
        while (diff < -Math.PI) diff += Math.PI * 2;
        e.yaw += diff * Math.min(1, dt * 8);
      } else if (e.state === 'approach_window' && e.windowId) {
        const win = windows.get(e.windowId);
        if (!win) {
          e.state = 'chase';
        } else {
          const wx = win.outsidePos.x - e.x;
          const wz = win.outsidePos.z - e.z;
          const wd = Math.hypot(wx, wz);
          if (wd > 0.65) {
            e.vx = (wx / wd) * e.moveSpeed;
            e.vz = (wz / wd) * e.moveSpeed;
            const nx = e.x + e.vx * dt;
            const nz = e.z + e.vz * dt;
            if (wd < 1.8 || this.nav.isWalkableWorld(nx, nz)) {
              e.x = nx;
              e.z = nz;
            } else {
              if (this.nav.isWalkableWorld(nx, e.z)) e.x = nx;
              else if (this.nav.isWalkableWorld(e.x, nz)) e.z = nz;
            }
            e.yaw = Math.atan2(wx, wz);
          } else {
            e.state = win.intactCount > 0 ? 'tear_board' : 'climb_in';
            e.stateTimer = 0;
          }
        }
      } else if (e.state === 'tear_board' && e.windowId) {
        const win = windows.get(e.windowId);
        if (!win || win.intactCount <= 0) {
          e.state = 'climb_in';
          e.stateTimer = 0;
        } else {
          e.stateTimer += dt;
          e.yaw = Math.atan2(win.center.x - e.x, win.center.z - e.z);
          const tearTime = e.type === 'hound' ? 0.55 : BALANCE.enemies.shambler.boardTearTime;
          if (e.stateTimer >= tearTime) {
            e.stateTimer = 0;
            win.intactCount = Math.max(0, win.intactCount - 1);
            const plank = win.planks[win.intactCount];
            if (plank) plank.visible = false;
            this.audio.playSurfaceImpact('wood', win.center.x, 1.4, win.center.z);
            if (win.intactCount <= 0) {
              e.state = 'climb_in';
            }
          }
        }
      } else if (e.state === 'climb_in' && e.windowId) {
        const win = windows.get(e.windowId);
        if (!win) {
          e.state = 'chase';
        } else {
          e.stateTimer += dt;
          const climbDur =
            e.type === 'hound'
              ? BALANCE.enemies.shambler.climbDuration * 0.72
              : BALANCE.enemies.shambler.climbDuration;
          const t = Math.min(1, e.stateTimer / climbDur);
          e.x = THREE.MathUtils.lerp(win.outsidePos.x, win.insidePos.x, t);
          e.z = THREE.MathUtils.lerp(win.outsidePos.z, win.insidePos.z, t);
          e.y = Math.sin(t * Math.PI) * 0.95;
          e.yaw = Math.atan2(win.insidePos.x - win.outsidePos.x, win.insidePos.z - win.outsidePos.z);
          if (t >= 1) {
            e.y = 0;
            e.windowId = null;
            e.state = 'chase';
          }
        }
      } else if (e.state === 'bloater_fuse') {
        e.stateTimer += dt;
        e.bloaterBeepTimer -= dt;
        const fuseFrac = Math.min(1, e.stateTimer / BALANCE.enemies.bloater.fuseTime);
        if (e.bloaterBeepTimer <= 0) {
          e.bloaterBeepTimer = 0.24;
          this.audio.playBloaterFuseWarning(fuseFrac, e.x, e.y + 1.2, e.z);
        }
        const pulse = 1 + Math.sin(e.stateTimer * 26) * 0.16;
        e.root.scale.set(1.36 * pulse, 1.04 * pulse, 1.38 * pulse);
        if (e.stateTimer >= BALANCE.enemies.bloater.fuseTime) {
          this.killEntity(e);
          onBloaterExplode(e.x, e.y + 1.0, e.z);
        }
      } else if (e.state === 'brute_telegraph') {
        e.stateTimer += dt;
        e.yaw = Math.atan2(dxToP, dzToP);
        if (e.stateTimer >= BALANCE.enemies.brute.chargeTelegraph) {
          e.state = 'brute_charge';
          e.stateTimer = 0;
          const len = Math.max(0.01, distToP);
          e.vx = (dxToP / len) * BALANCE.enemies.brute.chargeSpeed;
          e.vz = (dzToP / len) * BALANCE.enemies.brute.chargeSpeed;
        }
      } else if (e.state === 'brute_charge') {
        e.stateTimer += dt;
        const nx = e.x + e.vx * dt;
        const nz = e.z + e.vz * dt;
        const nextDist = Math.hypot(playerPos.x - nx, playerPos.z - nz);
        if (this.nav.isWalkableWorld(nx, nz) && (nextDist >= entityMinStandoff || nextDist >= distToP)) {
          e.x = nx;
          e.z = nz;
        } else if (!this.nav.isWalkableWorld(nx, nz)) {
          e.state = 'chase';
        }
        const chargeStrikes = canZombieStrikePlayer({
          isRising: e.spawnRiseTimer > 0 || !e.root.visible,
          isStaggered: e.staggerTimer > 0,
          horizontalDist: distToP,
          maxReach: BALANCE.enemies.brute.meleeRange,
          zombieY: e.y,
          zombieBodyY: e.bodyGroup.position.y,
          playerFeetY,
          zombieYaw: e.yaw,
          toPlayerX: dxToP,
          toPlayerZ: dzToP,
          hasDualHeightLos: this.hasCombatLineOfSight(e, playerPos),
        });
        if (chargeStrikes) {
          const chargeSource: DamageSource =
            e.bossRole === 'alpha_boss'
              ? 'alpha_boss'
              : e.bossRole === 'warden'
                ? 'warden'
                : 'brute_charge';
          const chargeDmg =
            e.bossRole === 'alpha_boss'
              ? BALANCE.campaign.alphaBossDamage
              : BALANCE.enemies.brute.meleeDamage;
          onMeleeHitPlayer(chargeDmg, e.x, e.z, chargeSource);
          e.state = 'chase';
          e.attackCooldown = 1.4;
        } else if (e.stateTimer >= BALANCE.enemies.brute.chargeDuration) {
          e.state = 'chase';
        }
      } else if (e.state === 'attack') {
        e.stateTimer += dt;
        const windup =
          e.type === 'hound'
            ? BALANCE.enemies.hound.attackWindup
            : BALANCE.enemies.shambler.attackWindup;
        const hitTime = windup * 0.52;
        const frac = e.stateTimer / windup;

        // Shooting/staggering a zombie mid-windup interrupts its swing cleanly
        if (!e.attackDealt && e.staggerTimer > 0) {
          e.state = 'chase';
          e.attackCooldown = 0.45;
        } else {
          // Track target only during early windup, then commit swing direction so sliding/strafing can dodge
          if (frac < 0.35) {
            const targetYaw = Math.atan2(dxToP, dzToP);
            let diff = targetYaw - e.yaw;
            while (diff > Math.PI) diff -= Math.PI * 2;
            while (diff < -Math.PI) diff += Math.PI * 2;
            e.yaw += diff * Math.min(1, dt * 8.5);
          }

          // Slight forward lunge during the strike window without slipping inside standoff blindspot
          if (frac >= 0.44 && frac <= 0.62 && distToP > entityMinStandoff + 0.12 && e.staggerTimer <= 0) {
            const lungeStep = 1.55 * dt;
            const lx = e.x + Math.sin(e.yaw) * lungeStep;
            const lz = e.z + Math.cos(e.yaw) * lungeStep;
            if (this.nav.isWalkableWorld(lx, lz)) {
              e.x = lx;
              e.z = lz;
            }
          }

          if (!e.attackDealt && e.stateTimer >= hitTime) {
            e.attackDealt = true;
            const reach =
              e.type === 'brute'
                ? e.bossRole === 'alpha_boss'
                  ? 2.55
                  : 2.38
                : e.type === 'hound'
                  ? 2.02
                  : e.isCrawler
                    ? 2.02
                    : 1.96;
            const strikes = canZombieStrikePlayer({
              isRising: e.spawnRiseTimer > 0 || !e.root.visible,
              isStaggered: e.staggerTimer > 0,
              horizontalDist: distToP,
              maxReach: reach,
              zombieY: e.y,
              zombieBodyY: e.bodyGroup.position.y,
              playerFeetY,
              zombieYaw: e.yaw,
              toPlayerX: dxToP,
              toPlayerZ: dzToP,
              hasDualHeightLos: this.hasCombatLineOfSight(e, playerPos),
            });
            if (strikes) {
              const dmg =
                e.type === 'hound'
                  ? BALANCE.enemies.hound.meleeDamage
                  : e.type === 'brute'
                    ? e.bossRole === 'alpha_boss'
                      ? BALANCE.campaign.alphaBossDamage
                      : BALANCE.enemies.brute.meleeDamage
                    : BALANCE.enemies.shambler.meleeDamage;
              const hitSource: DamageSource =
                e.type === 'hound'
                  ? 'hound'
                  : e.type === 'brute'
                    ? e.bossRole === 'alpha_boss'
                      ? 'alpha_boss'
                      : e.bossRole === 'warden'
                        ? 'warden'
                        : 'brute'
                    : 'shambler';
              onMeleeHitPlayer(dmg, e.x, e.z, hitSource);
            }
          }
          if (e.stateTimer >= windup) {
            e.state = 'chase';
            e.attackCooldown =
              e.type === 'hound'
                ? BALANCE.enemies.hound.attackCooldown
                : BALANCE.enemies.shambler.attackCooldown;
          }
        }
      } else if (e.state === 'chase') {
        if (
          e.root.visible &&
          e.bodyGroup.position.y >= -0.08 &&
          e.type === 'bloater' &&
          distToP <= BALANCE.enemies.bloater.meleeRange &&
          Math.abs(playerFeetY - e.y) < 1.55 &&
          this.hasCombatLineOfSight(e, playerPos)
        ) {
          e.state = 'bloater_fuse';
          e.stateTimer = 0;
          e.bloaterBeepTimer = 0;
        } else if (
          e.root.visible &&
          e.bodyGroup.position.y >= -0.08 &&
          e.type === 'brute' &&
          e.chargeCooldown <= 0 &&
          distToP > 4.5 &&
          distToP < 14 &&
          Math.abs(playerFeetY - e.y) < 1.55 &&
          this.hasCombatLineOfSight(e, playerPos)
        ) {
          e.state = 'brute_telegraph';
          e.stateTimer = 0;
          e.chargeCooldown = BALANCE.enemies.brute.chargeCooldown;
          this.audio.playBruteChargeRoar(e.x, 1.5, e.z);
        } else {
          const triggerRange =
            e.type === 'hound'
              ? 1.94
              : e.isCrawler
                ? 1.94
                : e.type === 'brute'
                  ? 2.28
                  : 1.88;
          if (
            e.root.visible &&
            e.bodyGroup.position.y >= -0.08 &&
            distToP <= triggerRange &&
            e.attackCooldown <= 0 &&
            activeAttackers < 2 &&
            Math.abs(playerFeetY - e.y) < 1.55 &&
            this.hasCombatLineOfSight(e, playerPos)
          ) {
            e.state = 'attack';
            e.stateTimer = 0;
            e.attackDealt = false;
            activeAttackers++;
            this.audio.playZombieSound(e.type === 'hound' ? 'hound' : 'attack', e.x, e.y + 1.35, e.z);
          } else if (e.staggerTimer <= 0) {
            if (
              e.spawnRiseTimer <= 0 &&
              e.root.visible &&
              (e.speedClass === 'run' || e.speedClass === 'sprint' || e.type === 'hound') &&
              Math.abs(playerFeetY - e.y) < 1.55 &&
              distToP < 6.8 &&
              this.hasCombatLineOfSight(e, playerPos)
            ) {
              e.stepSoundTimer -= dt;
              if (e.stepSoundTimer <= 0) {
                e.stepSoundTimer = e.speedClass === 'sprint' ? 0.28 : 0.4;
                this.audio.playZombieSound('footstep', e.x, e.y + 0.25, e.z);
              }
            }

            const curWalkable = this.nav.isWalkableWorld(e.x, e.z);
            if (distToP < 2.2 && curWalkable) {
              const inv = 1 / Math.max(0.01, distToP);
              let fx = dxToP * inv;
              let fz = dzToP * inv;
              // Gentle flanking spread in close quarters so zombies surround cleanly instead of stacking
              if (distToP > 1.2 && distToP < 2.15) {
                const flankAngle = ((e.id % 3) - 1) * 0.28;
                const ca = Math.cos(flankAngle);
                const sa = Math.sin(flankAngle);
                const rx = fx * ca - fz * sa;
                const rz = fx * sa + fz * ca;
                fx = rx;
                fz = rz;
              }
              this.flowSample.x = fx;
              this.flowSample.z = fz;
            } else {
              this.nav.sampleFlow(e.x, e.z, this.flowSample);
            }
            this.nav.computeSeparation(
              i,
              e.x,
              e.z,
              this.posX,
              this.posZ,
              BALANCE.nav.separationRadius,
              this.sepSample,
            );

            let dirX = this.flowSample.x + this.sepSample.x * BALANCE.nav.separationWeight;
            let dirZ = this.flowSample.z + this.sepSample.z * BALANCE.nav.separationWeight;
            const len = Math.hypot(dirX, dirZ);
            if (len > 0.001) {
              dirX /= len;
              dirZ /= len;
            }

            // Pace down slightly while waiting on attack cooldown right outside standoff
            const paceScale = distToP < entityMinStandoff + 0.25 && e.attackCooldown > 0 ? 0.35 : 1.0;
            e.vx = dirX * e.moveSpeed * paceScale;
            e.vz = dirZ * e.moveSpeed * paceScale;
            const nx = e.x + e.vx * dt;
            const nz = e.z + e.vz * dt;
            if (this.nav.isWalkableWorld(nx, nz)) {
              e.x = nx;
              e.z = nz;
            } else if (this.nav.isWalkableWorld(nx, e.z)) {
              e.x = nx;
            } else if (this.nav.isWalkableWorld(e.x, nz)) {
              e.z = nz;
            } else if (!curWalkable) {
              // Strictly step toward the nearest walkable cell without bypassing walls toward the player
              this.nav.sampleFlow(e.x, e.z, this.flowSample);
              const flen = Math.hypot(this.flowSample.x, this.flowSample.z);
              if (flen > 0.01) {
                e.x += (this.flowSample.x / flen) * e.moveSpeed * dt;
                e.z += (this.flowSample.z / flen) * e.moveSpeed * dt;
              }
            }

            if (len > 0.05) {
              const targetYaw =
                distToP < entityMinStandoff + 0.35 ? Math.atan2(dxToP, dzToP) : Math.atan2(dirX, dirZ);
              let diff = targetYaw - e.yaw;
              while (diff > Math.PI) diff -= Math.PI * 2;
              while (diff < -Math.PI) diff += Math.PI * 2;
              e.yaw += diff * Math.min(1, dt * 9.5);
            }
          }
        }

        const progDist = Math.hypot(e.x - e.lastProgressX, e.z - e.lastProgressZ);
        if (progDist > 0.45) {
          e.lastProgressX = e.x;
          e.lastProgressZ = e.z;
          e.stuckTimer = 0;
        } else if (e.staggerTimer <= 0 && !(distToP < entityMinStandoff + 0.25 && e.attackCooldown > 0)) {
          e.stuckTimer += dt;
          if (e.stuckTimer >= BALANCE.enemies.shambler.stuckTimeout) {
            e.stuckTimer = 0;
            this.relocateStuckZombie(e, playerPos, unlockedZones, spawnPoints);
          }
        }
      }
    }

    // Hard Zombie-Zombie Circle Separation Pass BEFORE final player-zombie standoff
    // so horde collisions never push a zombie inside the player's camera or capsule
    const minPairSep = 0.72;
    const minPairSepSq = minPairSep * minPairSep;
    for (let i = 0; i < MAX_ZOMBIES; i++) {
      const a = this.entities[i]!;
      if (!a.active || a.state === 'dying' || a.state === 'dead' || a.state === 'climb_in') continue;
      for (let j = i + 1; j < MAX_ZOMBIES; j++) {
        const b = this.entities[j]!;
        if (!b.active || b.state === 'dying' || b.state === 'dead' || b.state === 'climb_in') continue;
        const dx = b.x - a.x;
        const dz = b.z - a.z;
        const dSq = dx * dx + dz * dz;
        if (dSq < minPairSepSq) {
          const d = Math.sqrt(dSq);
          const nx = d > 0.001 ? dx / d : Math.cos(i);
          const nz = d > 0.001 ? dz / d : Math.sin(i);
          const push = (minPairSep - d) * 0.45;
          const ax = a.x - nx * push;
          const az = a.z - nz * push;
          const bx = b.x + nx * push;
          const bz = b.z + nz * push;
          if (this.nav.isWalkableWorld(ax, az)) {
            a.x = ax;
            a.z = az;
          }
          if (this.nav.isWalkableWorld(bx, bz)) {
            b.x = bx;
            b.z = bz;
          }
        }
      }
    }

    // Authoritative Solid Player-Zombie Standoff Pass AFTER separation:
    // guarantees zero zombies clip inside player capsule/near-clip or low-profile blindspot
    for (let i = 0; i < MAX_ZOMBIES; i++) {
      const e = this.entities[i]!;
      if (
        !e.active ||
        e.state === 'dying' ||
        e.state === 'dead' ||
        e.state === 'climb_in' ||
        e.state === 'tear_board' ||
        e.state === 'approach_window'
      ) {
        continue;
      }
      const minStandoff =
        e.type === 'hound'
          ? 1.68
          : e.isCrawler
            ? 1.72
            : e.type === 'brute'
              ? 1.54
              : e.type === 'bloater'
                ? 1.44
                : 1.36;
      const standoff = resolvePlayerZombieStandoff(
        e.x,
        e.z,
        e.yaw,
        playerPos.x,
        playerPos.z,
        minStandoff,
        (wx, wz) => this.nav.isWalkableWorld(wx, wz),
      );
      if (standoff.pushed) {
        e.x = standoff.nx;
        e.z = standoff.nz;
        shoveTotalX += standoff.shoveX;
        shoveTotalZ += standoff.shoveZ;
      }
    }

    if (onPlayerShove && (Math.abs(shoveTotalX) > 0.01 || Math.abs(shoveTotalZ) > 0.01)) {
      onPlayerShove(shoveTotalX * dt * 2.6, shoveTotalZ * dt * 2.6);
    }

    // Final transform sync & speed-matched rig animation
    for (let i = 0; i < MAX_ZOMBIES; i++) {
      const e = this.entities[i]!;
      if (!e.active || e.state === 'dying' || e.state === 'dead') continue;
      e.root.position.set(e.x, e.y, e.z);
      e.root.rotation.y = e.yaw;

      const distToP = Math.hypot(playerPos.x - e.x, playerPos.z - e.z);
      const isFar = distToP > BALANCE.perf.lodDistance;
      if (
        !isFar ||
        e.spawnRiseTimer > 0 ||
        e.state === 'attack' ||
        e.isCrawler ||
        (this.aiFrameCounter + i) % 3 === 0
      ) {
        const animDt = isFar ? dt * 3 : dt;
        const movedDist = Math.hypot(e.x - e.prevX, e.z - e.prevZ);
        this.animateZombieRig(e, animDt, movedDist, dt);
      }
      e.root.updateMatrixWorld(true);
    }
  }

  private relocateStuckZombie(
    e: ZombieEntity,
    playerPos: THREE.Vector3,
    unlockedZones: Set<ZoneId>,
    spawnPoints: SpawnPoint[],
  ): void {
    const unlocked = spawnPoints.filter((s) => unlockedZones.has(s.zone));
    const openSpawns = e.type === 'hound' ? unlocked.filter((s) => !s.windowId) : [];
    const valid = openSpawns.length > 0 ? openSpawns : unlocked;
    const best = selectSafeSpawnPoint(valid, playerPos.x, playerPos.z, 0.5, 14, 8.5);
    if (!best) return;
    e.x = best.position.x;
    e.z = best.position.z;
    e.y = 0;
    e.lastProgressX = e.x;
    e.lastProgressZ = e.z;
    e.stuckCount++;
    this.stuckTeleportCount++;
    if (best.windowId) {
      e.windowId = best.windowId;
      e.spawnRiseTimer = 0;
      e.spawnFogTimer = 0;
      e.spawnFogRing.visible = false;
      e.state = 'approach_window';
    } else {
      e.windowId = null;
      e.spawnRiseTimer = e.type === 'hound' ? 0.4 : 0.65;
      e.spawnFogTimer = e.type === 'hound' ? 1.0 : 0.85;
      e.spawnFogRing.visible = true;
      this.audio.playSpawnEruption(e.x, 0.4, e.z);
      e.state = 'chase';
    }
    e.root.position.set(e.x, e.y, e.z);
    e.root.updateMatrixWorld(true);
  }

  private animateZombieRig(e: ZombieEntity, dt: number, movedDist: number, simDt: number): void {
    const actualSpeed = simDt > 0 ? movedDist / simDt : 0;

    if (e.type === 'hound') {
      const speedRatio = THREE.MathUtils.clamp(actualSpeed / Math.max(1, e.moveSpeed), 0.25, 1.35);
      e.animPhase += dt * (11.5 * speedRatio);
      const g = Math.sin(e.animPhase);
      const c = Math.cos(e.animPhase);
      if (e.state === 'attack') {
        const frac = THREE.MathUtils.clamp(
          e.stateTimer / BALANCE.enemies.hound.attackWindup,
          0,
          1,
        );
        const pounce = Math.sin(frac * Math.PI);
        e.bodyGroup.position.y = pounce * 0.48;
        e.bodyGroup.rotation.x = frac < 0.4 ? 0.22 : -0.32 * pounce;
        e.houndHead.rotation.x = -0.35 + pounce * 0.25;
        e.houndLegs[0].rotation.x = -0.65 * pounce;
        e.houndLegs[1].rotation.x = -0.65 * pounce;
        e.houndLegs[2].rotation.x = 0.65 * pounce;
        e.houndLegs[3].rotation.x = 0.65 * pounce;
        for (const sp of e.houndEyeHalos) {
          const hs = 0.16 + pounce * 0.1;
          sp.scale.set(hs, hs, 1);
        }
        return;
      }
      e.houndLegs[0].rotation.x = g * 0.78;
      e.houndLegs[1].rotation.x = g * 0.78 + 0.18;
      e.houndLegs[2].rotation.x = -g * 0.78;
      e.houndLegs[3].rotation.x = -g * 0.78 + 0.18;
      e.bodyGroup.position.y = Math.abs(c) * 0.11;
      e.bodyGroup.rotation.x = c * 0.08;
      e.houndHead.rotation.x = c * 0.14;
      e.houndHead.rotation.y = Math.sin(e.animPhase * 0.5) * 0.12;
      for (const sp of e.houndEyeHalos) sp.scale.set(0.16, 0.16, 1);
      return;
    }

    // Speed-synced walk/sprint cadence so zombies never skate when blocked/staggered
    const targetStrideBlend =
      e.state === 'climb_in' || e.state === 'tear_board'
        ? 0
        : THREE.MathUtils.clamp(actualSpeed / Math.max(0.5, e.moveSpeed * 0.45), 0, 1);
    e.strideBlend = THREE.MathUtils.damp(e.strideBlend, targetStrideBlend, 12, dt);

    const baseFreq = e.speedClass === 'sprint' ? 11.8 : e.speedClass === 'run' ? 8.5 : 5.2;
    const freq = THREE.MathUtils.lerp(2.4, baseFreq, e.strideBlend);
    e.animPhase += dt * freq;
    const s = Math.sin(e.animPhase);
    const c = Math.cos(e.animPhase);
    const limpSide = e.id % 2 === 0 ? 1 : -1;

    // Eye halo brightness flare during attack windup without washing out face features
    const attackFlare = e.state === 'attack' ? 0.16 : 0.11;
    for (const sp of e.eyeHalos) {
      sp.scale.set(attackFlare, attackFlare, 1);
    }

    if (e.isCrawler) {
      // Keep crawlers cleanly ON TOP of the floor slab and elevated enough to remain visible inside 80° VFOV at standoff
      e.bodyGroup.position.y = 0.24;
      e.bodyGroup.rotation.set(1.24, 0, 0);
      e.torsoPivot.rotation.set(-0.26, c * 0.18, 0);
      e.headPivot.rotation.set(-1.18, 0, Math.sin(e.animPhase * 0.7) * 0.14);
      e.leftArm.rotation.x = -1.35 + s * 0.52 * Math.max(0.3, e.strideBlend);
      e.rightArm.rotation.x = -1.35 - s * 0.52 * Math.max(0.3, e.strideBlend);
      e.leftForearm.rotation.x = -0.55 - Math.max(0, s) * 0.45;
      e.rightForearm.rotation.x = -0.55 - Math.max(0, -s) * 0.45;
      return;
    }

    // Explicitly reset bodyGroup stance so transitions out of spawn-rise/crawler/charge never stay stuck underground
    e.bodyGroup.position.y = 0;
    e.bodyGroup.rotation.set(0, 0, 0);

    // Deeper predatory torso hunch, dragging limp sway & directional hit flinch
    let torsoPitch = e.speedClass === 'sprint' ? 0.34 : e.speedClass === 'run' ? 0.24 : 0.18;
    let torsoYaw = c * (e.speedClass === 'walk' ? 0.18 : 0.11) * Math.max(0.35, e.strideBlend);
    const torsoRoll =
      s * (e.speedClass === 'walk' ? 0.1 : 0.055) * Math.max(0.35, e.strideBlend) +
      limpSide * 0.06;

    if (e.hitReactTimer > 0) {
      const reactT = e.hitReactTimer / 0.26;
      const punch = Math.sin(reactT * Math.PI);
      if (e.hitReactZone === 'head') {
        torsoPitch -= 0.26 * punch;
        e.headPivot.rotation.x = -0.68 * punch;
        e.headPivot.rotation.y = limpSide * 0.32 * punch;
      } else {
        torsoPitch -= 0.22 * punch;
        torsoYaw += limpSide * 0.38 * punch;
        e.headPivot.rotation.x = -0.26 * punch;
      }
    } else if (e.state === 'brute_telegraph') {
      e.torsoPivot.rotation.set(0.32, 0, 0);
      e.headPivot.rotation.set(-0.2, 0, 0);
      e.leftArm.rotation.x = -2.45;
      e.rightArm.rotation.x = -2.45;
      e.leftForearm.rotation.x = -0.35;
      e.rightForearm.rotation.x = -0.35;
      return;
    } else if (e.state === 'brute_charge') {
      const rush = Math.sin(e.stateTimer * 18);
      e.torsoPivot.rotation.set(0.54, rush * 0.12, 0);
      e.headPivot.rotation.set(-0.36, 0, 0);
      e.leftArm.rotation.x = -1.65 + rush * 0.4;
      e.rightArm.rotation.x = -1.65 - rush * 0.4;
      e.leftForearm.rotation.x = -0.9;
      e.rightForearm.rotation.x = -0.9;
      e.leftLeg.rotation.x = rush * 0.78;
      e.rightLeg.rotation.x = -rush * 0.78;
      e.leftShin.rotation.x = 0.35;
      e.rightShin.rotation.x = 0.35;
      e.bodyGroup.position.y = Math.abs(rush) * 0.08;
      return;
    } else {
      e.headPivot.rotation.set(
        -0.06 + s * 0.035,
        Math.sin(e.animPhase * 0.6) * 0.07,
        limpSide * 0.12 + c * 0.05,
      );
    }

    e.torsoPivot.rotation.set(torsoPitch, torsoYaw, torsoRoll);

    if (e.state === 'attack') {
      // 3-phase strike choreography: Windup (0..0.46) -> Strike Slash (0.46..0.66) -> Follow-through (0.66..1.0)
      const windup = BALANCE.enemies.shambler.attackWindup;
      const f = THREE.MathUtils.clamp(e.stateTimer / windup, 0, 1);
      if (f < 0.46) {
        const u = f / 0.46;
        const easeU = Math.sin(u * Math.PI * 0.5);
        e.torsoPivot.rotation.set(0.06 - easeU * 0.24, -0.45 * easeU * limpSide, -0.1 * easeU);
        e.rightArm.rotation.x = THREE.MathUtils.lerp(-0.9, -2.55, easeU);
        e.leftArm.rotation.x = THREE.MathUtils.lerp(-1.0, -0.6, easeU);
        e.rightForearm.rotation.x = THREE.MathUtils.lerp(-0.55, -0.9, easeU);
        e.leftForearm.rotation.x = -0.65;
      } else if (f < 0.66) {
        const u = (f - 0.46) / 0.2;
        const snap = 1 - Math.pow(1 - u, 2);
        e.torsoPivot.rotation.set(-0.18 + snap * 0.72, (-0.45 + snap * 0.92) * limpSide, 0.08);
        e.rightArm.rotation.x = THREE.MathUtils.lerp(-2.55, -0.35, snap);
        e.leftArm.rotation.x = THREE.MathUtils.lerp(-0.6, -1.65, snap);
        e.rightForearm.rotation.x = THREE.MathUtils.lerp(-0.9, -0.22, snap);
        e.leftForearm.rotation.x = -0.45;
      } else {
        const u = (f - 0.66) / 0.34;
        e.torsoPivot.rotation.set(
          THREE.MathUtils.lerp(0.54, 0.2, u),
          THREE.MathUtils.lerp(0.47 * limpSide, 0, u),
          0,
        );
        e.rightArm.rotation.x = THREE.MathUtils.lerp(-0.35, -1.0, u);
        e.leftArm.rotation.x = THREE.MathUtils.lerp(-1.65, -1.05, u);
        e.rightForearm.rotation.x = THREE.MathUtils.lerp(-0.22, -0.58, u);
        e.leftForearm.rotation.x = -0.58;
      }
      e.leftLeg.rotation.x = 0.22;
      e.rightLeg.rotation.x = -0.22;
      e.leftShin.rotation.x = 0.28;
      e.rightShin.rotation.x = 0.16;
    } else if (e.state === 'tear_board') {
      const yank = Math.sin(e.stateTimer * 8.5);
      e.torsoPivot.rotation.x = 0.14 - yank * 0.14;
      e.leftArm.rotation.x = -1.55 + yank * 0.68;
      e.rightArm.rotation.x = -1.55 - yank * 0.68;
      e.leftForearm.rotation.x = -0.78 + yank * 0.38;
      e.rightForearm.rotation.x = -0.78 - yank * 0.38;
      e.leftLeg.rotation.x = -0.14;
      e.rightLeg.rotation.x = 0.14;
      e.leftShin.rotation.x = 0.24;
      e.rightShin.rotation.x = 0.14;
    } else if (e.state === 'climb_in') {
      const f = THREE.MathUtils.clamp(
        e.stateTimer / BALANCE.enemies.shambler.climbDuration,
        0,
        1,
      );
      const arch = Math.sin(f * Math.PI);
      e.torsoPivot.rotation.x = 0.45 * arch + 0.15;
      e.leftArm.rotation.x = -1.7 + arch * 0.5;
      e.rightArm.rotation.x = -1.7 + arch * 0.5;
      e.leftForearm.rotation.x = -0.7;
      e.rightForearm.rotation.x = -0.7;
      e.leftLeg.rotation.x = -0.9 * arch;
      e.rightLeg.rotation.x = -0.65 * arch;
      e.leftShin.rotation.x = 1.1 * arch + 0.15;
      e.rightShin.rotation.x = 0.9 * arch + 0.15;
    } else {
      // Articulated knee-bend walk / sprint gait scaled cleanly by actual movement blend
      const strideAmp =
        (e.speedClass === 'sprint' ? 0.76 : e.speedClass === 'run' ? 0.6 : 0.44) * e.strideBlend;
      e.leftLeg.rotation.x = s * strideAmp;
      e.rightLeg.rotation.x = -s * strideAmp * (e.speedClass === 'walk' ? 0.72 : 1.0);
      e.leftShin.rotation.x = Math.max(0.1, -s * 0.72 * e.strideBlend + 0.2);
      e.rightShin.rotation.x = Math.max(0.1, s * 0.72 * e.strideBlend + 0.2);

      // Reached out crooked asymmetric clawing arms
      const armReach = e.speedClass === 'sprint' ? 0.46 : 0.24;
      const armAmp = armReach * Math.max(0.35, e.strideBlend);
      e.leftArm.rotation.x = -1.06 + c * armAmp;
      e.rightArm.rotation.x = -0.94 - c * armAmp;
      e.leftForearm.rotation.x = -0.68 - Math.sin(e.animPhase + 0.6) * 0.24;
      e.rightForearm.rotation.x = -0.58 + Math.sin(e.animPhase + 0.6) * 0.24;
      const riseOffset = e.spawnRiseTimer > 0 ? -(e.spawnRiseTimer / 0.65) * 0.35 : 0;
      e.bodyGroup.position.y =
        Math.abs(s) * (e.speedClass === 'sprint' ? 0.065 : 0.04) * e.strideBlend + riseOffset;
    }
    void this.tmpVec;
  }
}
