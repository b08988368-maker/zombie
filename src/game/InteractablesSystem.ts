import * as THREE from 'three';
import {
  BALANCE,
  type EnemyType,
  type PerkId,
  type PowerUpId,
  type WeaponId,
  type ZoneId,
} from '../config/balance';
import type { AudioEngine } from '../engine/AudioEngine';
import type { BvhWorld } from '../engine/BvhWorld';
import type { NavGrid } from '../engine/NavGrid';
import type { PhysicsWorld } from '../engine/PhysicsWorld';
import type {
  CrateSlot,
  DoorObject,
  MapBuildResult,
  WallBuyObject,
  WindowBarricade,
} from './MapBuilder';
import type { PlayerController } from './PlayerController';
import type { ActivePowerUpState, InteractPrompt, SeededRng } from './types';
import type { WeaponSystem } from './WeaponSystem';
import type { ZombieSystem } from './ZombieSystem';

interface DroppedPowerUp {
  id: PowerUpId;
  mesh: THREE.Group;
  color: number;
  x: number;
  y: number;
  z: number;
  life: number;
}

const POWERUP_META: Record<PowerUpId, { label: string; color: number }> = {
  max_ammo: { label: 'MAX AMMO', color: 0x22c55e },
  insta_kill: { label: 'INSTA-KILL', color: 0xef4444 },
  double_points: { label: 'DOUBLE POINTS', color: 0xfacc15 },
  nuke: { label: 'NUKE', color: 0xf97316 },
  carpenter: { label: 'CARPENTER', color: 0x38bdf8 },
  fire_sale: { label: 'FIRE SALE', color: 0xc084fc },
};

export class InteractablesSystem {
  public powerOn = false;
  public readonly perks = new Set<PerkId>();
  public readonly unlockedZones = new Set<ZoneId>(['farmhouse']);
  public readonly windowsById = new Map<string, WindowBarricade>();

  // Crate state
  private activeCrateSlotIdx = 0;
  private crateUsesLeft = 6;
  private crateState: 'idle' | 'rolling' | 'ready' | 'relocating' = 'idle';
  private crateTimer = 0;
  private crateOfferedWeapon: WeaponId = 'longbow';
  private cratePreviewMesh: THREE.Mesh;

  // Overclock Bench state
  private overclockState: 'idle' | 'processing' = 'idle';
  private overclockTimer = 0;
  private overclockTargetSlot = 0;

  // Electric trap state
  private trapState: 'ready' | 'active' | 'cooldown' = 'ready';
  private trapTimer = 0;
  private trapDamageTick = 0;

  // Power-ups state
  private readonly droppedPowerUps: DroppedPowerUp[] = [];
  private readonly powerUpLight: THREE.PointLight;
  private readonly activePowerUps = new Map<PowerUpId, number>();
  private readonly powerUpTypeCooldowns = new Map<PowerUpId, number>();
  private killsSinceLastDrop = 0;
  private dropsThisRound = 0;
  private totalDropsEver = 0;

  // Easter egg state
  public easterEggStep = 0; // 0=need power, 1=find fuses, 2=activate radio, 3=defending, 4=done
  public fusesCollected = 0;
  public radioDefendTimer = 0;
  private eeDefenseSpawnTimer = 0;

  private interactHoldTimer = 0;
  private lastPromptId = '';

  private readonly scene: THREE.Scene;
  private readonly map: MapBuildResult;
  private readonly physics: PhysicsWorld;
  private readonly bvh: BvhWorld;
  private readonly nav: NavGrid;
  private readonly audio: AudioEngine;
  private readonly rng: SeededRng;

  constructor(
    scene: THREE.Scene,
    map: MapBuildResult,
    physics: PhysicsWorld,
    bvh: BvhWorld,
    nav: NavGrid,
    audio: AudioEngine,
    rng: SeededRng,
  ) {
    this.scene = scene;
    this.map = map;
    this.physics = physics;
    this.bvh = bvh;
    this.nav = nav;
    this.audio = audio;
    this.rng = rng;

    for (const w of map.windows) {
      this.windowsById.set(w.id, w);
    }

    this.cratePreviewMesh = new THREE.Mesh(
      new THREE.BoxGeometry(0.9, 0.22, 0.22),
      new THREE.MeshStandardMaterial({
        color: 0xfbbf24,
        emissive: 0xd97706,
        emissiveIntensity: 0.9,
        roughness: 0.3,
      }),
    );
    this.cratePreviewMesh.visible = false;
    this.scene.add(this.cratePreviewMesh);

    this.powerUpLight = new THREE.PointLight(0x22c55e, 0, 6, 1.8);
    this.scene.add(this.powerUpLight);

    this.crateUsesLeft = rng.int(
      BALANCE.economy.crate.minUsesBeforeMove,
      BALANCE.economy.crate.maxUsesBeforeMove,
    );
  }

  public reset(): void {
    this.powerOn = false;
    this.perks.clear();
    this.unlockedZones.clear();
    this.unlockedZones.add('farmhouse');

    for (const d of this.map.doors) {
      d.isOpen = false;
      d.mesh.visible = true;
      d.mesh.position.copy(d.center);
      this.physics.setDoorColliderEnabled(d.id, true);
      this.bvh.setDoorActive(d.id, true);
      this.nav.setDoorOpen(d.id, false);
    }

    for (const w of this.map.windows) {
      w.intactCount = BALANCE.economy.barricade.maxPlanks;
      w.planks.forEach((p) => {
        p.visible = true;
      });
    }

    for (const dp of this.droppedPowerUps) {
      this.scene.remove(dp.mesh);
    }
    this.droppedPowerUps.length = 0;
    this.powerUpLight.intensity = 0;
    this.activePowerUps.clear();
    this.powerUpTypeCooldowns.clear();
    this.killsSinceLastDrop = 0;
    this.dropsThisRound = 0;
    this.totalDropsEver = 0;

    this.activeCrateSlotIdx = 0;
    this.map.crateSlots.forEach((c, i) => {
      c.active = i === 0;
      c.group.visible = i === 0;
      c.light.intensity = i === 0 ? 1.8 : 0;
      c.lid.rotation.x = 0;
    });
    this.crateState = 'idle';
    this.cratePreviewMesh.visible = false;

    this.overclockState = 'idle';
    this.trapState = 'ready';
    this.map.electricTrapArcs.visible = false;
    this.map.electricTrapLight.intensity = 0;

    this.easterEggStep = 0;
    this.fusesCollected = 0;
    this.radioDefendTimer = 0;
    this.map.fusePickups.forEach((f) => {
      f.collected = false;
      f.mesh.visible = false;
    });
    this.map.powerLeverMesh.rotation.z = 0.55;
    this.map.powerIndicatorMat.color.setHex(0xef4444);
    this.map.powerIndicatorMat.emissive.setHex(0xef4444);
    this.map.radioScreenMat.emissive.setHex(0xef4444);

    for (const pl of this.map.poweredLights) {
      pl.intensity = 0.22;
    }
    for (const pm of this.map.perkMachines) {
      pm.light.intensity = 0.2;
      pm.emissiveMat.emissiveIntensity = 0.15;
    }
  }

  public onNewRound(): void {
    this.dropsThisRound = 0;
  }

  public isDoublePoints(): boolean {
    return (this.activePowerUps.get('double_points') ?? 0) > 0;
  }

  public isInstaKill(): boolean {
    return (this.activePowerUps.get('insta_kill') ?? 0) > 0;
  }

  public isFireSale(): boolean {
    return (this.activePowerUps.get('fire_sale') ?? 0) > 0;
  }

  public getActivePowerUpList(): ActivePowerUpState[] {
    const out: ActivePowerUpState[] = [];
    for (const [id, rem] of this.activePowerUps) {
      if (rem > 0) {
        out.push({
          id,
          label: POWERUP_META[id].label,
          remaining: rem,
          duration: BALANCE.powerUps.activeDuration,
        });
      }
    }
    return out;
  }

  public trySpawnPowerUp(
    x: number,
    y: number,
    z: number,
    round: number,
    forceType?: PowerUpId,
  ): void {
    if (!forceType) {
      this.killsSinceLastDrop++;
      if (this.dropsThisRound >= BALANCE.powerUps.maxDropsPerRound) return;
      if (this.killsSinceLastDrop < BALANCE.powerUps.minKillsBetweenDrops) return;

      const guaranteed =
        this.totalDropsEver === 0 && round >= BALANCE.powerUps.guaranteedDropWithinRound;
      if (!guaranteed && this.rng.next() > BALANCE.powerUps.dropChance) return;
    }

    const candidates: PowerUpId[] = ['max_ammo', 'insta_kill', 'double_points', 'nuke', 'carpenter', 'fire_sale'];
    const available = candidates.filter((id) => (this.powerUpTypeCooldowns.get(id) ?? 0) <= 0);
    const chosen =
      forceType ??
      (available.length > 0
        ? available[this.rng.int(0, available.length - 1)]!
        : candidates[this.rng.int(0, candidates.length - 1)]!);

    this.killsSinceLastDrop = 0;
    this.dropsThisRound++;
    this.totalDropsEver++;
    this.powerUpTypeCooldowns.set(chosen, BALANCE.powerUps.perTypeCooldown);

    const meta = POWERUP_META[chosen];
    const group = new THREE.Group();
    group.position.set(x, y + 0.65, z);

    const core = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.28, 0),
      new THREE.MeshStandardMaterial({
        color: meta.color,
        emissive: meta.color,
        emissiveIntensity: 1.6,
        roughness: 0.25,
      }),
    );
    group.add(core);
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(0.42, 0.035, 8, 20),
      new THREE.MeshBasicMaterial({ color: meta.color }),
    );
    group.add(ring);

    this.scene.add(group);
    this.droppedPowerUps.push({
      id: chosen,
      mesh: group,
      color: meta.color,
      x,
      y: y + 0.65,
      z,
      life: BALANCE.powerUps.lifetime,
    });
  }

  public update(
    dt: number,
    player: PlayerController,
    weapons: WeaponSystem,
    zombies: ZombieSystem,
    points: number,
    round: number,
    interactHeld: boolean,
    onSpendPoints: (cost: number) => void,
    onEarnPoints: (amt: number, reason: string) => void,
    onRadioMessage: (msg: string) => void,
    onDoorOpened: () => void,
    onPerkBought: () => void,
    onKillEnemy: (
      type: EnemyType,
      x: number,
      y: number,
      z: number,
    ) => void,
  ): InteractPrompt | null {
    // Tick active power-up timers & cooldowns
    for (const [id, rem] of this.activePowerUps) {
      const next = rem - dt;
      if (next <= 0) {
        this.activePowerUps.delete(id);
        if (id === 'fire_sale') {
          this.syncCrateVisibility();
        }
      } else {
        this.activePowerUps.set(id, next);
      }
    }
    for (const [id, cd] of this.powerUpTypeCooldowns) {
      if (cd - dt <= 0) this.powerUpTypeCooldowns.delete(id);
      else this.powerUpTypeCooldowns.set(id, cd - dt);
    }

    // Update dropped power-up pickups
    for (let i = this.droppedPowerUps.length - 1; i >= 0; i--) {
      const dp = this.droppedPowerUps[i]!;
      dp.life -= dt;
      dp.mesh.rotation.y += dt * 2.2;
      dp.mesh.position.y = dp.y + Math.sin(performance.now() * 0.004) * 0.12;
      if (dp.life <= BALANCE.powerUps.blinkWarningSeconds) {
        dp.mesh.visible = Math.floor(dp.life * 8) % 2 === 0;
      }
      const distSq =
        (dp.x - player.position.x) ** 2 + (dp.z - player.position.z) ** 2;
      if (distSq <= BALANCE.powerUps.pickupRadius ** 2) {
        this.collectPowerUp(dp.id, player, weapons, zombies, onEarnPoints, onRadioMessage, onKillEnemy);
        this.scene.remove(dp.mesh);
        this.droppedPowerUps.splice(i, 1);
      } else if (dp.life <= 0) {
        this.scene.remove(dp.mesh);
        this.droppedPowerUps.splice(i, 1);
      }
    }
    if (this.droppedPowerUps.length > 0) {
      const first = this.droppedPowerUps[0]!;
      this.powerUpLight.position.copy(first.mesh.position);
      this.powerUpLight.color.setHex(first.color);
      this.powerUpLight.intensity = 1.8;
    } else {
      this.powerUpLight.intensity = 0;
    }

    // Update Supply Crate animation/timer
    const activeCrate = this.map.crateSlots[this.activeCrateSlotIdx]!;
    if (this.crateState === 'rolling') {
      this.crateTimer -= dt;
      activeCrate.lid.rotation.x = THREE.MathUtils.damp(activeCrate.lid.rotation.x, -1.25, 10, dt);
      this.cratePreviewMesh.visible = true;
      this.cratePreviewMesh.position.set(
        activeCrate.position.x,
        1.15 + Math.sin(performance.now() * 0.01) * 0.08,
        activeCrate.position.z,
      );
      this.cratePreviewMesh.rotation.y += dt * 7;
      if (this.crateTimer <= 0) {
        this.crateState = 'ready';
        this.crateTimer = BALANCE.economy.crate.takeWindow;
      }
    } else if (this.crateState === 'ready') {
      this.crateTimer -= dt;
      this.cratePreviewMesh.rotation.y += dt * 1.5;
      if (this.crateTimer <= 0) {
        this.crateState = 'idle';
        this.cratePreviewMesh.visible = false;
        activeCrate.lid.rotation.x = 0;
      }
    } else {
      activeCrate.lid.rotation.x = THREE.MathUtils.damp(activeCrate.lid.rotation.x, 0, 8, dt);
    }

    // Update Overclock Bench
    if (this.overclockState === 'processing') {
      this.overclockTimer -= dt;
      this.map.overclockRotor.rotation.y += dt * 10;
      if (this.overclockTimer <= 0) {
        this.overclockState = 'idle';
        weapons.activeSlot = this.overclockTargetSlot;
        weapons.upgradeActiveWeapon();
        this.audio.playPowerUp('max_ammo');
        onRadioMessage('Overclock Bench: Weapon capacitor fused. Output increased.');
      }
    } else if (this.powerOn) {
      this.map.overclockRotor.rotation.y += dt * 1.4;
    }

    // Update Electric Trap
    if (this.trapState === 'active') {
      this.trapTimer -= dt;
      this.trapDamageTick -= dt;
      this.map.electricTrapArcs.visible = Math.random() > 0.15;
      this.map.electricTrapLight.intensity = 2.4 + Math.random() * 1.6;
      if (this.trapDamageTick <= 0) {
        this.trapDamageTick = 0.25;
        const c = this.map.electricTrapCenter;
        zombies.applySplashDamage(
          c.x,
          1.0,
          c.z,
          BALANCE.economy.electricTrap.radius,
          BALANCE.economy.electricTrap.damagePerSecond * 0.25,
          BALANCE.economy.electricTrap.damagePerSecond * 0.25,
          false,
          (ent) => {
            onEarnPoints(BALANCE.economy.bodyKillPoints, 'Electric Trap');
            onKillEnemy(ent.type, ent.x, ent.y + 1, ent.z);
          },
        );
      }
      if (this.trapTimer <= 0) {
        this.trapState = 'cooldown';
        this.trapTimer = BALANCE.economy.electricTrap.cooldown;
        this.map.electricTrapArcs.visible = false;
        this.map.electricTrapLight.intensity = 0;
      }
    } else if (this.trapState === 'cooldown') {
      this.trapTimer -= dt;
      if (this.trapTimer <= 0) {
        this.trapState = 'ready';
      }
    }

    // Easter egg step 3 defense timer
    if (this.easterEggStep === 3) {
      this.radioDefendTimer -= dt;
      this.eeDefenseSpawnTimer -= dt;
      if (this.eeDefenseSpawnTimer <= 0) {
        this.eeDefenseSpawnTimer = 2.5;
        const labSpawn = this.map.spawnPoints.find((s) => s.zone === 'lab_wing');
        if (labSpawn && zombies.getAliveCount() < BALANCE.rounds.maxAlive) {
          zombies.spawnEnemy('shambler', Math.max(round, 6), labSpawn, this.rng);
        }
      }
      if (this.radioDefendTimer <= 0) {
        this.easterEggStep = 4;
        this.map.radioScreenMat.emissive.setHex(0x22c55e);
        onEarnPoints(BALANCE.easterEgg.rewardPoints, 'Broadcast Complete');
        weapons.refillAllAmmo();
        player.grenades = BALANCE.player.grenadesMax;
        this.audio.playPowerUp('max_ammo');
        onRadioMessage('Emergency Broadcast Transmitted: Rescue telemetry logged. (+5000 PTS & Max Ammo)');
      }
    }

    // Find closest interactable prompt
    const prompt = this.findNearestPrompt(player, weapons, points);
    if (!prompt) {
      this.interactHoldTimer = 0;
      this.lastPromptId = '';
      return null;
    }

    if (prompt.id !== this.lastPromptId) {
      this.interactHoldTimer = 0;
      this.lastPromptId = prompt.id;
    }

    if (interactHeld) {
      if (prompt.blockedReason) {
        if (this.interactHoldTimer === 0) {
          this.audio.playBuy(false);
        }
        this.interactHoldTimer = 0.01;
        return prompt;
      }
      if (!prompt.canAfford) {
        if (this.interactHoldTimer === 0) {
          this.audio.playBuy(false);
        }
        this.interactHoldTimer = 0.01;
        return prompt;
      }

      this.interactHoldTimer += dt;
      prompt.progress = Math.min(1, this.interactHoldTimer / BALANCE.player.interactHoldTime);
      if (this.interactHoldTimer >= BALANCE.player.interactHoldTime) {
        this.interactHoldTimer = 0;
        this.executeInteraction(
          prompt.id,
          player,
          weapons,
          onSpendPoints,
          onEarnPoints,
          onRadioMessage,
          onDoorOpened,
          onPerkBought,
        );
      }
    } else {
      this.interactHoldTimer = 0;
    }

    return prompt;
  }

  private collectPowerUp(
    id: PowerUpId,
    player: PlayerController,
    weapons: WeaponSystem,
    zombies: ZombieSystem,
    onEarnPoints: (amt: number, reason: string) => void,
    onRadioMessage: (msg: string) => void,
    onKillEnemy: (type: EnemyType, x: number, y: number, z: number) => void,
  ): void {
    this.audio.playPowerUp(id);
    if (id === 'max_ammo') {
      weapons.refillAllAmmo();
      player.grenades = BALANCE.player.grenadesMax;
      onRadioMessage('Max Ammo — Weapons & Grenades Restocked');
    } else if (id === 'insta_kill') {
      this.activePowerUps.set('insta_kill', BALANCE.powerUps.activeDuration);
    } else if (id === 'double_points') {
      this.activePowerUps.set('double_points', BALANCE.powerUps.activeDuration);
    } else if (id === 'nuke') {
      player.addCameraShake(0.09);
      this.audio.playExplosion(player.position.x, 1, player.position.z);
      zombies.killAllNonBoss((ent) => {
        onKillEnemy(ent.type, ent.x, ent.y + 1, ent.z);
      });
      onEarnPoints(BALANCE.economy.nukePoints, 'Nuke');
    } else if (id === 'carpenter') {
      for (const w of this.map.windows) {
        w.intactCount = BALANCE.economy.barricade.maxPlanks;
        w.planks.forEach((p) => {
          p.visible = true;
        });
      }
      onEarnPoints(BALANCE.economy.carpenterPoints, 'Carpenter');
    } else if (id === 'fire_sale') {
      this.activePowerUps.set('fire_sale', BALANCE.powerUps.activeDuration);
      this.syncCrateVisibility();
    }
  }

  private syncCrateVisibility(): void {
    const fireSale = this.isFireSale();
    this.map.crateSlots.forEach((slot, idx) => {
      const visible = fireSale || idx === this.activeCrateSlotIdx;
      slot.active = visible;
      slot.group.visible = visible;
      slot.light.intensity = visible ? 1.8 : 0;
    });
  }

  private findNearestPrompt(
    player: PlayerController,
    weapons: WeaponSystem,
    points: number,
  ): InteractPrompt | null {
    const px = player.position.x;
    const pz = player.position.z;
    const rMax = BALANCE.player.interactRange;
    let bestDist: number = rMax;
    let best: InteractPrompt | null = null;

    // Doors
    for (const d of this.map.doors) {
      if (d.isOpen) continue;
      const dist = Math.hypot(d.center.x - px, d.center.z - pz);
      if (dist < bestDist) {
        bestDist = dist;
        best = {
          id: `door:${d.id}`,
          title: d.label,
          subtitle: 'Hold F to unlock sector',
          cost: d.cost,
          canAfford: points >= d.cost,
          progress: 0,
        };
      }
    }

    // Power Switch
    if (!this.powerOn) {
      const ps = this.map.powerSwitchPos;
      const dist = Math.hypot(ps.x - px, ps.z - pz);
      if (dist < bestDist) {
        bestDist = dist;
        best = {
          id: 'power_switch',
          title: 'Station Main Power Switch',
          subtitle: 'Hold F to restore grid power',
          cost: null,
          canAfford: true,
          progress: 0,
        };
      }
    }

    // Windows (repair)
    for (const w of this.map.windows) {
      if (w.intactCount >= BALANCE.economy.barricade.maxPlanks) continue;
      const dist = Math.hypot(w.center.x - px, w.center.z - pz);
      if (dist < bestDist) {
        bestDist = dist;
        best = {
          id: `window:${w.id}`,
          title: 'Repair Barricade Plank',
          subtitle: `+${BALANCE.economy.plankRebuildPoints} PTS per plank (${w.intactCount}/6)`,
          cost: null,
          canAfford: true,
          progress: 0,
        };
      }
    }

    // Wall buys
    for (const wb of this.map.wallBuys) {
      const dist = Math.hypot(wb.position.x - px, wb.position.z - pz);
      if (dist < bestDist) {
        bestDist = dist;
        const owned = weapons.hasWeapon(wb.weaponId);
        const cost = owned ? wb.ammoCost : wb.cost;
        const cfg = BALANCE.weapons[wb.weaponId];
        best = {
          id: `wall:${wb.weaponId}`,
          title: owned ? `${cfg.name} Ammo Refill` : `Buy ${cfg.name}`,
          subtitle: owned ? 'Refill reserve ammunition' : cfg.role,
          cost,
          canAfford: points >= cost,
          progress: 0,
        };
      }
    }

    // Supply Crate
    for (const cs of this.map.crateSlots) {
      if (!cs.active) continue;
      const dist = Math.hypot(cs.position.x - px, cs.position.z - pz);
      if (dist < bestDist) {
        bestDist = dist;
        if (this.crateState === 'ready' && cs.index === this.activeCrateSlotIdx) {
          const cfg = BALANCE.weapons[this.crateOfferedWeapon];
          best = {
            id: `crate_take:${cs.index}`,
            title: `Take ${cfg.name}`,
            subtitle: `${cfg.role} · ${Math.ceil(this.crateTimer)}s`,
            cost: null,
            canAfford: true,
            progress: 0,
          };
        } else if (this.crateState === 'idle') {
          const cost = this.isFireSale()
            ? BALANCE.economy.crate.fireSaleCost
            : BALANCE.economy.crate.cost;
          best = {
            id: `crate_roll:${cs.index}`,
            title: 'Supply Crate',
            subtitle: this.isFireSale() ? 'FIRE SALE ACTIVE' : 'Roll random field weapon',
            cost,
            canAfford: points >= cost,
            progress: 0,
          };
        }
      }
    }

    // Perk machines
    for (const pm of this.map.perkMachines) {
      const dist = Math.hypot(pm.position.x - px, pm.position.z - pz);
      if (dist < bestDist) {
        bestDist = dist;
        const cfg = BALANCE.perks.list[pm.id];
        const owned = this.perks.has(pm.id);
        const full = this.perks.size >= BALANCE.perks.maxPerks;
        best = {
          id: `perk:${pm.id}`,
          title: cfg.name,
          subtitle: cfg.shortDesc,
          cost: owned ? null : cfg.price,
          canAfford: !owned && !full && this.powerOn && points >= cfg.price,
          progress: 0,
          blockedReason: !this.powerOn
            ? 'Requires Station Power'
            : owned
              ? 'Already Equipped'
              : full
                ? 'Max 4 Perks Carried'
                : undefined,
        };
      }
    }

    // Overclock Bench
    {
      const oc = this.map.overclockPos;
      const dist = Math.hypot(oc.x - px, oc.z - pz);
      if (dist < bestDist) {
        bestDist = dist;
        const active = weapons.getActiveWeapon();
        const cost = BALANCE.overclock.price;
        best = {
          id: 'overclock',
          title: `Overclock Bench (${active.name})`,
          subtitle: '×2.5 Damage · +50% Mag · Faster Reload',
          cost,
          canAfford:
            this.powerOn &&
            this.overclockState === 'idle' &&
            !active.upgraded &&
            points >= cost,
          progress: 0,
          blockedReason: !this.powerOn
            ? 'Requires Station Power'
            : active.upgraded
              ? 'Weapon Already Overclocked'
              : this.overclockState === 'processing'
                ? 'Overclocking in progress...'
                : undefined,
        };
      }
    }

    // Electric Trap
    {
      const et = this.map.electricTrapPos;
      const dist = Math.hypot(et.x - px, et.z - pz);
      if (dist < bestDist) {
        bestDist = dist;
        const cost = BALANCE.economy.electricTrap.cost;
        best = {
          id: 'electric_trap',
          title: 'Yard Arc Trap',
          subtitle:
            this.trapState === 'active'
              ? `Active (${Math.ceil(this.trapTimer)}s)`
              : this.trapState === 'cooldown'
                ? `Recharging (${Math.ceil(this.trapTimer)}s)`
                : '30s High-Voltage Gate Defense',
          cost,
          canAfford: this.powerOn && this.trapState === 'ready' && points >= cost,
          progress: 0,
          blockedReason: !this.powerOn
            ? 'Requires Station Power'
            : this.trapState !== 'ready'
              ? 'Trap Unavailable'
              : undefined,
        };
      }
    }

    // Easter Egg Fuses
    if (this.powerOn && this.easterEggStep === 1) {
      for (const fp of this.map.fusePickups) {
        if (fp.collected) continue;
        const dist = Math.hypot(fp.position.x - px, fp.position.z - pz);
        if (dist < bestDist) {
          bestDist = dist;
          best = {
            id: `fuse:${fp.index}`,
            title: 'High-Voltage Relay Fuse',
            subtitle: `Collect component (${this.fusesCollected}/3)`,
            cost: null,
            canAfford: true,
            progress: 0,
          };
        }
      }
    }

    // Easter Egg Radio Console
    {
      const rc = this.map.radioConsolePos;
      const dist = Math.hypot(rc.x - px, rc.z - pz);
      if (dist < bestDist && this.powerOn && this.easterEggStep >= 1 && this.easterEggStep <= 2) {
        bestDist = dist;
        best = {
          id: 'ee_radio',
          title: 'Emergency Telemetry Radio',
          subtitle:
            this.fusesCollected < 3
              ? `Missing Fuses (${this.fusesCollected}/3)`
              : 'Hold F to transmit emergency signal',
          cost: null,
          canAfford: this.fusesCollected >= 3,
          progress: 0,
          blockedReason: this.fusesCollected < 3 ? 'Insert all 3 fuses first' : undefined,
        };
      }
    }

    return best;
  }

  private executeInteraction(
    id: string,
    player: PlayerController,
    weapons: WeaponSystem,
    onSpendPoints: (cost: number) => void,
    onEarnPoints: (amt: number, reason: string) => void,
    onRadioMessage: (msg: string) => void,
    onDoorOpened: () => void,
    onPerkBought: () => void,
  ): void {
    if (id.startsWith('door:')) {
      const doorId = id.slice(5);
      const door = this.map.doors.find((d) => d.id === doorId);
      if (!door || door.isOpen) return;
      onSpendPoints(door.cost);
      door.isOpen = true;
      door.mesh.visible = false;
      this.physics.setDoorColliderEnabled(door.id, false);
      this.bvh.setDoorActive(door.id, false);
      this.nav.setDoorOpen(door.id, true);
      for (const z of door.unlockZones) {
        this.unlockedZones.add(z);
      }
      this.audio.playBuy(true);
      onDoorOpened();
      return;
    }

    if (id === 'power_switch') {
      this.powerOn = true;
      this.map.powerLeverMesh.rotation.z = -0.55;
      this.map.powerIndicatorMat.color.setHex(0x22c55e);
      this.map.powerIndicatorMat.emissive.setHex(0x22c55e);
      for (const pl of this.map.poweredLights) {
        pl.intensity = (pl.userData.fullIntensity as number) ?? 2.6;
      }
      for (const pm of this.map.perkMachines) {
        pm.light.intensity = 1.9;
        pm.emissiveMat.emissiveIntensity = 1.65;
      }
      this.map.overclockLight.intensity = 2.0;
      this.easterEggStep = 1;
      this.map.fusePickups.forEach((f) => {
        f.mesh.visible = true;
      });
      this.audio.playPowerUp('max_ammo');
      onRadioMessage('Station Power Restored — Perks, Overclock Bench, and Telemetry Online.');
      return;
    }

    if (id.startsWith('window:')) {
      const winId = id.slice(7);
      const w = this.windowsById.get(winId);
      if (!w || w.intactCount >= BALANCE.economy.barricade.maxPlanks) return;
      const plank = w.planks[w.intactCount];
      if (plank) plank.visible = true;
      w.intactCount++;
      this.audio.playSurfaceImpact('wood', w.center.x, 1.4, w.center.z);
      onEarnPoints(BALANCE.economy.plankRebuildPoints, 'Barricade');
      return;
    }

    if (id.startsWith('wall:')) {
      const weaponId = id.slice(5) as WeaponId;
      const wb = this.map.wallBuys.find((w) => w.weaponId === weaponId);
      if (!wb) return;
      const owned = weapons.hasWeapon(weaponId);
      const cost = owned ? wb.ammoCost : wb.cost;
      onSpendPoints(cost);
      if (owned) {
        weapons.refillWeaponAmmo(weaponId);
      } else {
        weapons.giveWeapon(weaponId, false);
      }
      this.audio.playBuy(true);
      return;
    }

    if (id.startsWith('crate_roll:')) {
      const idx = Number(id.split(':')[1]);
      this.activeCrateSlotIdx = idx;
      const cost = this.isFireSale()
        ? BALANCE.economy.crate.fireSaleCost
        : BALANCE.economy.crate.cost;
      onSpendPoints(cost);
      this.audio.playCrateJingle();

      // Weighted weapon roll
      const pool = (Object.values(BALANCE.weapons) as typeof BALANCE.weapons[WeaponId][]).filter(
        (w) => w.crateWeight > 0 && !weapons.hasWeapon(w.id),
      );
      const candidates = pool.length > 0 ? pool : [BALANCE.weapons.phase_cannon, BALANCE.weapons.longbow];
      const totalWeight = candidates.reduce((acc, w) => acc + w.crateWeight, 0);
      let roll = this.rng.next() * totalWeight;
      let picked: WeaponId = candidates[0]!.id;
      for (const c of candidates) {
        roll -= c.crateWeight;
        if (roll <= 0) {
          picked = c.id;
          break;
        }
      }
      this.crateOfferedWeapon = picked;
      this.crateState = 'rolling';
      this.crateTimer = BALANCE.economy.crate.rollDuration;
      return;
    }

    if (id.startsWith('crate_take:')) {
      weapons.giveWeapon(this.crateOfferedWeapon, false);
      this.crateState = 'idle';
      this.cratePreviewMesh.visible = false;
      this.map.crateSlots[this.activeCrateSlotIdx]!.lid.rotation.x = 0;
      this.audio.playBuy(true);

      this.crateUsesLeft--;
      if (this.crateUsesLeft <= 0 && !this.isFireSale()) {
        this.activeCrateSlotIdx = (this.activeCrateSlotIdx + 1) % this.map.crateSlots.length;
        this.crateUsesLeft = this.rng.int(
          BALANCE.economy.crate.minUsesBeforeMove,
          BALANCE.economy.crate.maxUsesBeforeMove,
        );
        this.syncCrateVisibility();
        onRadioMessage('Supply Crate relocated to another sector.');
      }
      return;
    }

    if (id.startsWith('perk:')) {
      const perkId = id.slice(5) as PerkId;
      const cfg = BALANCE.perks.list[perkId];
      onSpendPoints(cfg.price);
      this.perks.add(perkId);
      player.drinkAnimTimer = BALANCE.perks.drinkDuration;
      player.drinkPerkColor = cfg.color;
      if (perkId === 'ironhide') {
        player.maxHealth = BALANCE.player.ironhideMaxHealth;
        player.health = BALANCE.player.ironhideMaxHealth;
      }
      this.audio.playPerkJingle(perkId);
      onPerkBought();
      return;
    }

    if (id === 'overclock') {
      onSpendPoints(BALANCE.overclock.price);
      this.overclockState = 'processing';
      this.overclockTimer = BALANCE.overclock.duration;
      this.overclockTargetSlot = weapons.activeSlot;
      this.audio.playBuy(true);
      onRadioMessage('Overclock Bench cycling... Stand by (6s).');
      return;
    }

    if (id === 'electric_trap') {
      onSpendPoints(BALANCE.economy.electricTrap.cost);
      this.trapState = 'active';
      this.trapTimer = BALANCE.economy.electricTrap.duration;
      this.trapDamageTick = 0;
      this.audio.playBuy(true);
      return;
    }

    if (id.startsWith('fuse:')) {
      const idx = Number(id.split(':')[1]);
      const fp = this.map.fusePickups[idx];
      if (!fp || fp.collected) return;
      fp.collected = true;
      fp.mesh.visible = false;
      this.fusesCollected++;
      this.audio.playBuy(true);
      if (this.fusesCollected >= 3) {
        this.easterEggStep = 2;
        onRadioMessage('All 3 fuses recovered. Activate the Lab Emergency Radio.');
      } else {
        onRadioMessage(`Relay Fuse collected (${this.fusesCollected}/3).`);
      }
      return;
    }

    if (id === 'ee_radio') {
      this.easterEggStep = 3;
      this.radioDefendTimer = BALANCE.easterEgg.radioDefendDuration;
      this.map.radioScreenMat.emissive.setHex(0xf59e0b);
      this.audio.playRoundStinger('special');
      onRadioMessage('Transmitting containment telemetry... Hold position for 40 seconds!');
    }
  }
}

export type { CrateSlot, DoorObject, WallBuyObject };
