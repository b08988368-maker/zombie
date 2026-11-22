import { useEffect, useRef, useState } from 'react';
import { DEFAULT_SETTINGS, loadSettings } from './config/settings';
import { GameEngine } from './engine/GameEngine';
import type { GameSettings, HudSnapshot } from './game/types';
import { GameHud } from './ui/GameHud';
import { MenuOverlay } from './ui/MenuOverlay';

const INITIAL_SNAPSHOT: HudSnapshot = {
  screen: 'loading',
  loadProgress: 0,
  loadLabel: 'Bootstrapping Engine...',
  pointerLocked: false,
  health: 100,
  maxHealth: 100,
  isReviving: false,
  reviveProgress: 0,
  points: 500,
  round: 1,
  roundPhase: 'intro',
  roundBannerText: '',
  isHoundRound: false,
  powerOn: false,
  currentZone: 'farmhouse',
  currentZoneLabel: 'Farmhouse Quarters',
  weapons: [],
  activeSlot: 0,
  isReloading: false,
  reloadProgress: 0,
  isAds: false,
  isSprinting: false,
  grenades: 2,
  maxGrenades: 4,
  perks: [],
  activePowerUps: [],
  interactPrompt: null,
  pointDeltas: [],
  hitMarkerType: 'none',
  hitMarkerAlpha: 0,
  damageIndicatorAngle: null,
  damageIndicatorAlpha: 0,
  radioMessage: null,
  objectiveHint: null,
  easterEggStep: 0,
  fusesCollected: 0,
  radioDefendRemaining: 0,
  stats: {
    round: 1,
    kills: 0,
    headshots: 0,
    meleeKills: 0,
    pointsEarned: 0,
    shotsFired: 0,
    shotsHit: 0,
    doorsOpened: 0,
    perksBought: 0,
    elapsedSeconds: 0,
  },
  perf: {
    fps: 60,
    frameTimeMs: 16.6,
    drawCalls: 0,
    triangles: 0,
    zombieCount: 0,
    aiTickMs: 0,
    memoryMb: 0,
  },
  showDebug: false,
  activeEnemyTypes: [],
  errorBanner: null,
};

export default function App() {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const engineRef = useRef<GameEngine | null>(null);
  const [snap, setSnap] = useState<HudSnapshot>(INITIAL_SNAPSHOT);
  const [settings, setSettings] = useState<GameSettings>(() => loadSettings());

  useEffect(() => {
    const el = mountRef.current;
    if (!el) return;
    const engine = new GameEngine(el, (nextSnap) => {
      setSnap(nextSnap);
    });
    engineRef.current = engine;
    return () => {
      engine.dispose();
      engineRef.current = null;
    };
  }, []);

  const handleUpdateSettings = (next: GameSettings) => {
    setSettings(next);
    engineRef.current?.updateSettings(next);
  };

  return (
    <div className="relative w-screen h-screen overflow-hidden bg-[#090b0a]">
      {/* Isolated WebGL viewport mount container */}
      <div ref={mountRef} className="w-full h-full" />

      {snap.errorBanner && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-40 bg-red-900/95 border border-red-400/50 px-4 py-2 text-xs text-white">
          {snap.errorBanner}
        </div>
      )}

      {snap.screen === 'playing' && (
        <GameHud
          snap={snap}
          onResumePointer={() => engineRef.current?.requestPointerLock()}
        />
      )}

      <MenuOverlay
        snap={snap}
        settings={settings ?? DEFAULT_SETTINGS}
        onStartGame={() => engineRef.current?.startNewGame()}
        onResumeGame={() => engineRef.current?.resumeGame()}
        onRestartGame={() => engineRef.current?.restartGame()}
        onReturnToMenu={() => engineRef.current?.returnToMenu()}
        onUpdateSettings={handleUpdateSettings}
      />
    </div>
  );
}
