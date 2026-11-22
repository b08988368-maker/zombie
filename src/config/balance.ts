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
    walkSpeed: 4.2,
    sprintSpeed: 6.4,
    crouchSpeed: 2.0,
    jumpSpeed: 5.7,
    gravity: 18.0,
    groundAccel: 28.0,
    airAccel: 8.0,
    friction: 12.0,
    maxHealth: 100,
    ironhideMaxHealth: 250,
    regenDelay: 5.0,
    regenDuration: 3.0,
    lowHealthThreshold: 40,
    defaultFov: 80,
    defaultSensitivity: 0.0022,
    knifeRange: 2.35,
    knifeDamageBase: 150,
    knifeDamagePerRoundStep: 25,
    knifeCooldown: 0.55,
    knifeLungeSpeed: 5.5,
    grenadesStart: 2,
    grenadesMax: 4,
    grenadeThrowSpeed: 17.5,
    grenadeFuse: 2.2,
    grenadeDamageInner: 450,
    grenadeDamageOuter: 150,
    grenadeRadius: 5.8,
    secondWindDuration: 2.5,
    secondWindPushRadius: 8.5,
    interactRange: 2.8,
    interactHoldTime: 0.22,
    startingPoints: 500,
  },

  weapons: {
    service_pistol: {
      id: 'service_pistol',
      name: 'Service Pistol',
      upgradedName: 'M1986 Regulator',
      role: 'Sidearm',
      fireMode: 'semi',
      damage: 20,
      pellets: 1,
      splashDamage: 0,
      splashRadius: 0,
      projectileSpeed: 0,
      rpm: 400,
      magSize: 8,
      reserveMax: 80,
      wallPrice: 0,
      headshotMult: 2.0,
      torsoMult: 1.0,
      limbMult: 0.8,
      spreadHip: 0.024,
      spreadAds: 0.004,
      recoilPitch: 0.022,
      recoilYaw: 0.008,
      cameraKick: 0.016,
      adsFov: 68,
      adsSensScale: 0.72,
      reloadTime: 1.35,
      emptyReloadTime: 1.65,
      swapTime: 0.28,
      hasTracer: false,
      tracerColor: 0xffd27a,
      upgradedTracerColor: 0xff5a36,
      falloffStart: 25,
      falloffEnd: 50,
      falloffMinMult: 0.65,
      crateWeight: 0,
      crateOnly: false,
    },
    hedgerow: {
      id: 'hedgerow',
      name: 'Hedgerow',
      upgradedName: 'Bramble Sweeper',
      role: 'Pump Shotgun',
      fireMode: 'semi',
      damage: 20,
      pellets: 8,
      splashDamage: 0,
      splashRadius: 0,
      projectileSpeed: 0,
      rpm: 70,
      magSize: 6,
      reserveMax: 52,
      wallPrice: 1500,
      headshotMult: 1.5,
      torsoMult: 1.0,
      limbMult: 0.8,
      spreadHip: 0.085,
      spreadAds: 0.055,
      recoilPitch: 0.065,
      recoilYaw: 0.018,
      cameraKick: 0.048,
      adsFov: 70,
      adsSensScale: 0.78,
      reloadTime: 2.2,
      emptyReloadTime: 2.5,
      swapTime: 0.4,
      hasTracer: false,
      tracerColor: 0xffb35c,
      upgradedTracerColor: 0x38bdf8,
      falloffStart: 12,
      falloffEnd: 28,
      falloffMinMult: 0.45,
      crateWeight: 10,
      crateOnly: false,
    },
    rattler: {
      id: 'rattler',
      name: 'Rattler',
      upgradedName: 'Viper-86 Overclock',
      role: 'SMG',
      fireMode: 'auto',
      damage: 24,
      pellets: 1,
      splashDamage: 0,
      splashRadius: 0,
      projectileSpeed: 0,
      rpm: 800,
      magSize: 32,
      reserveMax: 192,
      wallPrice: 1000,
      headshotMult: 1.8,
      torsoMult: 1.0,
      limbMult: 0.8,
      spreadHip: 0.042,
      spreadAds: 0.013,
      recoilPitch: 0.016,
      recoilYaw: 0.012,
      cameraKick: 0.012,
      adsFov: 66,
      adsSensScale: 0.7,
      reloadTime: 1.75,
      emptyReloadTime: 2.1,
      swapTime: 0.3,
      hasTracer: true,
      tracerColor: 0xffe08a,
      upgradedTracerColor: 0x22d3ee,
      falloffStart: 25,
      falloffEnd: 50,
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
      damage: 40,
      pellets: 1,
      splashDamage: 0,
      splashRadius: 0,
      projectileSpeed: 0,
      rpm: 600,
      magSize: 30,
      reserveMax: 150,
      wallPrice: 1200,
      headshotMult: 2.0,
      torsoMult: 1.0,
      limbMult: 0.8,
      spreadHip: 0.036,
      spreadAds: 0.006,
      recoilPitch: 0.024,
      recoilYaw: 0.01,
      cameraKick: 0.018,
      adsFov: 60,
      adsSensScale: 0.65,
      reloadTime: 2.0,
      emptyReloadTime: 2.35,
      swapTime: 0.35,
      hasTracer: true,
      tracerColor: 0xffd27a,
      upgradedTracerColor: 0xf43f5e,
      falloffStart: 25,
      falloffEnd: 55,
      falloffMinMult: 0.65,
      crateWeight: 12,
      crateOnly: false,
    },
    longbow: {
      id: 'longbow',
      name: 'Longbow',
      upgradedName: 'Deadeye Harbinger',
      role: 'Marksman Rifle',
      fireMode: 'semi',
      damage: 130,
      pellets: 1,
      splashDamage: 0,
      splashRadius: 0,
      projectileSpeed: 0,
      rpm: 150,
      magSize: 10,
      reserveMax: 60,
      wallPrice: 0,
      headshotMult: 3.0,
      torsoMult: 1.0,
      limbMult: 0.8,
      spreadHip: 0.045,
      spreadAds: 0.001,
      recoilPitch: 0.055,
      recoilYaw: 0.012,
      cameraKick: 0.042,
      adsFov: 44,
      adsSensScale: 0.48,
      reloadTime: 2.25,
      emptyReloadTime: 2.6,
      swapTime: 0.42,
      hasTracer: false,
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
      damage: 45,
      pellets: 1,
      splashDamage: 0,
      splashRadius: 0,
      projectileSpeed: 0,
      rpm: 650,
      magSize: 100,
      reserveMax: 400,
      wallPrice: 0,
      headshotMult: 2.0,
      torsoMult: 1.0,
      limbMult: 0.8,
      spreadHip: 0.055,
      spreadAds: 0.015,
      recoilPitch: 0.022,
      recoilYaw: 0.014,
      cameraKick: 0.018,
      adsFov: 62,
      adsSensScale: 0.65,
      reloadTime: 3.4,
      emptyReloadTime: 3.9,
      swapTime: 0.52,
      hasTracer: true,
      tracerColor: 0xffc864,
      upgradedTracerColor: 0x34d399,
      falloffStart: 25,
      falloffEnd: 60,
      falloffMinMult: 0.65,
      crateWeight: 9,
      crateOnly: true,
    },
    phase_cannon: {
      id: 'phase_cannon',
      name: 'Phase Cannon',
      upgradedName: 'Singularity Emitter',
      role: 'Experimental Prototype',
      fireMode: 'projectile',
      damage: 1000,
      pellets: 1,
      splashDamage: 500,
      splashRadius: 3.6,
      projectileSpeed: 42,
      rpm: 180,
      magSize: 20,
      reserveMax: 160,
      wallPrice: 0,
      headshotMult: 1.0,
      torsoMult: 1.0,
      limbMult: 1.0,
      spreadHip: 0.01,
      spreadAds: 0.002,
      recoilPitch: 0.036,
      recoilYaw: 0.006,
      cameraKick: 0.03,
      adsFov: 65,
      adsSensScale: 0.72,
      reloadTime: 2.4,
      emptyReloadTime: 2.75,
      swapTime: 0.4,
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
    duration: 6.0,
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
      meleeDamage: 50,
      meleeRange: 1.85,
      attackWindup: 1.1,
      attackHitTime: 0.55,
      attackCooldown: 1.25,
      boardTearTime: 2.0,
      climbDuration: 1.05,
      stuckTimeout: 5.0,
      corpseFadeDelay: 8.0,
      corpseFadeDuration: 3.0,
    },
    hound: {
      healthRatio: 0.4,
      speed: 5.4,
      meleeDamage: 35,
      meleeRange: 1.75,
      attackWindup: 0.5,
      attackCooldown: 0.9,
      countBase: 6,
      countPerRound: 1,
    },
    bloater: {
      healthMult: 1.8,
      speed: 1.35,
      meleeRange: 2.2,
      fuseTime: 1.1,
      explosionDamagePlayer: 80,
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
      meleeDamage: 70,
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
      rollDuration: 2.6,
      takeWindow: 8.0,
      minUsesBeforeMove: 4,
      maxUsesBeforeMove: 8,
    },
    barricade: {
      maxPlanks: 6,
      rebuildTime: 0.55,
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
        shortDesc: 'Auto-revive once on lethal hit',
        price: 500,
        color: 0x38bdf8,
        accentHex: '#38bdf8',
        zone: 'bunker',
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
    dropChance: 0.025,
    minKillsBetweenDrops: 3,
    maxDropsPerRound: 4,
    guaranteedDropWithinRound: 3,
    lifetime: 30.0,
    blinkWarningSeconds: 7.0,
    activeDuration: 30.0,
    pickupRadius: 1.6,
    perTypeCooldown: 22.0,
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
