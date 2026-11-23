import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import {
  BALANCE,
  calculateZombieHealth,
  getSpeedClassWeights,
  type EnemyType,
  type ZoneId,
} from '../config/balance';
import type { AudioEngine } from '../engine/AudioEngine';
import type { NavGrid } from '../engine/NavGrid';
import type { PbrMaterialSet } from '../engine/ProceduralAssets';
import type { SpawnPoint, WindowBarricade } from './MapBuilder';
import type { SeededRng } from './types';

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
  speedClass: 'walk' | 'run' | 'sprint';
  moveSpeed: number;
  health: number;
  maxHealth: number;
  state: ZombieState;
  stateTimer: number;
  attackCooldown: number;
  attackDealt: boolean;
  chargeCooldown: number;
  groanTimer: number;
  hitReactTimer: number;
  hitReactDirX: number;
  hitReactDirZ: number;
  staggerTimer: number;
  isCrawler: boolean;
  woundedShown: boolean;

  x: number;
  y: number;
  z: number;
  yaw: number;
  vx: number;
  vz: number;

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
  headMesh: THREE.Mesh;
  torsoMesh: THREE.Mesh;
  leftArm: THREE.Group;
  rightArm: THREE.Group;
  leftLeg: THREE.Group;
  rightLeg: THREE.Group;
  houndLegs: [THREE.Group, THREE.Group, THREE.Group, THREE.Group];
  houndHead: THREE.Group;
  weakPointMesh: THREE.Mesh;
  bruteGearGroup: THREE.Group;
  bloaterCystsGroup: THREE.Group;
  fungalGrowthMesh: THREE.Mesh;
  eyesMesh: THREE.Mesh;
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
  spawnFogRing: THREE.Mesh;
}

const MAX_ZOMBIES = BALANCE.rounds.maxAlive;

export class ZombieSystem {
  public readonly entities: ZombieEntity[] = [];
  public stuckTeleportCount = 0;

  private readonly scene: THREE.Scene;
  private readonly nav: NavGrid;
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
  private readonly allHitboxes: THREE.Mesh[] = [];

  private nextZombieId = 1;
  private aiFrameCounter = 0;

  // Shared sculpted geometries
  private readonly headGeo = ZombieSystem.buildHeadGeo();
  private readonly torsoGeo = ZombieSystem.buildTorsoGeo();
  private readonly armGeo = ZombieSystem.buildArmGeo();
  private readonly legGeo = ZombieSystem.buildLegGeo();
  private readonly eyesGeo = ZombieSystem.buildEyesGeo();
  private readonly houndBodyGeo = ZombieSystem.buildHoundBodyGeo();
  private readonly houndHeadGeo = ZombieSystem.buildHoundHeadGeo();
  private readonly houndLegGeo = ZombieSystem.buildHoundLegGeo();
  private readonly houndEyesGeo = ZombieSystem.buildHoundEyesGeo();

  private readonly eyeMat = new THREE.MeshBasicMaterial({ color: 0xfde047 });
  private readonly houndEyeMat = new THREE.MeshBasicMaterial({ color: 0xef4444 });
  private readonly bloaterEyeMat = new THREE.MeshBasicMaterial({ color: 0xa3e635 });

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
    emissive: 0x4d7c0f,
    emissiveIntensity: 0.9,
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
    color: 0xd97706,
    emissive: 0x92400e,
    emissiveIntensity: 0.65,
    roughness: 0.65,
  });

  constructor(
    scene: THREE.Scene,
    nav: NavGrid,
    audio: AudioEngine,
    mats: PbrMaterialSet,
    isSoftwareGl: boolean,
  ) {
    this.scene = scene;
    this.nav = nav;
    this.audio = audio;
    this.mats = mats;
    this.isSoftwareGl = isSoftwareGl;
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

  private static buildArmGeo(): THREE.BufferGeometry {
    const shoulder = new THREE.SphereGeometry(0.075, 8, 6);
    const upper = new THREE.CylinderGeometry(0.065, 0.052, 0.28, 8);
    upper.translate(0, -0.14, 0);
    const forearm = new THREE.CylinderGeometry(0.052, 0.042, 0.27, 8);
    forearm.rotateX(-0.22);
    forearm.translate(0, -0.39, 0.03);
    const hand = new THREE.BoxGeometry(0.075, 0.1, 0.06);
    hand.rotateX(-0.22);
    hand.translate(0, -0.54, 0.06);

    const merged = mergeGeometries([shoulder, upper, forearm, hand]);
    shoulder.dispose();
    upper.dispose();
    forearm.dispose();
    hand.dispose();
    return merged ?? new THREE.CylinderGeometry(0.06, 0.05, 0.54, 8);
  }

  private static buildLegGeo(): THREE.BufferGeometry {
    const thigh = new THREE.CylinderGeometry(0.095, 0.075, 0.34, 8);
    thigh.translate(0, -0.17, 0);
    const shin = new THREE.CylinderGeometry(0.072, 0.055, 0.32, 8);
    shin.translate(0, -0.49, 0);
    const boot = new THREE.BoxGeometry(0.11, 0.09, 0.21);
    boot.translate(0, -0.64, 0.045);

    const merged = mergeGeometries([thigh, shin, boot]);
    thigh.dispose();
    shin.dispose();
    boot.dispose();
    return merged ?? new THREE.CylinderGeometry(0.08, 0.06, 0.64, 8);
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

      // =====================================================
      // A. SCULPTED HUMANOID RIG (Shambler, Bloater, Brute)
      // =====================================================
      const humanoidGroup = new THREE.Group();
      bodyGroup.add(humanoidGroup);

      const torsoMesh = new THREE.Mesh(this.torsoGeo, clothMat);
      torsoMesh.position.y = 1.02;
      torsoMesh.castShadow = !this.isSoftwareGl;
      torsoMesh.userData = { poolIdx: i, hitZone: 'torso' as HitZone };
      humanoidGroup.add(torsoMesh);

      // Torn bloodied chest/shoulder gash & dynamic low-health wound patch
      const chestBlood = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.28, 0.34), bloodMat);
      chestBlood.position.set((i % 2 === 0 ? 1 : -1) * 0.05, 0.04, 0.01);
      chestBlood.rotation.z = i % 2 === 0 ? 0.18 : -0.18;
      torsoMesh.add(chestBlood);

      const bloodWoundMesh = new THREE.Mesh(new THREE.SphereGeometry(0.15, 7, 7), bloodMat);
      bloodWoundMesh.scale.set(1.2, 1.3, 0.5);
      bloodWoundMesh.position.set(-0.04, 0.08, 0.14);
      bloodWoundMesh.visible = false;
      torsoMesh.add(bloodWoundMesh);

      // Fungal Bloom outgrowth on shoulder/head for visual variety
      const fungalGrowthMesh = new THREE.Mesh(new THREE.DodecahedronGeometry(0.11, 0), this.fungalGrowthMat);
      fungalGrowthMesh.position.set(i % 2 === 0 ? 0.2 : -0.2, 0.28, 0.02);
      torsoMesh.add(fungalGrowthMesh);

      // Head + glowing eyes
      const headMesh = new THREE.Mesh(this.headGeo, skinMat);
      headMesh.position.set(0, 1.48, 0.03);
      headMesh.castShadow = !this.isSoftwareGl;
      headMesh.userData = { poolIdx: i, hitZone: 'head' as HitZone };
      humanoidGroup.add(headMesh);

      const eyesMesh = new THREE.Mesh(this.eyesGeo, this.eyeMat);
      headMesh.add(eyesMesh);

      // Brute armored pauldrons & chest plate + glowing back weakpoint canister
      const bruteGearGroup = new THREE.Group();
      bruteGearGroup.visible = false;
      const pauldronL = new THREE.Mesh(new THREE.SphereGeometry(0.16, 8, 6), this.bruteArmorMat);
      pauldronL.scale.set(1.1, 0.85, 1.1);
      pauldronL.position.set(-0.32, 1.3, 0);
      const pauldronR = pauldronL.clone();
      pauldronR.position.x = 0.32;
      const chestRig = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.38, 0.36), this.bruteArmorMat);
      chestRig.position.set(0, 1.1, 0.02);
      const hornA = new THREE.Mesh(new THREE.ConeGeometry(0.045, 0.2, 6), this.fungalGrowthMat);
      hornA.position.set(-0.09, 1.66, 0.03);
      hornA.rotation.z = 0.35;
      const hornB = hornA.clone();
      hornB.position.x = 0.09;
      hornB.rotation.z = -0.35;
      bruteGearGroup.add(pauldronL, pauldronR, chestRig, hornA, hornB);
      humanoidGroup.add(bruteGearGroup);

      const weakPointMesh = new THREE.Mesh(
        new THREE.CylinderGeometry(0.14, 0.14, 0.32, 10),
        new THREE.MeshStandardMaterial({
          color: 0xf97316,
          emissive: 0xea580c,
          emissiveIntensity: 1.5,
          roughness: 0.35,
        }),
      );
      weakPointMesh.position.set(0, 1.14, -0.24);
      weakPointMesh.visible = false;
      weakPointMesh.userData = { poolIdx: i, hitZone: 'back_weakpoint' as HitZone };
      humanoidGroup.add(weakPointMesh);

      // Bloater toxic pustules cluster
      const bloaterCystsGroup = new THREE.Group();
      bloaterCystsGroup.visible = false;
      const cystOffsets = [
        [0.14, 1.05, 0.17, 0.16],
        [-0.12, 0.92, 0.18, 0.18],
        [0.02, 1.18, 0.15, 0.14],
        [0.16, 1.24, -0.12, 0.14],
        [-0.15, 1.0, -0.15, 0.17],
      ] as const;
      for (const [cx, cy, cz, rad] of cystOffsets) {
        const cyst = new THREE.Mesh(new THREE.SphereGeometry(rad, 8, 7), this.bloaterCystMat);
        cyst.position.set(cx, cy, cz);
        bloaterCystsGroup.add(cyst);
      }
      humanoidGroup.add(bloaterCystsGroup);

      // Arms
      const leftArm = new THREE.Group();
      leftArm.position.set(-0.3, 1.26, 0);
      const laMesh = new THREE.Mesh(this.armGeo, skinMat);
      laMesh.userData = { poolIdx: i, hitZone: 'limb' as HitZone };
      const laSleeve = new THREE.Mesh(new THREE.CylinderGeometry(0.072, 0.068, 0.18, 8), clothMat);
      laSleeve.position.y = -0.09;
      leftArm.add(laMesh, laSleeve);
      humanoidGroup.add(leftArm);

      const rightArm = new THREE.Group();
      rightArm.position.set(0.3, 1.26, 0);
      const raMesh = new THREE.Mesh(this.armGeo, skinMat);
      raMesh.userData = { poolIdx: i, hitZone: 'limb' as HitZone };
      const raSleeve = new THREE.Mesh(new THREE.CylinderGeometry(0.072, 0.068, 0.18, 8), clothMat);
      raSleeve.position.y = -0.09;
      rightArm.add(raMesh, raSleeve);
      humanoidGroup.add(rightArm);

      // Legs
      const leftLeg = new THREE.Group();
      leftLeg.position.set(-0.13, 0.72, 0);
      const llMesh = new THREE.Mesh(this.legGeo, pantsMat);
      llMesh.userData = { poolIdx: i, hitZone: 'limb' as HitZone };
      leftLeg.add(llMesh);
      humanoidGroup.add(leftLeg);

      const rightLeg = new THREE.Group();
      rightLeg.position.set(0.13, 0.72, 0);
      const rlMesh = new THREE.Mesh(this.legGeo, pantsMat);
      rlMesh.userData = { poolIdx: i, hitZone: 'limb' as HitZone };
      rightLeg.add(rlMesh);
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
        headMesh,
        torsoMesh,
        laMesh,
        raMesh,
        llMesh,
        rlMesh,
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
        speedClass: 'walk',
        moveSpeed: BALANCE.enemies.shambler.walkSpeed,
        health: 150,
        maxHealth: 150,
        state: 'dead',
        stateTimer: 0,
        attackCooldown: 0,
        attackDealt: false,
        chargeCooldown: 4,
        groanTimer: 2,
        hitReactTimer: 0,
        hitReactDirX: 0,
        hitReactDirZ: 0,
        staggerTimer: 0,
        isCrawler: false,
        woundedShown: false,
        x: 0,
        y: 0,
        z: 0,
        yaw: 0,
        vx: 0,
        vz: 0,
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
        headMesh,
        torsoMesh,
        leftArm,
        rightArm,
        leftLeg,
        rightLeg,
        houndLegs,
        houndHead,
        weakPointMesh,
        bruteGearGroup,
        bloaterCystsGroup,
        fungalGrowthMesh,
        eyesMesh,
        bloodWoundMesh,
        hitboxMeshes,
        baseMaterials: [skinMat, clothMat, pantsMat, bloodMat],
        dissolveMaterials: null,
        rigMeshes: {
          skinMeshes: [headMesh, laMesh, raMesh],
          clothMeshes: [torsoMesh, laSleeve, raSleeve],
          pantsMeshes: [llMesh, rlMesh],
          bloodMeshes: [chestBlood, bloodWoundMesh],
          houndMeshes: [hBody, hHeadMesh, ...(houndLegs.map((lg) => lg.children[0] as THREE.Mesh))],
        },
        animPhase: i * 1.13,
        spawnFogTimer: 0,
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
    mat.customProgramCacheKey = () => `zombie_dissolve_${srcMat.map ? 'tex' : 'flat'}`;
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

  public spawnEnemy(
    type: EnemyType,
    round: number,
    spawnPoint: SpawnPoint,
    rng: SeededRng,
  ): boolean {
    const slot = this.entities.find((e) => !e.active);
    if (!slot) return false;

    const baseHp = calculateZombieHealth(round);
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

    slot.id = this.nextZombieId++;
    slot.active = true;
    slot.type = type;
    slot.speedClass = speedClass;
    slot.moveSpeed = moveSpeed;
    slot.health = hp;
    slot.maxHealth = hp;
    slot.isCrawler = false;
    slot.woundedShown = false;
    slot.dissolveUniform.value = 0;
    slot.corpseTimer = 0;
    slot.attackCooldown = 0;
    slot.attackDealt = false;
    slot.chargeCooldown = 4.0;
    slot.hitReactTimer = 0;
    slot.staggerTimer = 0;
    slot.groanTimer = 1 + rng.next() * 4;

    slot.x = spawnPoint.position.x + (rng.next() - 0.5) * 1.2;
    slot.y = 0;
    slot.z = spawnPoint.position.z + (rng.next() - 0.5) * 1.2;
    slot.vx = 0;
    slot.vz = 0;
    slot.lastProgressX = slot.x;
    slot.lastProgressZ = slot.z;
    slot.stuckTimer = 0;

    // Reset rig transforms
    slot.leftLeg.visible = true;
    slot.rightLeg.visible = true;
    slot.bloodWoundMesh.visible = false;
    slot.bodyGroup.position.set(0, 0, 0);
    slot.bodyGroup.rotation.set(0, 0, 0);

    if (type === 'hound') {
      slot.humanoidGroup.visible = false;
      slot.houndGroup.visible = true;
      slot.bruteGearGroup.visible = false;
      slot.bloaterCystsGroup.visible = false;
      slot.weakPointMesh.visible = false;
      slot.root.scale.set(1.0, 1.0, 1.0);
      slot.spawnFogTimer = 0.75;
      slot.spawnFogRing.visible = true;
      slot.baseMaterials[0] = this.houndSkinMat;
      this.applyHoundMaterial(slot, this.houndSkinMat);
    } else {
      slot.humanoidGroup.visible = true;
      slot.houndGroup.visible = false;
      slot.spawnFogTimer = 0;
      slot.spawnFogRing.visible = false;

      slot.weakPointMesh.visible = type === 'brute';
      slot.bruteGearGroup.visible = type === 'brute';
      slot.bloaterCystsGroup.visible = type === 'bloater';
      slot.fungalGrowthMesh.visible = type === 'shambler' && slot.id % 2 === 0;

      if (type === 'bloater') {
        slot.root.scale.set(1.36, 1.04, 1.38);
        slot.baseMaterials[0] = this.bloaterSkinMat;
        slot.baseMaterials[1] = this.bloaterClothMat;
        slot.eyesMesh.material = this.bloaterEyeMat;
      } else if (type === 'brute') {
        slot.root.scale.set(1.38, 1.36, 1.36);
        slot.baseMaterials[0] = this.bruteSkinMat;
        slot.baseMaterials[1] = this.bruteArmorMat;
        slot.eyesMesh.material = this.houndEyeMat;
      } else {
        const skinVar = (slot.id + Math.floor(rng.next() * 3)) % this.mats.zombieSkins.length;
        const clothVar = (slot.id + Math.floor(rng.next() * 6)) % this.mats.zombieCloths.length;
        const hScale = 0.95 + rng.next() * 0.1;
        slot.root.scale.set(0.98 + rng.next() * 0.08, hScale, 1.0);
        slot.baseMaterials[0] = this.mats.zombieSkins[skinVar]!;
        slot.baseMaterials[1] = this.mats.zombieCloths[clothVar]!;
        slot.eyesMesh.material = this.eyeMat;
      }
      this.applyMaterialsToRig(slot, slot.baseMaterials);
    }

    if (spawnPoint.windowId && type !== 'hound') {
      slot.windowId = spawnPoint.windowId;
      slot.state = 'approach_window';
    } else {
      slot.windowId = null;
      slot.state = 'chase';
    }

    slot.root.position.set(slot.x, slot.y, slot.z);
    slot.root.visible = true;
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
    this.raycaster.set(origin, direction);
    this.raycaster.near = 0.1;
    this.raycaster.far = maxDistance;
    const hits = this.raycaster.intersectObjects(this.allHitboxes, false);
    for (const h of hits) {
      const poolIdx = h.object.userData.poolIdx as number | undefined;
      if (poolIdx === undefined) continue;
      const ent = this.entities[poolIdx];
      if (!ent || !ent.active || ent.state === 'dying' || ent.state === 'dead') continue;
      if (!ZombieSystem.isVisibleInHierarchy(h.object)) continue;
      return {
        poolIdx,
        hitZone: (h.object.userData.hitZone as HitZone) ?? 'torso',
        point: h.point.clone(),
        normal: h.face ? h.face.normal.clone() : new THREE.Vector3(0, 1, 0),
        distance: h.distance,
      };
    }
    return null;
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
    e.hitReactTimer = 0.22;
    e.hitReactDirX = dirX;
    e.hitReactDirZ = dirZ;

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
      e.staggerTimer = Math.max(e.staggerTimer, 0.14);
    }

    if (e.health <= 0) {
      const wasBloater = e.type === 'bloater';
      this.killEntity(e);
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
      const t = Math.sqrt(dSq) / radius;
      const dmg = instaKill
        ? e.type === 'brute'
          ? e.maxHealth * 0.5
          : e.health + 999
        : THREE.MathUtils.lerp(innerDamage, outerDamage, t);
      e.health -= dmg;
      if (e.health <= 0) {
        this.killEntity(e);
        onKill(e);
        kills++;
      } else {
        e.staggerTimer = 0.28;
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
        e.x += (dx / d) * strength;
        e.z += (dz / d) * strength;
        e.staggerTimer = 1.4;
      }
    }
  }

  public killAllNonBoss(onKill: (e: ZombieEntity) => void): void {
    for (const e of this.entities) {
      if (!e.active || e.state === 'dying' || e.state === 'dead') continue;
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

  private killEntity(e: ZombieEntity): void {
    e.state = 'dying';
    e.stateTimer = 0;
    e.corpseTimer = 0;

    // Dispose old dissolve materials if re-used across types so textures stay accurate
    if (e.dissolveMaterials) {
      for (const dm of e.dissolveMaterials) dm.dispose();
    }
    e.dissolveMaterials = [
      this.createDissolveMaterial(e.baseMaterials[0], e.dissolveUniform),
      this.createDissolveMaterial(e.baseMaterials[1], e.dissolveUniform),
      this.createDissolveMaterial(e.baseMaterials[2], e.dissolveUniform),
      this.createDissolveMaterial(e.baseMaterials[3], e.dissolveUniform),
    ];

    if (e.type === 'hound') {
      this.applyHoundMaterial(e, e.dissolveMaterials[0]);
    } else {
      this.applyMaterialsToRig(e, e.dissolveMaterials);
    }
  }

  public update(
    dt: number,
    playerPos: THREE.Vector3,
    windows: Map<string, WindowBarricade>,
    unlockedZones: Set<ZoneId>,
    spawnPoints: SpawnPoint[],
    onMeleeHitPlayer: (damage: number, ax: number, az: number) => void,
    onBloaterExplode: (x: number, y: number, z: number) => void,
  ): void {
    this.aiFrameCounter++;

    for (let i = 0; i < MAX_ZOMBIES; i++) {
      const e = this.entities[i]!;
      const alive = e.active && e.state !== 'dying' && e.state !== 'dead';
      this.activeFlags[i] = alive ? 1 : 0;
      this.posX[i] = e.x;
      this.posZ[i] = e.z;
    }
    this.nav.rebuildSpatialHash(this.posX, this.posZ, this.activeFlags, MAX_ZOMBIES);

    for (let i = 0; i < MAX_ZOMBIES; i++) {
      const e = this.entities[i]!;
      if (!e.active) continue;

      if (e.spawnFogTimer > 0) {
        e.spawnFogTimer -= dt;
        const p = 1 - Math.max(0, e.spawnFogTimer / 0.75);
        const ringMat = e.spawnFogRing.material as THREE.MeshBasicMaterial;
        ringMat.opacity = (1 - p) * 0.55;
        const s = 0.7 + p * 2.1;
        e.spawnFogRing.scale.set(s, s, 1);
        if (e.spawnFogTimer <= 0) {
          e.spawnFogRing.visible = false;
        }
      }

      if (e.state === 'dying') {
        e.stateTimer += dt;
        const fallT = Math.min(1, e.stateTimer / 0.42);
        e.bodyGroup.rotation.x = THREE.MathUtils.lerp(0, -Math.PI * 0.48, fallT);
        e.bodyGroup.position.y = THREE.MathUtils.lerp(0, e.type === 'hound' ? 0.14 : 0.25, fallT);
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
        continue;
      }

      e.attackCooldown = Math.max(0, e.attackCooldown - dt);
      e.chargeCooldown = Math.max(0, e.chargeCooldown - dt);
      e.hitReactTimer = Math.max(0, e.hitReactTimer - dt);
      e.staggerTimer = Math.max(0, e.staggerTimer - dt);
      e.groanTimer -= dt;
      if (e.groanTimer <= 0) {
        e.groanTimer = 3.5 + Math.random() * 5.0;
        const distSq = (e.x - playerPos.x) ** 2 + (e.z - playerPos.z) ** 2;
        if (distSq < 28 * 28) {
          this.audio.playZombieSound(
            e.type === 'hound' ? 'hound' : e.type === 'brute' ? 'brute' : 'groan',
            e.x,
            1.3,
            e.z,
          );
        }
      }

      const dxToP = playerPos.x - e.x;
      const dzToP = playerPos.z - e.z;
      const distToP = Math.hypot(dxToP, dzToP);

      if (e.state === 'approach_window' && e.windowId) {
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
            e.x += e.vx * dt;
            e.z += e.vz * dt;
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
          if (e.stateTimer >= BALANCE.enemies.shambler.boardTearTime) {
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
          const t = Math.min(1, e.stateTimer / BALANCE.enemies.shambler.climbDuration);
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
        const pulse = 1 + Math.sin(e.stateTimer * 24) * 0.14;
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
        if (this.nav.isWalkableWorld(nx, nz)) {
          e.x = nx;
          e.z = nz;
        } else {
          e.state = 'chase';
        }
        if (distToP < BALANCE.enemies.brute.meleeRange) {
          onMeleeHitPlayer(BALANCE.enemies.brute.meleeDamage, e.x, e.z);
          e.state = 'chase';
          e.attackCooldown = 1.4;
        } else if (e.stateTimer >= BALANCE.enemies.brute.chargeDuration) {
          e.state = 'chase';
        }
      } else if (e.state === 'attack') {
        e.stateTimer += dt;
        e.yaw = Math.atan2(dxToP, dzToP);
        const windup =
          e.type === 'hound'
            ? BALANCE.enemies.hound.attackWindup
            : BALANCE.enemies.shambler.attackWindup;
        const hitTime = windup * 0.52;
        if (!e.attackDealt && e.stateTimer >= hitTime) {
          e.attackDealt = true;
          const reach =
            e.type === 'brute'
              ? BALANCE.enemies.brute.meleeRange + 0.3
              : BALANCE.enemies.shambler.meleeRange + 0.25;
          if (distToP <= reach && Math.abs(playerPos.y - 0.9 - e.y) < 1.9) {
            const dmg =
              e.type === 'hound'
                ? BALANCE.enemies.hound.meleeDamage
                : e.type === 'brute'
                  ? BALANCE.enemies.brute.meleeDamage
                  : BALANCE.enemies.shambler.meleeDamage;
            onMeleeHitPlayer(dmg, e.x, e.z);
          }
        }
        if (e.stateTimer >= windup) {
          e.state = 'chase';
          e.attackCooldown =
            e.type === 'hound'
              ? BALANCE.enemies.hound.attackCooldown
              : BALANCE.enemies.shambler.attackCooldown;
        }
      } else if (e.state === 'chase') {
        if (e.type === 'bloater' && distToP <= BALANCE.enemies.bloater.meleeRange) {
          e.state = 'bloater_fuse';
          e.stateTimer = 0;
        } else if (
          e.type === 'brute' &&
          e.chargeCooldown <= 0 &&
          distToP > 4.5 &&
          distToP < 14
        ) {
          e.state = 'brute_telegraph';
          e.stateTimer = 0;
          e.chargeCooldown = BALANCE.enemies.brute.chargeCooldown;
          this.audio.playZombieSound('brute', e.x, 1.5, e.z);
        } else {
          const meleeRange =
            e.type === 'hound'
              ? BALANCE.enemies.hound.meleeRange
              : e.type === 'brute'
                ? BALANCE.enemies.brute.meleeRange
                : BALANCE.enemies.shambler.meleeRange;
          if (distToP <= meleeRange && e.attackCooldown <= 0) {
            e.state = 'attack';
            e.stateTimer = 0;
            e.attackDealt = false;
            this.audio.playZombieSound(e.type === 'hound' ? 'hound' : 'attack', e.x, 1.4, e.z);
          } else if (e.staggerTimer <= 0) {
            if (distToP < 2.6 && this.nav.isWalkableWorld(e.x, e.z)) {
              const inv = 1 / Math.max(0.01, distToP);
              this.flowSample.x = dxToP * inv;
              this.flowSample.z = dzToP * inv;
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

            e.vx = dirX * e.moveSpeed;
            e.vz = dirZ * e.moveSpeed;
            const nx = e.x + e.vx * dt;
            const nz = e.z + e.vz * dt;
            if (this.nav.isWalkableWorld(nx, nz)) {
              e.x = nx;
              e.z = nz;
            } else {
              if (this.nav.isWalkableWorld(nx, e.z)) e.x = nx;
              else if (this.nav.isWalkableWorld(e.x, nz)) e.z = nz;
            }

            if (len > 0.05) {
              const targetYaw = Math.atan2(dirX, dirZ);
              let diff = targetYaw - e.yaw;
              while (diff > Math.PI) diff -= Math.PI * 2;
              while (diff < -Math.PI) diff += Math.PI * 2;
              e.yaw += diff * Math.min(1, dt * 8.5);
            }
          }
        }

        const progDist = Math.hypot(e.x - e.lastProgressX, e.z - e.lastProgressZ);
        if (progDist > 0.45) {
          e.lastProgressX = e.x;
          e.lastProgressZ = e.z;
          e.stuckTimer = 0;
        } else {
          e.stuckTimer += dt;
          if (e.stuckTimer >= BALANCE.enemies.shambler.stuckTimeout) {
            e.stuckTimer = 0;
            this.relocateStuckZombie(e, playerPos, unlockedZones, spawnPoints);
          }
        }
      }

      e.root.position.set(e.x, e.y, e.z);
      e.root.rotation.y = e.yaw;

      const isFar = distToP > BALANCE.perf.lodDistance;
      if (!isFar || (this.aiFrameCounter + i) % 3 === 0) {
        const animDt = isFar ? dt * 3 : dt;
        this.animateZombieRig(e, animDt);
      }
    }
  }

  private relocateStuckZombie(
    e: ZombieEntity,
    playerPos: THREE.Vector3,
    unlockedZones: Set<ZoneId>,
    spawnPoints: SpawnPoint[],
  ): void {
    const valid = spawnPoints.filter((s) => unlockedZones.has(s.zone));
    if (valid.length === 0) return;
    let best = valid[0]!;
    let bestDist = -1;
    for (const sp of valid) {
      const d = (sp.position.x - playerPos.x) ** 2 + (sp.position.z - playerPos.z) ** 2;
      if (d > bestDist && d > 100) {
        bestDist = d;
        best = sp;
      }
    }
    e.x = best.position.x;
    e.z = best.position.z;
    e.y = 0;
    e.lastProgressX = e.x;
    e.lastProgressZ = e.z;
    e.stuckCount++;
    this.stuckTeleportCount++;
    if (best.windowId && e.type !== 'hound') {
      e.windowId = best.windowId;
      e.state = 'approach_window';
    } else {
      e.windowId = null;
      e.state = 'chase';
    }
  }

  private animateZombieRig(e: ZombieEntity, dt: number): void {
    if (e.type === 'hound') {
      e.animPhase += dt * 13.5;
      const g = Math.sin(e.animPhase);
      const c = Math.cos(e.animPhase);
      e.houndLegs[0].rotation.x = g * 0.72;
      e.houndLegs[1].rotation.x = g * 0.72 + 0.15;
      e.houndLegs[2].rotation.x = -g * 0.72;
      e.houndLegs[3].rotation.x = -g * 0.72 + 0.15;
      e.bodyGroup.position.y = Math.abs(c) * 0.08;
      e.houndHead.rotation.x = e.state === 'attack' ? -0.35 + g * 0.35 : c * 0.12;
      return;
    }

    const strideFreq = e.speedClass === 'sprint' ? 11.5 : e.speedClass === 'run' ? 8.2 : 4.8;
    e.animPhase += dt * strideFreq;
    const s = Math.sin(e.animPhase);
    const c = Math.cos(e.animPhase);

    if (e.isCrawler) {
      e.bodyGroup.position.y = -0.58;
      e.bodyGroup.rotation.x = 1.25;
      e.leftArm.rotation.x = -1.2 + s * 0.45;
      e.rightArm.rotation.x = -1.2 - s * 0.45;
      return;
    }

    if (e.hitReactTimer > 0) {
      e.bodyGroup.rotation.x = -0.28 * (e.hitReactTimer / 0.22);
    } else if (e.state === 'brute_telegraph') {
      e.bodyGroup.rotation.x = 0.28;
      e.leftArm.rotation.x = -2.4;
      e.rightArm.rotation.x = -2.4;
      return;
    } else {
      e.bodyGroup.rotation.x = e.speedClass === 'sprint' ? 0.18 : 0.06;
    }

    if (e.state === 'attack' || e.state === 'tear_board') {
      const swing = Math.sin(e.stateTimer * 9);
      e.leftArm.rotation.x = -1.7 + swing * 0.75;
      e.rightArm.rotation.x = -1.7 - swing * 0.75;
      e.leftLeg.rotation.x = 0;
      e.rightLeg.rotation.x = 0;
    } else {
      e.leftLeg.rotation.x = s * 0.62;
      e.rightLeg.rotation.x = -s * 0.62;
      e.leftArm.rotation.x = -1.25 + c * 0.22;
      e.rightArm.rotation.x = -1.25 - c * 0.22;
      e.bodyGroup.position.y = Math.abs(s) * 0.045;
      e.headMesh.rotation.z = c * 0.14;
      e.headMesh.rotation.x = 0.1 + s * 0.06;
    }
    void this.tmpVec;
  }
}
