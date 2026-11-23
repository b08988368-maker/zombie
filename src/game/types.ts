import type { EnemyType, PerkId, PowerUpId, WeaponId, ZoneId } from '../config/balance';

export type QualityPreset = 'low' | 'medium' | 'high' | 'ultra';

export interface KeyBindings {
  forward: string;
  backward: string;
  left: string;
  right: string;
  jump: string;
  sprint: string;
  crouch: string;
  reload: string;
  interact: string;
  melee: string;
  grenade: string;
  swap: string;
}

export interface GameSettings {
  quality: QualityPreset;
  resolutionScale: number;
  fov: number;
  sensitivity: number;
  headBob: boolean;
  sprintMode: 'hold' | 'toggle';
  aimAssist: boolean;
  masterVolume: number;
  musicVolume: number;
  sfxVolume: number;
  voiceVolume: number;
  gamepadDeadzone: number;
  keyBindings: KeyBindings;
}

export interface WeaponSlotState {
  id: WeaponId;
  name: string;
  mag: number;
  magSize: number;
  reserve: number;
  reserveMax: number;
  upgraded: boolean;
}

export interface ActivePowerUpState {
  id: PowerUpId;
  label: string;
  remaining: number;
  duration: number;
}

export interface PointDelta {
  id: number;
  amount: number;
  reason: string;
  timestamp: number;
}

export interface PerfStats {
  fps: number;
  frameTimeMs: number;
  drawCalls: number;
  triangles: number;
  zombieCount: number;
  aiTickMs: number;
  memoryMb: number;
}

export interface RunStats {
  round: number;
  kills: number;
  headshots: number;
  meleeKills: number;
  pointsEarned: number;
  shotsFired: number;
  shotsHit: number;
  doorsOpened: number;
  perksBought: number;
  elapsedSeconds: number;
}

export interface InteractPrompt {
  id: string;
  title: string;
  subtitle: string;
  cost: number | null;
  canAfford: boolean;
  progress: number; // 0..1 hold progress
  blockedReason?: string;
}

export type RoundPhase = 'intro' | 'active' | 'intermission' | 'special_intro';

export type GameScreen = 'loading' | 'menu' | 'playing' | 'paused' | 'gameover';

export interface HudSnapshot {
  screen: GameScreen;
  loadProgress: number;
  loadLabel: string;
  pointerLocked: boolean;
  pointerLockBlocked: boolean;
  health: number;
  maxHealth: number;
  isReviving: boolean;
  reviveProgress: number;
  points: number;
  round: number;
  roundPhase: RoundPhase;
  roundBannerText: string;
  isHoundRound: boolean;
  powerOn: boolean;
  currentZone: ZoneId;
  currentZoneLabel: string;
  weapons: WeaponSlotState[];
  activeSlot: number;
  activeWeaponId: WeaponId;
  isReloading: boolean;
  reloadProgress: number;
  isAds: boolean;
  isSprinting: boolean;
  crosshairSpread: number;
  flashlightOn: boolean;
  zombiesRemaining: number;
  grenades: number;
  maxGrenades: number;
  perks: PerkId[];
  activePowerUps: ActivePowerUpState[];
  powerUpBanner: { label: string; colorHex: string } | null;
  interactPrompt: InteractPrompt | null;
  pointDeltas: PointDelta[];
  hitMarkerType: 'none' | 'hit' | 'kill' | 'headshot';
  hitMarkerAlpha: number;
  damageFlash: number;
  damageIndicatorAngle: number | null;
  damageIndicatorAlpha: number;
  radioMessage: string | null;
  objectiveHint: string | null;
  easterEggStep: number; // 0: need power, 1: collect fuses, 2: activate radio, 3: defending, 4: complete
  fusesCollected: number;
  radioDefendRemaining: number;
  stats: RunStats;
  perf: PerfStats;
  showDebug: boolean;
  activeEnemyTypes: EnemyType[];
  errorBanner: string | null;
}

export interface SeededRng {
  next(): number;
  range(min: number, max: number): number;
  int(min: number, maxInclusive: number): number;
}

export function createSeededRng(seed = 19861031): SeededRng {
  let state = seed >>> 0;
  return {
    next(): number {
      state = (state + 0x6d2b79f5) >>> 0;
      let t = Math.imul(state ^ (state >>> 15), 1 | state);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    },
    range(min: number, max: number): number {
      return min + (max - min) * this.next();
    },
    int(min: number, maxInclusive: number): number {
      return Math.floor(min + this.next() * (maxInclusive - min + 1));
    },
  };
}
