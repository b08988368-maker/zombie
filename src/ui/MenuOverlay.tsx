import { useState } from 'react';
import { DEFAULT_SETTINGS, loadBestRun } from '../config/settings';
import type { GameSettings, HudSnapshot, KeyBindings, QualityPreset } from '../game/types';

interface MenuOverlayProps {
  snap: HudSnapshot;
  settings: GameSettings;
  onStartGame: () => void;
  onResumeGame: () => void;
  onRestartGame: () => void;
  onReturnToMenu: () => void;
  onUpdateSettings: (next: GameSettings) => void;
}

const BINDING_LABELS: { key: keyof KeyBindings; label: string }[] = [
  { key: 'forward', label: 'Move Forward' },
  { key: 'backward', label: 'Move Backward' },
  { key: 'left', label: 'Strafe Left' },
  { key: 'right', label: 'Strafe Right' },
  { key: 'sprint', label: 'Sprint' },
  { key: 'crouch', label: 'Crouch' },
  { key: 'jump', label: 'Jump' },
  { key: 'reload', label: 'Reload' },
  { key: 'interact', label: 'Interact / Buy / Repair' },
  { key: 'melee', label: 'Knife Melee' },
  { key: 'grenade', label: 'Throw Frag Grenade' },
  { key: 'swap', label: 'Swap Weapon' },
];

export function MenuOverlay({
  snap,
  settings,
  onStartGame,
  onResumeGame,
  onRestartGame,
  onReturnToMenu,
  onUpdateSettings,
}: MenuOverlayProps) {
  const [subTab, setSubTab] = useState<'none' | 'settings' | 'credits'>('none');
  const [rebindingKey, setRebindingKey] = useState<keyof KeyBindings | null>(null);
  const best = loadBestRun();

  const handleRebindKeyDown = (e: React.KeyboardEvent, keyName: keyof KeyBindings) => {
    e.preventDefault();
    e.stopPropagation();
    const next: GameSettings = {
      ...settings,
      keyBindings: {
        ...settings.keyBindings,
        [keyName]: e.code,
      },
    };
    onUpdateSettings(next);
    setRebindingKey(null);
  };

  if (snap.screen === 'loading') {
    return (
      <div className="fixed inset-0 z-30 flex flex-col items-center justify-center bg-[#090b0a] px-6">
        <div className="w-full max-w-md space-y-4">
          <h1 className="font-display text-4xl font-bold tracking-[0.14em] uppercase text-[#ece9e2]">
            HOLLOWFIELD
          </h1>
          <p className="text-xs text-[#9e988a]">{snap.loadLabel}</p>
          <div className="h-1.5 bg-[#1b201e] overflow-hidden">
            <div
              className="h-full bg-amber-500 transition-all duration-150"
              style={{ width: `${Math.round(snap.loadProgress * 100)}%` }}
            />
          </div>
        </div>
      </div>
    );
  }

  if (snap.screen === 'gameover') {
    const accuracy =
      snap.stats.shotsFired > 0
        ? Math.round((snap.stats.shotsHit / snap.stats.shotsFired) * 100)
        : 0;
    const mins = Math.floor(snap.stats.elapsedSeconds / 60);
    const secs = Math.floor(snap.stats.elapsedSeconds % 60);

    return (
      <div className="fixed inset-0 z-30 flex items-center justify-center bg-[#070908]/88 px-6">
        <div className="w-full max-w-xl bg-[#0e1110] border border-white/15 p-8 space-y-6">
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-red-400">Station Lost</p>
            <h2 className="font-display text-4xl font-bold uppercase tracking-wide text-[#ece9e2] mt-1">
              Overrun on Round {snap.round}
            </h2>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 border-y border-white/10 py-5">
            <div>
              <div className="text-xs text-[#8d877a]">Round Reached</div>
              <div className="font-mono-tabular text-2xl font-bold text-[#ece9e2]">
                {snap.round}
              </div>
            </div>
            <div>
              <div className="text-xs text-[#8d877a]">Eliminations</div>
              <div className="font-mono-tabular text-2xl font-bold text-[#ece9e2]">
                {snap.stats.kills}
              </div>
            </div>
            <div>
              <div className="text-xs text-[#8d877a]">Headshots</div>
              <div className="font-mono-tabular text-2xl font-bold text-amber-400">
                {snap.stats.headshots}
              </div>
            </div>
            <div>
              <div className="text-xs text-[#8d877a]">Total Points</div>
              <div className="font-mono-tabular text-2xl font-bold text-[#ece9e2]">
                {snap.stats.pointsEarned.toLocaleString()}
              </div>
            </div>
            <div>
              <div className="text-xs text-[#8d877a]">Accuracy</div>
              <div className="font-mono-tabular text-2xl font-bold text-[#ece9e2]">
                {accuracy}%
              </div>
            </div>
            <div>
              <div className="text-xs text-[#8d877a]">Survival Time</div>
              <div className="font-mono-tabular text-2xl font-bold text-[#ece9e2]">
                {mins}:{secs.toString().padStart(2, '0')}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={onRestartGame}
              className="px-6 py-2.5 text-sm font-semibold bg-amber-500 text-[#090b0a] hover:bg-amber-400 transition-colors cursor-pointer"
            >
              Play Again
            </button>
            <button
              type="button"
              onClick={onReturnToMenu}
              className="px-6 py-2.5 text-sm font-medium bg-[#181c1a] text-[#ece9e2] border border-white/15 hover:bg-[#222725] transition-colors cursor-pointer"
            >
              Main Menu
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (snap.screen !== 'menu' && snap.screen !== 'paused') {
    return null;
  }

  return (
    <div className="fixed inset-0 z-30 flex items-center bg-gradient-to-r from-[#070908]/92 via-[#070908]/68 to-transparent px-8 sm:px-14">
      <div className="w-full max-w-3xl flex flex-col gap-6 max-h-[90vh] overflow-y-auto pr-2">
        {/* Title Lockup */}
        <div>
          <div className="text-xs tracking-[0.2em] uppercase text-amber-400/90 mb-1">
            {snap.screen === 'paused'
              ? 'Run Paused'
              : '1986 · Agricultural Research Station'}
          </div>
          <h1 className="font-display text-5xl sm:text-6xl font-bold tracking-[0.08em] uppercase text-[#ece9e2] leading-none">
            HOLLOWFIELD
          </h1>
          {snap.screen === 'menu' && best.bestRound > 0 && (
            <div className="text-xs text-[#a39d8f] mt-2 font-mono-tabular">
              Best Record: Round {best.bestRound} · {best.bestKills} Kills ·{' '}
              {best.bestPoints.toLocaleString()} PTS
            </div>
          )}
        </div>

        {/* Navigation / Action Buttons */}
        {subTab === 'none' && (
          <div className="flex flex-col items-start gap-2.5 max-w-xs">
            {snap.screen === 'menu' ? (
              <button
                type="button"
                data-testid="play-button"
                onClick={onStartGame}
                className="w-full text-left px-5 py-3 text-sm font-semibold uppercase tracking-wider bg-amber-500 text-[#090b0a] hover:bg-amber-400 transition-colors cursor-pointer"
              >
                Start Survival
              </button>
            ) : (
              <>
                <button
                  type="button"
                  onClick={onResumeGame}
                  className="w-full text-left px-5 py-3 text-sm font-semibold uppercase tracking-wider bg-amber-500 text-[#090b0a] hover:bg-amber-400 transition-colors cursor-pointer"
                >
                  Resume
                </button>
                <button
                  type="button"
                  onClick={onRestartGame}
                  className="w-full text-left px-5 py-2.5 text-sm font-medium bg-[#141816] text-[#ece9e2] border border-white/15 hover:bg-[#1e2421] transition-colors cursor-pointer"
                >
                  Restart Run
                </button>
              </>
            )}

            <button
              type="button"
              onClick={() => setSubTab('settings')}
              className="w-full text-left px-5 py-2.5 text-sm font-medium bg-[#141816] text-[#ece9e2] border border-white/15 hover:bg-[#1e2421] transition-colors cursor-pointer"
            >
              Settings
            </button>

            <button
              type="button"
              onClick={() => setSubTab('credits')}
              className="w-full text-left px-5 py-2.5 text-sm font-medium bg-[#141816] text-[#ece9e2] border border-white/15 hover:bg-[#1e2421] transition-colors cursor-pointer"
            >
              Controls & Credits
            </button>

            {snap.screen === 'paused' && (
              <button
                type="button"
                onClick={onReturnToMenu}
                className="w-full text-left px-5 py-2.5 text-sm font-medium bg-[#141816] text-[#c4beaf] border border-white/10 hover:bg-[#1e2421] transition-colors cursor-pointer"
              >
                Quit to Menu
              </button>
            )}
          </div>
        )}

        {/* Settings Panel */}
        {subTab === 'settings' && (
          <div className="bg-[#0e1110]/95 border border-white/15 p-6 space-y-5 max-w-2xl">
            <div className="flex items-center justify-between border-b border-white/10 pb-3">
              <h2 className="font-display text-2xl uppercase tracking-wide text-[#ece9e2]">
                Settings
              </h2>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => onUpdateSettings(structuredClone(DEFAULT_SETTINGS))}
                  className="px-3 py-1.5 text-xs bg-[#181c1a] border border-white/15 text-[#c4beaf] hover:text-white cursor-pointer"
                >
                  Reset Defaults
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setRebindingKey(null);
                    setSubTab('none');
                  }}
                  className="px-4 py-1.5 text-xs font-semibold bg-amber-500 text-[#090b0a] cursor-pointer"
                >
                  Back
                </button>
              </div>
            </div>

            {/* Graphics & Controls */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
              <label className="flex flex-col gap-1.5">
                <span className="text-[#a39d8f]">Graphics Quality</span>
                <select
                  value={settings.quality}
                  onChange={(e) =>
                    onUpdateSettings({
                      ...settings,
                      quality: e.target.value as QualityPreset,
                    })
                  }
                  className="bg-[#161a18] border border-white/15 px-3 py-2 text-[#ece9e2]"
                >
                  <option value="low">Low (Integrated GPU)</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                  <option value="ultra">Ultra</option>
                </select>
              </label>

              <label className="flex flex-col gap-1.5">
                <span className="text-[#a39d8f] flex justify-between">
                  <span>Resolution Scale</span>
                  <span className="font-mono-tabular">{Math.round(settings.resolutionScale * 100)}%</span>
                </span>
                <input
                  type="range"
                  min={0.6}
                  max={1.0}
                  step={0.05}
                  value={settings.resolutionScale}
                  onChange={(e) =>
                    onUpdateSettings({ ...settings, resolutionScale: Number(e.target.value) })
                  }
                />
              </label>

              <label className="flex flex-col gap-1.5">
                <span className="text-[#a39d8f] flex justify-between">
                  <span>Field of View</span>
                  <span className="font-mono-tabular">{settings.fov}°</span>
                </span>
                <input
                  type="range"
                  min={65}
                  max={105}
                  step={1}
                  value={settings.fov}
                  onChange={(e) =>
                    onUpdateSettings({ ...settings, fov: Number(e.target.value) })
                  }
                />
              </label>

              <label className="flex flex-col gap-1.5">
                <span className="text-[#a39d8f] flex justify-between">
                  <span>Mouse Sensitivity</span>
                  <span className="font-mono-tabular">{settings.sensitivity.toFixed(2)}</span>
                </span>
                <input
                  type="range"
                  min={0.3}
                  max={2.5}
                  step={0.05}
                  value={settings.sensitivity}
                  onChange={(e) =>
                    onUpdateSettings({ ...settings, sensitivity: Number(e.target.value) })
                  }
                />
              </label>

              <label className="flex items-center justify-between bg-[#141816] border border-white/10 px-3 py-2">
                <span className="text-[#ece9e2]">Head Bob Motion</span>
                <input
                  type="checkbox"
                  checked={settings.headBob}
                  onChange={(e) =>
                    onUpdateSettings({ ...settings, headBob: e.target.checked })
                  }
                />
              </label>

              <label className="flex flex-col gap-1.5">
                <span className="text-[#a39d8f] flex justify-between">
                  <span>Gamepad Deadzone</span>
                  <span className="font-mono-tabular">{settings.gamepadDeadzone.toFixed(2)}</span>
                </span>
                <input
                  type="range"
                  min={0.05}
                  max={0.4}
                  step={0.01}
                  value={settings.gamepadDeadzone}
                  onChange={(e) =>
                    onUpdateSettings({ ...settings, gamepadDeadzone: Number(e.target.value) })
                  }
                />
              </label>
            </div>

            {/* Audio Buses */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs border-t border-white/10 pt-4">
              {(
                [
                  ['masterVolume', 'Master'],
                  ['musicVolume', 'Music'],
                  ['sfxVolume', 'SFX'],
                  ['voiceVolume', 'Radio'],
                ] as const
              ).map(([field, label]) => (
                <label key={field} className="flex flex-col gap-1">
                  <span className="text-[#a39d8f] flex justify-between">
                    <span>{label}</span>
                    <span className="font-mono-tabular">{Math.round(settings[field] * 100)}%</span>
                  </span>
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.05}
                    value={settings[field]}
                    onChange={(e) =>
                      onUpdateSettings({ ...settings, [field]: Number(e.target.value) })
                    }
                  />
                </label>
              ))}
            </div>

            {/* Key Rebinding */}
            <div className="border-t border-white/10 pt-4">
              <div className="text-xs text-[#a39d8f] mb-2">
                Key Bindings (click a binding and press a new key)
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                {BINDING_LABELS.map((item) => {
                  const isWaiting = rebindingKey === item.key;
                  return (
                    <div
                      key={item.key}
                      className="flex items-center justify-between bg-[#141816] border border-white/10 px-3 py-1.5"
                    >
                      <span className="text-[#d6d3cb]">{item.label}</span>
                      <button
                        type="button"
                        onClick={() => setRebindingKey(item.key)}
                        onKeyDown={(e) => {
                          if (isWaiting) handleRebindKeyDown(e, item.key);
                        }}
                        className={`px-2.5 py-1 font-mono-tabular cursor-pointer ${
                          isWaiting
                            ? 'bg-amber-500 text-[#090b0a] font-bold'
                            : 'bg-[#1f2422] text-[#ece9e2]'
                        }`}
                      >
                        {isWaiting ? 'Press Key...' : settings.keyBindings[item.key]}
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {/* Controls & Credits Panel */}
        {subTab === 'credits' && (
          <div className="bg-[#0e1110]/95 border border-white/15 p-6 space-y-4 max-w-xl text-xs text-[#c4beaf]">
            <div className="flex items-center justify-between border-b border-white/10 pb-3">
              <h2 className="font-display text-2xl uppercase tracking-wide text-[#ece9e2]">
                Controls & Credits
              </h2>
              <button
                type="button"
                onClick={() => setSubTab('none')}
                className="px-4 py-1.5 text-xs font-semibold bg-amber-500 text-[#090b0a] cursor-pointer"
              >
                Back
              </button>
            </div>
            <div className="grid grid-cols-2 gap-2 font-mono-tabular">
              <div>Left Click — Fire Weapon</div>
              <div>Right Click — Aim Down Sights</div>
              <div>WASD — Move · Shift — Sprint</div>
              <div>Space — Jump · C — Crouch</div>
              <div>R — Reload · Q — Swap Weapon</div>
              <div>F — Buy / Door / Repair / Fuse</div>
              <div>V — Knife Melee · G — Frag Grenade</div>
              <div>T — Flashlight · X — Inspect Weapon</div>
              <div>F3 — Perf Overlay · Esc — Pause</div>
            </div>
            <div className="border-t border-white/10 pt-3 space-y-1.5 text-[#9e988a]">
              <p>
                HOLLOWFIELD uses original procedural PBR textures, composite 3D geometry, and Web Audio
                sound synthesis alongside MIT/Apache-2.0 open-source libraries (Three.js, Rapier3D,
                three-mesh-bvh, postprocessing, React).
              </p>
              <p>Typography: Oswald, Plus Jakarta Sans, JetBrains Mono (SIL OFL 1.1).</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
