export type WeaponId =
  | 'service_pistol'
  | 'hedgerow'
  | 'rattler'
  | 'ironsight'
  | 'longbow'
  | 'hammerfall'
  | 'phase_cannon';

export type PerkId =
  | 'ironhide'
  | 'second_wind'
  | 'quickhands'
  | 'twin_barrel'
  | 'marathon';

export type PowerUpId =
  | 'max_ammo'
  | 'insta_kill'
  | 'double_points'
  | 'nuke'
  | 'carpenter'
  | 'fire_sale';

export type EnemyType = 'shambler' | 'hound' | 'bloater' | 'brute';

export type ZoneId = 'farmhouse' | 'barn' | 'silo_yard' | 'lab_wing' | 'bunker';

export interface WeaponConfig {
  id: WeaponId;
  name: string;
  upgradedName: string;
  role: string;
  fireMode: 'semi' | 'auto' | 'projectile';
  damage: number;
  pellets: number;
  splashDamage: number;
  splashRadius: number;
  projectileSpeed: number;
  rpm: number;
  magSize: number;
  reserveMax: number;
  wallPrice: number;
  headshotMult: number;
  torsoMult: number;
  limbMult: number;
  spreadHip: number;
  spreadAds: number;
  recoilPitch: number;
  recoilYaw: number;
  cameraKick: number;
  adsFov: number;
  adsSensScale: number;
  reloadTime: number;
  emptyReloadTime: number;
  swapTime: number;
  hasTracer: boolean;
  tracerColor: number;
  upgradedTracerColor: number;
  falloffStart: number;
  falloffEnd: number;
  falloffMinMult: number;
  crateWeight: number;
  crateOnly: boolean;
}

export interface PerkConfig {
  id: PerkId;
  name: string;
  shortDesc: string;
  price: number;
  color: number;
  accentHex: string;
  zone: ZoneId;
}

export const BALANCE = {
  sim: {
    fixedDt: 1 / 60,
    maxFrameDt: 0.1,
    hitStopKillMs: 36,
  },

  player: {
    capsuleHeight: 1.8,
    capsuleRadius: 0.35,
    capsuleHalfHeight: 0.55,
    eyeHeight: 1.65,
    crouchEyeHeight: 1.05,
    walkSpeed: 4.6,
    sprintSpeed: 7.2,
    crouchSpeed: 2.3,
    jumpSpeed: 5.7,
    gravity: 18.0,
    groundAccel: 30.0,
    airAccel: 8.5,
    friction: 12.0,
    maxHealth: 100,
    ironhideMaxHealth: 250,
    regenDelay: 3.2,
    regenDuration: 1.6,
    hitGraceSeconds: 0.45,
    lowHealthThreshold: 40,
    defaultFov: 80,
    defaultSensitivity: 0.0022,
    knifeRange: 2.35,
    knifeDamageBase: 150,
    knifeDamagePerRoundStep: 25,
    knifeCooldown: 0.52,
    knifeLungeSpeed: 5.5,
    grenadesStart: 2,
    grenadesMax: 4,
    grenadeThrowSpeed: 18.5,
    grenadeFuse: 2.0,
    grenadeDamageInner: 480,
    grenadeDamageOuter: 175,
    grenadeRadius: 6.0,
    secondWindDuration: 2.5,
    secondWindPushRadius: 9.0,
    interactRange: 2.9,
    interactHoldTime: 0.05,
    startingPoints: 500,
  },

  weapons: {
    service_pistol: {
      id: 'service_pistol',
      name: 'Service Pistol',
      upgradedName: 'M1986 Regulator',
      role: 'Sidearm',
      fireMode: 'semi',
      damage: 50,
      pellets: 1,
      splashDamage: 0,
      splashRadius: 0,
      projectileSpeed: 0,
      rpm: 480,
      magSize: 8,
      reserveMax: 96,
      wallPrice: 0,
      headshotMult: 3.0,
      torsoMult: 1.0,
      limbMult: 0.85,
      spreadHip: 0.01,
      spreadAds: 0.0012,
      recoilPitch: 0.009,
      recoilYaw: 0.003,
      cameraKick: 0.005,
      adsFov: 66,
      adsSensScale: 0.78,
      reloadTime: 1.0,
      emptyReloadTime: 1.15,
      swapTime: 0.22,
      hasTracer: true,
      tracerColor: 0xffd27a,
      upgradedTracerColor: 0xff5a36,
      falloffStart: 28,
      falloffEnd: 55,
      falloffMinMult: 0.7,
      crateWeight: 0,
      crateOnly: false,
    },
    hedgerow: {
      id: 'hedgerow',
      name: 'Hedgerow',
      upgradedName: 'Bramble Sweeper',
      role: 'Pump Shotgun',
      fireMode: 'semi',
      damage: 36,
      pellets: 8,
      splashDamage: 0,
      splashRadius: 0,
      projectileSpeed: 0,
      rpm: 92,
      magSize: 6,
      reserveMax: 56,
      wallPrice: 500,
      headshotMult: 1.9,
      torsoMult: 1.0,
      limbMult: 0.85,
      spreadHip: 0.052,
      spreadAds: 0.028,
      recoilPitch: 0.028,
      recoilYaw: 0.008,
      cameraKick: 0.018,
      adsFov: 68,
      adsSensScale: 0.82,
      reloadTime: 1.75,
      emptyReloadTime: 2.0,
      swapTime: 0.3,
      hasTracer: true,
      tracerColor: 0xffb35c,
      upgradedTracerColor: 0x38bdf8,
      falloffStart: 15,
      falloffEnd: 32,
      falloffMinMult: 0.55,
      crateWeight: 10,
      crateOnly: false,
    },
    rattler: {
      id: 'rattler',
      name: 'Rattler',
      upgradedName: 'Viper-86 Overclock',
      role: 'SMG',
      fireMode: 'auto',
      damage: 40,
      pellets: 1,
      splashDamage: 0,
      splashRadius: 0,
      projectileSpeed: 0,
      rpm: 820,
      magSize: 32,
      reserveMax: 224,
      wallPrice: 850,
      headshotMult: 2.3,
      torsoMult: 1.0,
      limbMult: 0.85,
      spreadHip: 0.02,
      spreadAds: 0.0045,
      recoilPitch: 0.007,
      recoilYaw: 0.004,
      cameraKick: 0.005,
      adsFov: 65,
      adsSensScale: 0.78,
      reloadTime: 1.45,
      emptyReloadTime: 1.75,
      swapTime: 0.24,
      hasTracer: true,
      tracerColor: 0xffe08a,
      upgradedTracerColor: 0x22d3ee,
      falloffStart: 25,
      falloffEnd: 52,
      falloffMinMult: 0.65,
      crateWeight: 12,
      crateOnly: false,
    },
    ironsight: {
      id: 'ironsight',
      name: 'Ironsight',
      upgradedName: 'Station Carbine Mk.II',
      role: 'Assault Rifle',
      fireMode: 'auto',
      damage: 62,
      pellets: 1,
      splashDamage: 0,
      splashRadius: 0,
      projectileSpeed: 0,
      rpm: 620,
      magSize: 30,
      reserveMax: 180,
      wallPrice: 1200,
      headshotMult: 2.5,
      torsoMult: 1.0,
      limbMult: 0.85,
      spreadHip: 0.018,
      spreadAds: 0.0018,
      recoilPitch: 0.01,
      recoilYaw: 0.004,
      cameraKick: 0.007,
      adsFov: 60,
      adsSensScale: 0.74,
      reloadTime: 1.65,
      emptyReloadTime: 1.95,
      swapTime: 0.28,
      hasTracer: true,
      tracerColor: 0xffd27a,
      upgradedTracerColor: 0xf43f5e,
      falloffStart: 28,
      falloffEnd: 60,
      falloffMinMult: 0.72,
      crateWeight: 12,
      crateOnly: false,
    },
    longbow: {
      id: 'longbow',
      name: 'Longbow',
      upgradedName: 'Deadeye Harbinger',
      role: 'Marksman Rifle',
      fireMode: 'semi',
      damage: 195,
      pellets: 1,
      splashDamage: 0,
      splashRadius: 0,
      projectileSpeed: 0,
      rpm: 180,
      magSize: 10,
      reserveMax: 70,
      wallPrice: 0,
      headshotMult: 3.5,
      torsoMult: 1.0,
      limbMult: 0.85,
      spreadHip: 0.024,
      spreadAds: 0.0003,
      recoilPitch: 0.022,
      recoilYaw: 0.005,
      cameraKick: 0.015,
      adsFov: 44,
      adsSensScale: 0.62,
      reloadTime: 1.9,
      emptyReloadTime: 2.2,
      swapTime: 0.32,
      hasTracer: true,
      tracerColor: 0xffe4a3,
      upgradedTracerColor: 0xa855f7,
      falloffStart: 999,
      falloffEnd: 999,
      falloffMinMult: 1.0,
      crateWeight: 10,
      crateOnly: true,
    },
    hammerfall: {
      id: 'hammerfall',
      name: 'Hammerfall',
      upgradedName: 'Threshing Engine',
      role: 'LMG',
      fireMode: 'auto',
      damage: 68,
      pellets: 1,
      splashDamage: 0,
      splashRadius: 0,
      projectileSpeed: 0,
      rpm: 675,
      magSize: 100,
      reserveMax: 400,
      wallPrice: 0,
      headshotMult: 2.4,
      torsoMult: 1.0,
      limbMult: 0.85,
      spreadHip: 0.026,
      spreadAds: 0.0055,
      recoilPitch: 0.01,
      recoilYaw: 0.005,
      cameraKick: 0.007,
      adsFov: 62,
      adsSensScale: 0.74,
      reloadTime: 2.8,
      emptyReloadTime: 3.25,
      swapTime: 0.4,
      hasTracer: true,
      tracerColor: 0xffc864,
      upgradedTracerColor: 0x34d399,
      falloffStart: 28,
      falloffEnd: 65,
      falloffMinMult: 0.72,
      crateWeight: 9,
      crateOnly: true,
    },
    phase_cannon: {
      id: 'phase_cannon',
      name: 'Phase Cannon',
      upgradedName: 'Singularity Emitter',
      role: 'Experimental Prototype',
      fireMode: 'projectile',
      damage: 1200,
      pellets: 1,
      splashDamage: 650,
      splashRadius: 4.0,
      projectileSpeed: 46,
      rpm: 195,
      magSize: 20,
      reserveMax: 160,
      wallPrice: 0,
      headshotMult: 1.0,
      torsoMult: 1.0,
      limbMult: 1.0,
      spreadHip: 0.005,
      spreadAds: 0.001,
      recoilPitch: 0.015,
      recoilYaw: 0.003,
      cameraKick: 0.012,
      adsFov: 64,
      adsSensScale: 0.78,
      reloadTime: 2.0,
      emptyReloadTime: 2.35,
      swapTime: 0.32,
      hasTracer: true,
      tracerColor: 0x6366f1,
      upgradedTracerColor: 0xc084fc,
      falloffStart: 999,
      falloffEnd: 999,
      falloffMinMult: 1.0,
      crateWeight: 4,
      crateOnly: true,
    },
  } satisfies Record<WeaponId, WeaponConfig>,

  overclock: {
    price: 5000,
    duration: 3.0,
    damageMult: 2.5,
    magMult: 1.5,
    reloadSpeedMult: 1.5,
  },

  rounds: {
    baseHealthRound1: 150,
    healthStepEarly: 100,
    healthStepCutoffRound: 9,
    healthScaleLate: 1.1,
    healthCapRound: 100,
    healthCapEnabled: false,
    earlyCounts: [6, 8, 13, 18, 24, 27, 28, 28, 29, 33] as readonly number[],
    lateCountMultiplier: 0.15,
    lateCountBase: 24,
    maxAlive: 24,
    spawnDelayBase: 2.0,
    spawnDelayDecay: 0.95,
    spawnDelayMin: 0.1,
    roundBreakSeconds: 10.0,
    specialRoundBreakSeconds: 14.0,
    houndFirstRoundDefault: 6,
    houndInterval: 5,
    bruteFirstRound: 12,
    bruteInterval: 2,
    bloaterMinRound: 8,
    bloaterChance: 0.08,
  },

  enemies: {
    shambler: {
      walkSpeed: 1.55,
      runSpeed: 2.95,
      sprintSpeed: 4.45,
      meleeDamage: 34,
      meleeRange: 1.8,
      attackWindup: 0.95,
      attackHitTime: 0.5,
      attackCooldown: 1.35,
      boardTearTime: 2.0,
      climbDuration: 1.05,
      stuckTimeout: 5.0,
      corpseFadeDelay: 8.0,
      corpseFadeDuration: 3.0,
    },
    hound: {
      healthRatio: 0.4,
      speed: 5.4,
      meleeDamage: 25,
      meleeRange: 1.75,
      attackWindup: 0.5,
      attackCooldown: 0.95,
      countBase: 6,
      countPerRound: 1,
    },
    bloater: {
      healthMult: 1.8,
      speed: 1.35,
      meleeRange: 2.2,
      fuseTime: 1.15,
      explosionDamagePlayer: 55,
      explosionDamageZombie: 380,
      explosionRadius: 4.5,
    },
    brute: {
      healthMult: 4.0,
      speed: 2.45,
      chargeSpeed: 6.2,
      chargeTelegraph: 1.15,
      chargeDuration: 1.4,
      chargeCooldown: 9.0,
      meleeDamage: 50,
      meleeRange: 2.3,
      attackWindup: 1.0,
      backWeakpointMult: 2.5,
      staggerResistance: 0.2,
    },
  },

  economy: {
    hitPoints: 10,
    bodyKillPoints: 60,
    headshotKillPoints: 100,
    meleeKillPoints: 130,
    explosiveKillPoints: 50,
    plankRebuildPoints: 10,
    nukePoints: 400,
    carpenterPoints: 200,
    wallAmmoRatio: 0.5,
    doors: {
      farmhouse_to_yard: 750,
      yard_to_barn: 1000,
      yard_to_lab: 1250,
      lab_to_bunker: 1500,
    },
    crate: {
      cost: 950,
      fireSaleCost: 10,
      rollDuration: 2.0,
      takeWindow: 8.5,
      minUsesBeforeMove: 4,
      maxUsesBeforeMove: 8,
    },
    barricade: {
      maxPlanks: 6,
      rebuildTime: 0.4,
    },
    electricTrap: {
      cost: 1000,
      duration: 30.0,
      cooldown: 60.0,
      damagePerSecond: 600,
      radius: 4.2,
    },
  },

  perks: {
    maxPerks: 4,
    drinkDuration: 1.35,
    list: {
      ironhide: {
        id: 'ironhide',
        name: 'Ironhide Tonic',
        shortDesc: 'Max Health 100 → 250',
        price: 2500,
        color: 0xd9383a,
        accentHex: '#d9383a',
        zone: 'lab_wing',
      },
      second_wind: {
        id: 'second_wind',
        name: 'Second Wind',
        shortDesc: 'Auto-revive once on lethal hit (No Power Needed)',
        price: 500,
        color: 0x38bdf8,
        accentHex: '#38bdf8',
        zone: 'farmhouse',
      },
      quickhands: {
        id: 'quickhands',
        name: 'Quickhands Elixir',
        shortDesc: 'Reload & swap speed ×2',
        price: 3000,
        color: 0x22c55e,
        accentHex: '#22c55e',
        zone: 'barn',
      },
      twin_barrel: {
        id: 'twin_barrel',
        name: 'Twin Barrel Brew',
        shortDesc: '+33% damage & +33% fire rate',
        price: 2000,
        color: 0xf59e0b,
        accentHex: '#f59e0b',
        zone: 'bunker',
      },
      marathon: {
        id: 'marathon',
        name: 'Marathon Cordial',
        shortDesc: '+15% sprint & faster crouch',
        price: 2000,
        color: 0xfacc15,
        accentHex: '#facc15',
        zone: 'bunker',
      },
    } satisfies Record<PerkId, PerkConfig>,
  },

  powerUps: {
    dropChance: 0.075,
    minKillsBetweenDrops: 3,
    maxDropsPerRound: 4,
    guaranteedDropWithinRound: 2,
    lifetime: 30.0,
    blinkWarningSeconds: 7.0,
    activeDuration: 30.0,
    pickupRadius: 1.85,
    perTypeCooldown: 20.0,
  },

  easterEgg: {
    fuseCount: 3,
    radioDefendDuration: 40.0,
    rewardPoints: 5000,
  },

  nav: {
    cellSize: 1.0,
    gridMinX: -46,
    gridMaxX: 46,
    gridMinZ: -46,
    gridMaxZ: 46,
    flowFieldUpdateHz: 10,
    separationRadius: 1.15,
    separationWeight: 2.2,
  },

  perf: {
    maxShadowCasters: 6,
    maxDynamicMuzzleLights: 2,
    maxDecals: 120,
    maxParticles: 240,
    lodDistance: 25,
  },
} as const;

export function calculateZombieHealth(round: number): number {
  const effectiveRound =
    BALANCE.rounds.healthCapEnabled && round > BALANCE.rounds.healthCapRound
      ? BALANCE.rounds.healthCapRound
      : round;
  if (effectiveRound <= 1) return BALANCE.rounds.baseHealthRound1;
  if (effectiveRound <= BALANCE.rounds.healthStepCutoffRound) {
    return (
      BALANCE.rounds.baseHealthRound1 +
      (effectiveRound - 1) * BALANCE.rounds.healthStepEarly
    );
  }
  const base9 =
    BALANCE.rounds.baseHealthRound1 +
    (BALANCE.rounds.healthStepCutoffRound - 1) * BALANCE.rounds.healthStepEarly;
  return Math.round(
    base9 *
      Math.pow(
        BALANCE.rounds.healthScaleLate,
        effectiveRound - BALANCE.rounds.healthStepCutoffRound,
      ),
  );
}

export function calculateRoundZombieCount(round: number): number {
  if (round <= 0) return 0;
  if (round <= BALANCE.rounds.earlyCounts.length) {
    return BALANCE.rounds.earlyCounts[round - 1] ?? 6;
  }
  return Math.round(
    BALANCE.rounds.lateCountBase * BALANCE.rounds.lateCountMultiplier * round,
  );
}

export function calculateSpawnDelay(round: number): number {
  const r = Math.max(1, round);
  return Math.max(
    BALANCE.rounds.spawnDelayMin,
    BALANCE.rounds.spawnDelayBase * Math.pow(BALANCE.rounds.spawnDelayDecay, r - 1),
  );
}

export function getSpeedClassWeights(round: number): {
  walk: number;
  run: number;
  sprint: number;
} {
  if (round <= 3) return { walk: 0.92, run: 0.08, sprint: 0.0 };
  if (round <= 6) return { walk: 0.55, run: 0.4, sprint: 0.05 };
  if (round <= 10) return { walk: 0.25, run: 0.55, sprint: 0.2 };
  if (round <= 16) return { walk: 0.1, run: 0.5, sprint: 0.4 };
  return { walk: 0.05, run: 0.35, sprint: 0.6 };
}
