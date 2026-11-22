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
  life: number;
  maxLife: number;
  gravity: number;
  active: boolean;
}

interface TracerItem {
  line: THREE.Mesh;
  life: number;
  active: boolean;
}

interface PhaseBolt {
  mesh: THREE.Mesh;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  life: number;
  upgraded: boolean;
  active: boolean;
}

interface ActiveGrenade {
  rb: DynamicGrenadeBody;
  mesh: THREE.Mesh;
  fuse: number;
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
  private readonly muzzleSprites = new Map<WeaponId, THREE.Sprite>();
  private readonly knifeGroup = new THREE.Group();
  private readonly bottleGroup = new THREE.Group();
  private readonly bottleLiquidMat: THREE.MeshStandardMaterial;

  // Muzzle lights (capped at 2 simultaneous per §4)
  private readonly muzzleLights: { light: THREE.PointLight; timer: number }[] = [];
  private muzzleLightCursor = 0;

  // Pooled particles, tracers, decals, phase bolts, grenades
  private readonly particles: ParticleItem[] = [];
  private readonly tracers: TracerItem[] = [];
  private readonly decals: THREE.Mesh[] = [];
  private decalCursor = 0;
  private readonly phaseBolts: PhaseBolt[] = [];
  private phaseLight!: THREE.PointLight;
  private readonly activeGrenades: ActiveGrenade[] = [];

  private recoilOffsetZ = 0;
  private recoilOffsetPitch = 0;
  private swayX = 0;
  private swayY = 0;
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
  private readonly tmpQuat = new THREE.Quaternion();

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

  public reset(): void {
    this.slots = [this.createSlotState('service_pistol', false)];
    this.activeSlot = 0;
    this.isReloading = false;
    this.reloadTimer = 0;
    this.fireCooldown = 0;
    this.swapTimer = 0;
    this.recoilOffsetZ = 0;
    this.recoilOffsetPitch = 0;
    this.activeGrenades.forEach((g) => {
      this.scene.remove(g.mesh);
      this.physics.removeGrenadeBody(g.rb.id);
    });
    this.activeGrenades.length = 0;
    this.syncVisibleViewmodel();
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

  public giveWeapon(id: WeaponId, upgraded = false): void {
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
    const sleeveMat = new THREE.MeshStandardMaterial({ color: 0x2a332e, roughness: 0.85 });
    const gloveMat = new THREE.MeshStandardMaterial({ color: 0x1c1c1c, roughness: 0.75 });
    const accentMat = new THREE.MeshStandardMaterial({
      color: 0x38bdf8,
      emissive: 0x0ea5e9,
      emissiveIntensity: 1.6,
      roughness: 0.2,
    });

    const weaponSpecs: Record<
      WeaponId,
      { len: number; height: number; width: number; hasStock: boolean; hasDrum: boolean; isLong: boolean; wood: boolean; isPhase?: boolean }
    > = {
      service_pistol: { len: 0.24, height: 0.12, width: 0.038, hasStock: false, hasDrum: false, isLong: false, wood: false },
      hedgerow: { len: 0.72, height: 0.11, width: 0.052, hasStock: true, hasDrum: false, isLong: true, wood: true },
      rattler: { len: 0.44, height: 0.13, width: 0.048, hasStock: false, hasDrum: false, isLong: false, wood: false },
      ironsight: { len: 0.64, height: 0.13, width: 0.05, hasStock: true, hasDrum: false, isLong: true, wood: false },
      longbow: { len: 0.84, height: 0.12, width: 0.048, hasStock: true, hasDrum: false, isLong: true, wood: true },
      hammerfall: { len: 0.76, height: 0.16, width: 0.068, hasStock: true, hasDrum: true, isLong: true, wood: false },
      phase_cannon: { len: 0.56, height: 0.15, width: 0.074, hasStock: false, hasDrum: false, isLong: false, wood: false, isPhase: true },
    };

    (Object.keys(weaponSpecs) as WeaponId[]).forEach((id) => {
      const spec = weaponSpecs[id];
      const g = new THREE.Group();
      const recH = spec.height * 0.52;
      const recY = 0.0;
      const topY = recY + recH * 0.5;

      // Lower frame / receiver
      const recMat = spec.isPhase ? this.mats.gunMetal : this.mats.gunPolymer;
      const receiver = new THREE.Mesh(
        new THREE.BoxGeometry(spec.width, recH, spec.len * 0.56),
        recMat,
      );
      receiver.position.set(0, recY, -spec.len * 0.22);
      g.add(receiver);

      // Upper slide / shroud seated flush on receiver
      const slide = new THREE.Mesh(
        new THREE.BoxGeometry(spec.width * 0.92, recH * 0.62, spec.len * 0.58),
        this.mats.gunMetal,
      );
      slide.position.set(0, topY + recH * 0.28, -spec.len * 0.24);
      g.add(slide);
      const slideTopY = slide.position.y + (recH * 0.62) * 0.5;

      // Barrel + muzzle crown
      const barrelRadius = spec.width * 0.24;
      const barrel = new THREE.Mesh(
        new THREE.CylinderGeometry(barrelRadius, barrelRadius * 1.08, spec.len * 0.62, 12),
        this.mats.gunMetal,
      );
      barrel.rotation.x = Math.PI / 2;
      barrel.position.set(0, slide.position.y - 0.004, -spec.len * 0.56);
      g.add(barrel);

      // Forend / pump / handguard for long guns
      if (spec.isLong) {
        const forend = new THREE.Mesh(
          new THREE.BoxGeometry(spec.width * 0.96, recH * 0.56, spec.len * 0.34),
          spec.wood ? this.mats.gunWood : this.mats.gunPolymer,
        );
        forend.position.set(0, recY - 0.004, -spec.len * 0.52);
        g.add(forend);
      }

      // Grip + trigger guard
      const grip = new THREE.Mesh(
        new THREE.BoxGeometry(spec.width * 0.8, 0.125, 0.044),
        spec.wood ? this.mats.gunWood : this.mats.gunPolymer,
      );
      grip.position.set(0, -0.072, -0.02);
      grip.rotation.x = 0.22;
      g.add(grip);

      const triggerGuard = new THREE.Mesh(
        new THREE.BoxGeometry(spec.width * 0.4, 0.026, 0.055),
        this.mats.gunMetal,
      );
      triggerGuard.position.set(0, -0.036, -0.068);
      g.add(triggerGuard);

      // Magazine or drum
      if (spec.hasDrum) {
        const drum = new THREE.Mesh(
          new THREE.CylinderGeometry(0.064, 0.064, 0.085, 14),
          this.mats.gunMetal,
        );
        drum.rotation.x = Math.PI / 2;
        drum.position.set(0, -0.075, -0.2);
        g.add(drum);
      } else if (id !== 'hedgerow' && id !== 'service_pistol') {
        const mag = new THREE.Mesh(
          new THREE.BoxGeometry(spec.width * 0.62, 0.13, 0.042),
          this.mats.gunMetal,
        );
        mag.position.set(0, -0.082, -spec.len * 0.26);
        mag.rotation.x = -0.14;
        g.add(mag);
      }

      // Stock
      if (spec.hasStock) {
        const stock = new THREE.Mesh(
          new THREE.BoxGeometry(spec.width * 0.82, 0.078, 0.22),
          spec.wood ? this.mats.gunWood : this.mats.gunPolymer,
        );
        stock.position.set(0, -0.018, 0.07);
        g.add(stock);
      }

      // Flush iron sights / scope / Phase coils
      if (id === 'longbow') {
        const mountA = new THREE.Mesh(new THREE.BoxGeometry(0.018, 0.022, 0.022), this.mats.gunMetal);
        mountA.position.set(0, slideTopY + 0.01, -0.16);
        const mountB = mountA.clone();
        mountB.position.z = -0.28;
        const scope = new THREE.Mesh(new THREE.CylinderGeometry(0.021, 0.024, 0.24, 12), this.mats.gunMetal);
        scope.rotation.x = Math.PI / 2;
        scope.position.set(0, slideTopY + 0.032, -0.22);
        g.add(mountA, mountB, scope);
      } else if (spec.isPhase) {
        const coreMat = new THREE.MeshStandardMaterial({
          color: 0x6366f1,
          emissive: 0x818cf8,
          emissiveIntensity: 1.8,
        });
        const coilA = new THREE.Mesh(new THREE.TorusGeometry(0.042, 0.01, 8, 16), coreMat);
        coilA.position.set(0, slide.position.y, -0.32);
        const coilB = coilA.clone();
        coilB.position.z = -0.41;
        g.add(coilA, coilB);
      } else {
        const rearSight = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.014, 0.014), this.mats.gunMetal);
        rearSight.position.set(0, slideTopY + 0.006, -spec.len * 0.02);
        const frontPost = new THREE.Mesh(new THREE.BoxGeometry(0.007, 0.015, 0.012), this.mats.gunMetal);
        frontPost.position.set(0, slideTopY + 0.006, -spec.len * 0.50);
        g.add(rearSight, frontPost);
      }

      // Overclock emissive rail
      const ocAccent = new THREE.Mesh(
        new THREE.BoxGeometry(spec.width + 0.005, 0.01, spec.len * 0.42),
        accentMat,
      );
      ocAccent.name = 'overclock_accent';
      ocAccent.position.set(0, slideTopY + 0.002, -spec.len * 0.24);
      ocAccent.visible = false;
      g.add(ocAccent);

      // Right forearm & gloved hand
      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.072, 0.072, 0.28), sleeveMat);
      arm.position.set(0.045, -0.105, 0.14);
      arm.rotation.set(-0.2, -0.2, 0);
      g.add(arm);

      const hand = new THREE.Mesh(new THREE.BoxGeometry(0.062, 0.062, 0.08), gloveMat);
      hand.position.set(0, -0.072, -0.015);
      g.add(hand);

      // Muzzle flash sprite
      const mfMat = new THREE.SpriteMaterial({
        map: this.mats.muzzleFlashTex,
        color: spec.isPhase ? 0x818cf8 : 0xffd28a,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });
      const mf = new THREE.Sprite(mfMat);
      mf.position.set(0, slide.position.y, -spec.len * 0.88);
      mf.scale.set(0.24, 0.24, 0.24);
      g.add(mf);

      this.muzzleSprites.set(id, mf);
      this.weaponModels.set(id, g);
      this.weaponPivot.add(g);
    });

    // Melee knife viewmodel
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.016, 0.04, 0.24), this.mats.gunMetal);
    blade.position.set(0, 0, -0.15);
    const kHandle = new THREE.Mesh(new THREE.BoxGeometry(0.028, 0.032, 0.11), this.mats.gunPolymer);
    kHandle.position.set(0, 0, 0.02);
    this.knifeGroup.add(blade, kHandle);
    this.knifeGroup.visible = false;
    this.viewmodelRoot.add(this.knifeGroup);

    // Perk drink bottle viewmodel
    const glass = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.036, 0.18, 12), this.bottleLiquidMat);
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.026, 0.06, 10), this.bottleLiquidMat);
    neck.position.y = 0.12;
    this.bottleGroup.add(glass, neck);
    this.bottleGroup.position.set(0.05, -0.18, -0.35);
    this.bottleGroup.visible = false;
    this.viewmodelRoot.add(this.bottleGroup);
  }

  private allocatePools(): void {
    // 2 pooled dynamic muzzle lights
    for (let i = 0; i < BALANCE.perf.maxDynamicMuzzleLights; i++) {
      const light = new THREE.PointLight(0xffb454, 0, 9, 2);
      this.scene.add(light);
      this.muzzleLights.push({ light, timer: 0 });
    }

    // Pooled impact & blood particles
    const pGeo = new THREE.BoxGeometry(0.055, 0.055, 0.055);
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
        life: 0,
        maxLife: 0.5,
        gravity: 9.8,
        active: false,
      });
    }

    // Pooled tracers
    const tGeo = new THREE.BoxGeometry(0.02, 0.02, 1);
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

    // Pooled decals (bullet holes & blood)
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

    // Phase Cannon energy bolts (1 shared light avoids compiling 8 lights into every shader)
    this.phaseLight = new THREE.PointLight(0x818cf8, 0, 7, 1.8);
    this.scene.add(this.phaseLight);
    const boltGeo = new THREE.SphereGeometry(0.14, 10, 10);
    for (let i = 0; i < 8; i++) {
      const mat = new THREE.MeshBasicMaterial({ color: 0x818cf8 });
      const mesh = new THREE.Mesh(boltGeo, mat);
      mesh.visible = false;
      this.scene.add(mesh);
      this.phaseBolts.push({
        mesh,
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
    callbacks: ShotCallbacks,
  ): void {
    this.fireCooldown = Math.max(0, this.fireCooldown - dt);
    this.swapTimer = Math.max(0, this.swapTimer - dt);
    this.muzzleFlashTimer = Math.max(0, this.muzzleFlashTimer - dt);

    for (const ml of this.muzzleLights) {
      if (ml.timer > 0) {
        ml.timer -= dt;
        if (ml.timer <= 0) ml.light.intensity = 0;
      }
    }

    if (!input.fireHeld) {
      this.semiTriggerConsumed = false;
    }

    const active = this.getActiveWeapon();
    const cfg = BALANCE.weapons[active.id];

    // Swap weapon
    if (input.swapPressed && this.slots.length > 1 && this.swapTimer <= 0 && !player.isReviving) {
      this.activeSlot = (this.activeSlot + 1) % this.slots.length;
      this.isReloading = false;
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
      player.knifeAnimTimer = 0.28;
      this.isReloading = false;
      this.audio.playMeleeSwing();

      player.getEyePosition(this.tmpOrigin);
      this.camera.getWorldDirection(this.tmpDir);
      const hit = this.zombies.raycastShot(this.tmpOrigin, this.tmpDir, BALANCE.player.knifeRange);
      if (hit) {
        const dmg = BALANCE.player.knifeDamageBase;
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

    // Throw frag grenade
    if (input.grenadePressed && player.grenades > 0 && !player.isReviving) {
      player.grenades--;
      player.getEyePosition(this.tmpOrigin);
      this.camera.getWorldDirection(this.tmpDir);
      const spawnP = this.tmpOrigin.clone().addScaledVector(this.tmpDir, 0.55);
      const vx = this.tmpDir.x * BALANCE.player.grenadeThrowSpeed;
      const vy = this.tmpDir.y * BALANCE.player.grenadeThrowSpeed + 3.5;
      const vz = this.tmpDir.z * BALANCE.player.grenadeThrowSpeed;
      const rb = this.physics.spawnGrenadeBody(spawnP.x, spawnP.y, spawnP.z, vx, vy, vz);
      const mesh = new THREE.Mesh(
        new THREE.SphereGeometry(0.11, 8, 8),
        new THREE.MeshStandardMaterial({ color: 0x3f4a3c, roughness: 0.6, metalness: 0.4 }),
      );
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
    this.recoilOffsetZ = Math.min(0.085, this.recoilOffsetZ + 0.055);
    this.recoilOffsetPitch = Math.min(0.25, this.recoilOffsetPitch + 0.12);
    this.muzzleFlashTimer = 0.055;

    // Pooled dynamic muzzle light (max 2)
    const ml = this.muzzleLights[this.muzzleLightCursor]!;
    this.muzzleLightCursor = (this.muzzleLightCursor + 1) % this.muzzleLights.length;
    player.getEyePosition(this.tmpOrigin);
    this.camera.getWorldDirection(this.tmpDir);
    ml.light.position.copy(this.tmpOrigin).addScaledVector(this.tmpDir, 0.75);
    ml.light.color.setHex(active.id === 'phase_cannon' ? 0x818cf8 : 0xffb85c);
    ml.light.intensity = 3.2;
    ml.timer = 0.05;

    // Brass shell ejection particle
    if (active.id !== 'phase_cannon') {
      const right = new THREE.Vector3(1, 0, 0).applyQuaternion(this.camera.quaternion);
      const ejectPos = this.tmpOrigin.clone().addScaledVector(this.tmpDir, 0.4).addScaledVector(right, 0.22);
      this.spawnSingleParticle(
        ejectPos,
        right.x * 2.2 + (Math.random() - 0.5) * 0.5,
        1.8 + Math.random() * 0.6,
        right.z * 2.2 + (Math.random() - 0.5) * 0.5,
        0xd9a441,
        0.55,
      );
    }

    // Phase Cannon fires slow energy bolt
    if (cfg.fireMode === 'projectile') {
      const bolt = this.phaseBolts.find((b) => !b.active);
      if (bolt) {
        bolt.active = true;
        bolt.life = 4.0;
        bolt.upgraded = active.upgraded;
        bolt.pos.copy(this.tmpOrigin).addScaledVector(this.tmpDir, 0.6);
        bolt.vel.copy(this.tmpDir).multiplyScalar(cfg.projectileSpeed);
        bolt.mesh.position.copy(bolt.pos);
        bolt.mesh.visible = true;
        this.phaseLight.position.copy(bolt.pos);
        this.phaseLight.intensity = 2.8;
      }
      callbacks.onShotStats(true, false);
      return;
    }

    // Hitscan pellets (BVH world + Zombie hitboxes)
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
      const shotDir = this.tmpDir.clone();
      shotDir.x += sx;
      shotDir.y += sy;
      shotDir.z += (Math.random() - 0.5) * spread * 0.5;
      shotDir.normalize();

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

        this.spawnParticles(zHit.point, 0x8b1111, 7, 2.8);
        if (zHit.hitZone === 'head') anyHeadshot = true;

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

    // Wall-clip prevention raycast (pushback if barrel touches a wall)
    player.getEyePosition(this.tmpOrigin);
    this.camera.getWorldDirection(this.tmpDir);
    const wallCheck = this.bvh.raycast(this.tmpOrigin, this.tmpDir, 0.85);
    const wallPushback = wallCheck ? Math.max(0, 0.85 - wallCheck.distance) * 0.45 : 0;

    // Perk drink animation
    if (player.drinkAnimTimer > 0) {
      this.weaponPivot.visible = false;
      this.knifeGroup.visible = false;
      this.bottleGroup.visible = true;
      this.bottleLiquidMat.color.setHex(player.drinkPerkColor);
      this.bottleLiquidMat.emissive.setHex(player.drinkPerkColor);
      const t = 1 - player.drinkAnimTimer / BALANCE.perks.drinkDuration;
      this.bottleGroup.position.set(
        THREE.MathUtils.lerp(0.18, 0.0, Math.sin(t * Math.PI)),
        THREE.MathUtils.lerp(-0.22, -0.05, Math.sin(t * Math.PI)),
        -0.34,
      );
      this.bottleGroup.rotation.x = Math.sin(t * Math.PI) * 1.1;
      return;
    }

    this.bottleGroup.visible = false;

    // Melee knife animation
    if (player.knifeAnimTimer > 0) {
      this.weaponPivot.visible = false;
      this.knifeGroup.visible = true;
      const t = 1 - player.knifeAnimTimer / 0.28;
      this.knifeGroup.position.set(
        THREE.MathUtils.lerp(0.24, -0.18, t),
        -0.14,
        -0.38 - Math.sin(t * Math.PI) * 0.22,
      );
      this.knifeGroup.rotation.set(0.15, THREE.MathUtils.lerp(-0.4, 0.9, t), -0.4);
      return;
    }

    this.knifeGroup.visible = false;
    this.weaponPivot.visible = true;

    const adsAlpha = player.isAds ? 1 : 0;
    const targetX = THREE.MathUtils.lerp(0.21, 0.0, adsAlpha);
    const targetY = THREE.MathUtils.lerp(-0.18, -0.115, adsAlpha);
    const targetZ = THREE.MathUtils.lerp(-0.34, -0.26, adsAlpha) + this.recoilOffsetZ + wallPushback;

    const moveAmt = Math.min(1, Math.hypot(player.velocity.x, player.velocity.z) / 5);
    const swaySpeed = player.isSprinting ? 11 : 6;
    const tNow = performance.now() * 0.001;
    this.swayX = Math.cos(tNow * swaySpeed) * 0.009 * moveAmt * (1 - adsAlpha * 0.7);
    this.swayY = Math.abs(Math.sin(tNow * swaySpeed)) * 0.008 * moveAmt * (1 - adsAlpha * 0.7);

    const reloadTilt = this.isReloading
      ? Math.sin((this.reloadTimer / this.reloadDuration) * Math.PI) * 0.45
      : 0;
    const sprintTilt = player.isSprinting ? -0.35 : 0;
    const swapDrop = this.swapTimer > 0 ? -(this.swapTimer / Math.max(0.1, cfg.swapTime)) * 0.16 : 0;

    this.weaponPivot.position.set(
      THREE.MathUtils.damp(this.weaponPivot.position.x, targetX + this.swayX, 18, dt),
      THREE.MathUtils.damp(this.weaponPivot.position.y, targetY - this.swayY + swapDrop - reloadTilt * 0.18, 18, dt),
      THREE.MathUtils.damp(this.weaponPivot.position.z, targetZ, 18, dt),
    );
    this.weaponPivot.rotation.set(
      this.recoilOffsetPitch - reloadTilt * 0.6 + sprintTilt * 0.2,
      sprintTilt * -0.8,
      reloadTilt * 0.45,
    );

    const mf = this.muzzleSprites.get(this.getActiveWeapon().id);
    if (mf) {
      const mat = mf.material as THREE.SpriteMaterial;
      mat.opacity = this.muzzleFlashTimer > 0 ? 0.95 : 0;
      mat.rotation = Math.random() * Math.PI * 2;
    }
  }

  private updateParticlesAndProjectiles(
    dt: number,
    instaKill: boolean,
    callbacks: ShotCallbacks,
  ): void {
    for (const p of this.particles) {
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
      if (p.mesh.position.y < 0.03) {
        p.mesh.position.y = 0.03;
        p.vy = -p.vy * 0.35;
        p.vx *= 0.65;
        p.vz *= 0.65;
      }
      (p.mesh.material as THREE.MeshBasicMaterial).opacity = Math.max(0, p.life / p.maxLife);
    }

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

    // Phase Cannon bolts
    let activeBoltPos: THREE.Vector3 | null = null;
    for (const b of this.phaseBolts) {
      if (!b.active) continue;
      b.life -= dt;
      const stepDist = b.vel.length() * dt;
      const dir = this.tmpVec.copy(b.vel).normalize();
      const zHit = this.zombies.raycastShot(b.pos, dir, stepDist + 0.35);
      const wHit = this.bvh.raycast(b.pos, dir, stepDist + 0.25);

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
    p.mesh.position.copy(origin);
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

  public spawnDecal(point: THREE.Vector3, normal: THREE.Vector3, kind: 'bullet' | 'blood'): void {
    const decal = this.decals[this.decalCursor]!;
    this.decalCursor = (this.decalCursor + 1) % this.decals.length;
    const mat = decal.material as THREE.MeshBasicMaterial;
    mat.map = kind === 'blood' ? this.mats.bloodSplatterTex : this.mats.bulletHoleTex;
    mat.needsUpdate = true;

    const scale = kind === 'blood' ? 1.8 + Math.random() * 1.4 : 0.45 + Math.random() * 0.25;
    decal.scale.set(scale, scale, 1);
    decal.position.copy(point).addScaledVector(normal, 0.025);
    decal.lookAt(point.clone().add(normal));
    decal.rotateZ(Math.random() * Math.PI * 2);
    decal.visible = true;
  }
}
