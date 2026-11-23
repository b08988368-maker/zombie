import { BALANCE } from './balance';
import type { GameSettings } from '../game/types';
export type { GameSettings };

const SETTINGS_STORAGE_KEY = 'hollowfield_settings_v1';
const HIGHSCORE_STORAGE_KEY = 'hollowfield_best_run_v1';

export interface BestRunRecord {
  bestRound: number;
  bestKills: number;
  bestPoints: number;
}

export const DEFAULT_SETTINGS: GameSettings = {
  quality: 'high',
  resolutionScale: 1.0,
  fov: BALANCE.player.defaultFov,
  sensitivity: 1.0,
  headBob: true,
  sprintMode: 'hold',
  aimAssist: true,
  masterVolume: 0.85,
  musicVolume: 0.65,
  sfxVolume: 0.9,
  voiceVolume: 0.85,
  gamepadDeadzone: 0.15,
  keyBindings: {
    forward: 'KeyW',
    backward: 'KeyS',
    left: 'KeyA',
    right: 'KeyD',
    jump: 'Space',
    sprint: 'ShiftLeft',
    crouch: 'KeyC',
    reload: 'KeyR',
    interact: 'KeyF',
    melee: 'KeyV',
    grenade: 'KeyG',
    swap: 'KeyQ',
  },
};

export function loadSettings(): GameSettings {
  try {
    const raw = window.localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (!raw) return structuredClone(DEFAULT_SETTINGS);
    const parsed = JSON.parse(raw) as Partial<GameSettings>;
    return {
      ...DEFAULT_SETTINGS,
      ...parsed,
      keyBindings: {
        ...DEFAULT_SETTINGS.keyBindings,
        ...(parsed.keyBindings ?? {}),
      },
    };
  } catch {
    return structuredClone(DEFAULT_SETTINGS);
  }
}

export function saveSettings(settings: GameSettings): void {
  try {
    window.localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Ignore storage quota/security errors
  }
}

export function loadBestRun(): BestRunRecord {
  try {
    const raw = window.localStorage.getItem(HIGHSCORE_STORAGE_KEY);
    if (!raw) return { bestRound: 0, bestKills: 0, bestPoints: 0 };
    const parsed = JSON.parse(raw) as Partial<BestRunRecord>;
    return {
      bestRound: typeof parsed.bestRound === 'number' ? parsed.bestRound : 0,
      bestKills: typeof parsed.bestKills === 'number' ? parsed.bestKills : 0,
      bestPoints: typeof parsed.bestPoints === 'number' ? parsed.bestPoints : 0,
    };
  } catch {
    return { bestRound: 0, bestKills: 0, bestPoints: 0 };
  }
}

export function saveBestRun(round: number, kills: number, points: number): BestRunRecord {
  const prev = loadBestRun();
  const next: BestRunRecord = {
    bestRound: Math.max(prev.bestRound, round),
    bestKills: Math.max(prev.bestKills, kills),
    bestPoints: Math.max(prev.bestPoints, points),
  };
  try {
    window.localStorage.setItem(HIGHSCORE_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Ignore storage quota/security errors
  }
  return next;
}
