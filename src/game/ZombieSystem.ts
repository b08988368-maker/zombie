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

  // Visual rig
  root: THREE.Group;
  bodyGroup: THREE.Group;
  headMesh: THREE.Mesh;
  torsoMesh: THREE.Mesh;
  leftArm: THREE.Group;
  rightArm: THREE.Group;
  leftLeg: THREE.Group;
  rightLeg: THREE.Group;
  weakPointMesh: THREE.Mesh | null;
  hitboxMeshes: THREE.Mesh[];
  baseMaterials: [THREE.MeshStandardMaterial, THREE.MeshStandardMaterial, THREE.MeshStandardMaterial, THREE.MeshStandardMaterial];
  dissolveMaterials: [THREE.MeshStandardMaterial, THREE.MeshStandardMaterial, THREE.MeshStandardMaterial, THREE.MeshStandardMaterial] | null;
  torsoSubMeshes: { head: THREE.Mesh; torso: THREE.Mesh; blood: THREE.Mesh; la: THREE.Mesh; ra: THREE.Mesh; ll: THREE.Mesh; rl: THREE.Mesh };
  animPhase: number;
}

const MAX_ZOMBIES = BALANCE.rounds.maxAlive;

const SHIRT_PALETTE = [0x3b4d3e, 0x32404d, 0x5c4738, 0x4b4b48, 0x623b3b, 0x3b394a];
const SKIN_PALETTE = [0x6e7868, 0x5e695c, 0x767a6b, 0x586259, 0x6b6f60, 0x616d62];

export class ZombieSystem {
  public readonly entities: ZombieEntity[] = [];
  public stuckTeleportCount = 0;

  private readonly scene: THREE.Scene;
  private readonly nav: NavGrid;
  private readonly audio: AudioEngine;
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

  // Shared geometries to minimize draw/memory overhead
  private readonly headGeo = new THREE.BoxGeometry(0.28, 0.3, 0.28);
  private readonly torsoGeo = new THREE.BoxGeometry(0.48, 0.62, 0.28);
  private readonly armGeo = new THREE.BoxGeometry(0.14, 0.56, 0.14);
  private readonly legGeo = new THREE.BoxGeometry(0.18, 0.64, 0.18);
  private readonly eyesGeo = ZombieSystem.buildEyesGeo();
  private readonly eyeMat = new THREE.MeshBasicMaterial({ color: 0xfacc15 });
  private readonly houndEyeMat = new THREE.MeshBasicMaterial({ color: 0xef4444 });
  private readonly bloaterEyeMat = new THREE.MeshBasicMaterial({ color: 0x84cc16 });

  private static buildEyesGeo(): THREE.BufferGeometry {
    const left = new THREE.BoxGeometry(0.05, 0.035, 0.03);
    left.translate(-0.06, 0.03, 0.145);
    const right = new THREE.BoxGeometry(0.05, 0.035, 0.03);
    right.translate(0.06, 0.03, 0.145);
    const merged = mergeGeometries([left, right]);
    left.dispose();
    right.dispose();
    return merged ?? new THREE.BoxGeometry(0.14, 0.035, 0.03);
  }

  private readonly variantSkins: THREE.MeshStandardMaterial[] = [];
  private readonly variantCloths: THREE.MeshStandardMaterial[] = [];
  private sharedPantsMat!: THREE.MeshStandardMaterial;
  private sharedBloodMat!: THREE.MeshStandardMaterial;
  private readonly specialSkinMat = new THREE.MeshStandardMaterial({ color: 0x3a2b28, roughness: 0.72, metalness: 0.08 });
  private readonly specialClothMat = new THREE.MeshStandardMaterial({ color: 0x281e1c, roughness: 0.85, metalness: 0.08 });
  private readonly bloaterSkinMat = new THREE.MeshStandardMaterial({ color: 0x637846, roughness: 0.72, metalness: 0.08 });
  private readonly bloaterClothMat = new THREE.MeshStandardMaterial({ color: 0x4b5c34, roughness: 0.85, metalness: 0.08 });
  private readonly bruteSkinMat = new THREE.MeshStandardMaterial({ color: 0x454549, roughness: 0.72, metalness: 0.08 });
  private readonly bruteClothMat = new THREE.MeshStandardMaterial({ color: 0x27272a, roughness: 0.85, metalness: 0.08 });

  constructor(
    scene: THREE.Scene,
    nav: NavGrid,
    audio: AudioEngine,
    isSoftwareGl: boolean,
  ) {
    this.scene = scene;
    this.nav = nav;
    this.audio = audio;
    this.isSoftwareGl = isSoftwareGl;
    this.allocatePool();
  }

  private allocatePool(): void {
    this.armGeo.translate(0, -0.24, 0);
    this.legGeo.translate(0, -0.3, 0);

    for (let v = 0; v < 6; v++) {
      this.variantSkins.push(
        new THREE.MeshStandardMaterial({ color: SKIN_PALETTE[v]!, roughness: 0.72, metalness: 0.08 }),
      );
      this.variantCloths.push(
        new THREE.MeshStandardMaterial({ color: SHIRT_PALETTE[v]!, roughness: 0.85, metalness: 0.08 }),
      );
    }
    this.sharedPantsMat = new THREE.MeshStandardMaterial({ color: 0x282b2e, roughness: 0.88, metalness: 0.08 });
    this.sharedBloodMat = new THREE.MeshStandardMaterial({ color: 0x521010, roughness: 0.35, metalness: 0.08 });

    for (let i = 0; i < MAX_ZOMBIES; i++) {
      const variant = i % 6;
      const dissolveUniform = { value: 0 };

      const skinMat = this.variantSkins[variant]!;
      const clothMat = this.variantCloths[variant]!;
      const pantsMat = this.sharedPantsMat;
      const bloodMat = this.sharedBloodMat;

      const root = new THREE.Group();
      root.visible = false;

      const bodyGroup = new THREE.Group();
      root.add(bodyGroup);

      const torsoMesh = new THREE.Mesh(this.torsoGeo, clothMat);
      torsoMesh.position.y = 1.02;
      torsoMesh.castShadow = !this.isSoftwareGl;
      torsoMesh.userData = { poolIdx: i, hitZone: 'torso' as HitZone };
      bodyGroup.add(torsoMesh);

      // Bloodied apron/chest patch for variant readability
      const bloodPatch = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.34, 0.295), bloodMat);
      bloodPatch.position.set((variant % 2 === 0 ? 1 : -1) * 0.04, 0.04, 0);
      torsoMesh.add(bloodPatch);

      // Head + faint glowing yellow eyes
      const headMesh = new THREE.Mesh(this.headGeo, skinMat);
      headMesh.position.set(0, 1.5, 0.02);
      headMesh.castShadow = !this.isSoftwareGl;
      headMesh.userData = { poolIdx: i, hitZone: 'head' as HitZone };
      bodyGroup.add(headMesh);

      const eyesMesh = new THREE.Mesh(this.eyesGeo, this.eyeMat);
      headMesh.add(eyesMesh);

      // Weakpoint mesh (visible only on Brute)
      const weakPointMesh = new THREE.Mesh(
        new THREE.SphereGeometry(0.19, 8, 8),
        new THREE.MeshStandardMaterial({
          color: 0xf97316,
          emissive: 0xea580c,
          emissiveIntensity: 1.4,
          roughness: 0.4,
        }),
      );
      weakPointMesh.position.set(0, 1.12, -0.22);
      weakPointMesh.visible = false;
      weakPointMesh.userData = { poolIdx: i, hitZone: 'back_weakpoint' as HitZone };
      bodyGroup.add(weakPointMesh);

      // Arms
      const leftArm = new THREE.Group();
      leftArm.position.set(-0.32, 1.24, 0);
      const laMesh = new THREE.Mesh(this.armGeo, skinMat);
      laMesh.userData = { poolIdx: i, hitZone: 'limb' as HitZone };
      leftArm.add(laMesh);
      bodyGroup.add(leftArm);

      const rightArm = new THREE.Group();
      rightArm.position.set(0.32, 1.24, 0);
      const raMesh = new THREE.Mesh(this.armGeo, skinMat);
      raMesh.userData = { poolIdx: i, hitZone: 'limb' as HitZone };
      rightArm.add(raMesh);
      bodyGroup.add(rightArm);

      // Legs
      const leftLeg = new THREE.Group();
      leftLeg.position.set(-0.14, 0.68, 0);
      const llMesh = new THREE.Mesh(this.legGeo, pantsMat);
      llMesh.userData = { poolIdx: i, hitZone: 'limb' as HitZone };
      leftLeg.add(llMesh);
      bodyGroup.add(leftLeg);

      const rightLeg = new THREE.Group();
      rightLeg.position.set(0.14, 0.68, 0);
      const rlMesh = new THREE.Mesh(this.legGeo, pantsMat);
      rlMesh.userData = { poolIdx: i, hitZone: 'limb' as HitZone };
      rightLeg.add(rlMesh);
      bodyGroup.add(rightLeg);

      const hitboxMeshes = [headMesh, torsoMesh, laMesh, raMesh, llMesh, rlMesh, weakPointMesh];
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
        chargeCooldown: 0,
        groanTimer: 2,
        hitReactTimer: 0,
        hitReactDirX: 0,
        hitReactDirZ: 0,
        staggerTimer: 0,
        isCrawler: false,
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
        headMesh,
        torsoMesh,
        leftArm,
        rightArm,
        leftLeg,
        rightLeg,
        weakPointMesh,
        hitboxMeshes,
        baseMaterials: [skinMat, clothMat, pantsMat, bloodMat],
        dissolveMaterials: null,
        torsoSubMeshes: {
          head: headMesh,
          torso: torsoMesh,
          blood: bloodPatch,
          la: laMesh,
          ra: raMesh,
          ll: llMesh,
          rl: rlMesh,
        },
        animPhase: i * 1.13,
      });
    }
  }

  private createDissolveMaterial(
    colorHex: number,
    roughness: number,
    dissolveUniform: { value: number },
  ): THREE.MeshStandardMaterial {
    const mat = new THREE.MeshStandardMaterial({
      color: colorHex,
      roughness,
      metalness: 0.08,
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
    mat.customProgramCacheKey = () => 'zombie_dissolve';
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

    // Configure visual proportions per enemy type
    slot.weakPointMesh!.visible = type === 'brute';
    slot.leftLeg.visible = true;
    slot.rightLeg.visible = true;
    slot.bodyGroup.position.set(0, 0, 0);
    slot.bodyGroup.rotation.set(0, 0, 0);

    if (type === 'hound') {
      slot.root.scale.set(0.78, 0.56, 1.35);
      slot.bodyGroup.rotation.x = 0.72;
      slot.baseMaterials[0] = this.specialSkinMat;
      slot.baseMaterials[1] = this.specialClothMat;
      (slot.headMesh.children[0] as THREE.Mesh).material = this.houndEyeMat;
    } else if (type === 'bloater') {
      slot.root.scale.set(1.42, 1.06, 1.48);
      slot.baseMaterials[0] = this.bloaterSkinMat;
      slot.baseMaterials[1] = this.bloaterClothMat;
      (slot.headMesh.children[0] as THREE.Mesh).material = this.bloaterEyeMat;
    } else if (type === 'brute') {
      slot.root.scale.set(1.48, 1.38, 1.45);
      slot.baseMaterials[0] = this.bruteSkinMat;
      slot.baseMaterials[1] = this.bruteClothMat;
      (slot.headMesh.children[0] as THREE.Mesh).material = this.houndEyeMat;
    } else {
      const variant = (slot.id + Math.floor(rng.next() * 6)) % 6;
      slot.root.scale.set(1, 0.96 + rng.next() * 0.08, 1);
      slot.baseMaterials[0] = this.variantSkins[variant]!;
      slot.baseMaterials[1] = this.variantCloths[variant]!;
      (slot.headMesh.children[0] as THREE.Mesh).material = this.eyeMat;
    }
    this.applyMaterialsToRig(slot, slot.baseMaterials);

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
      if (!h.object.visible) continue;
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

    if (hitZone === 'limb' && e.type === 'shambler' && e.health > 0 && e.health < e.maxHealth * 0.32 && !e.isCrawler) {
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

  private applyMaterialsToRig(
    e: ZombieEntity,
    mats: [THREE.MeshStandardMaterial, THREE.MeshStandardMaterial, THREE.MeshStandardMaterial, THREE.MeshStandardMaterial],
  ): void {
    e.torsoSubMeshes.head.material = mats[0];
    e.torsoSubMeshes.la.material = mats[0];
    e.torsoSubMeshes.ra.material = mats[0];
    e.torsoSubMeshes.torso.material = mats[1];
    e.torsoSubMeshes.ll.material = mats[2];
    e.torsoSubMeshes.rl.material = mats[2];
    e.torsoSubMeshes.blood.material = mats[3];
  }

  private killEntity(e: ZombieEntity): void {
    e.state = 'dying';
    e.stateTimer = 0;
    e.corpseTimer = 0;
    if (!e.dissolveMaterials) {
      e.dissolveMaterials = [
        this.createDissolveMaterial(e.baseMaterials[0].color.getHex(), 0.72, e.dissolveUniform),
        this.createDissolveMaterial(e.baseMaterials[1].color.getHex(), 0.85, e.dissolveUniform),
        this.createDissolveMaterial(0x282b2e, 0.88, e.dissolveUniform),
        this.createDissolveMaterial(0x521010, 0.35, e.dissolveUniform),
      ];
    } else {
      e.dissolveMaterials[0].color.copy(e.baseMaterials[0].color);
      e.dissolveMaterials[1].color.copy(e.baseMaterials[1].color);
    }
    this.applyMaterialsToRig(e, e.dissolveMaterials);
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

    // Populate spatial hash inputs
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

      if (e.state === 'dying') {
        e.stateTimer += dt;
        const fallT = Math.min(1, e.stateTimer / 0.42);
        e.bodyGroup.rotation.x = THREE.MathUtils.lerp(0, -Math.PI * 0.48, fallT);
        e.bodyGroup.position.y = THREE.MathUtils.lerp(0, 0.25, fallT);
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

      // Barricade Window traversal state machine
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
        const pulse = 1 + Math.sin(e.stateTimer * 22) * 0.14;
        e.root.scale.set(1.42 * pulse, 1.06 * pulse, 1.48 * pulse);
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
        // Trigger Bloater fuse or Brute charge or Melee attack
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
            // Flow-field steering + spatial-hash separation (anti-conga-line)
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
              // Slide along walkable axis
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

        // Stuck detection (5s without making >0.4m progress)
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

      // Apply world transform & LOD animation
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
    // Choose farthest spawn point (out of sight)
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

    // Hit reaction lean
    if (e.hitReactTimer > 0) {
      e.bodyGroup.rotation.x = -0.25 * (e.hitReactTimer / 0.22);
    } else if (e.type !== 'hound') {
      e.bodyGroup.rotation.x = e.speedClass === 'sprint' ? 0.16 : 0.06;
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
      e.headMesh.rotation.z = c * 0.12;
    }
    void this.tmpVec;
  }
}
