import { BALANCE, type PerkId } from '../config/balance';
import type { HudSnapshot } from '../game/types';
import { TallyCounter } from './TallyCounter';

interface GameHudProps {
  snap: HudSnapshot;
  onResumePointer: () => void;
}

function PerkSigil({ perkId }: { perkId: PerkId }) {
  const cfg = BALANCE.perks.list[perkId];
  return (
    <div
      className="flex items-center gap-1.5 px-2 py-1 bg-[#111413]/90 border border-white/10"
      title={`${cfg.name}: ${cfg.shortDesc}`}
    >
      <span
        className="inline-block w-2.5 h-2.5 rotate-45 shrink-0"
        style={{ backgroundColor: cfg.accentHex }}
      />
      <span className="text-[11px] font-medium text-[#e4dfd5] tracking-wide whitespace-nowrap">
        {cfg.name.split(' ')[0]}
      </span>
    </div>
  );
}

export function GameHud({ snap, onResumePointer }: GameHudProps) {
  const activeWeapon = snap.weapons[snap.activeSlot] ?? snap.weapons[0];
  const healthRatio = snap.health / Math.max(1, snap.maxHealth);
  const lowHealth = healthRatio < 0.42;

  return (
    <div className="fixed inset-0 pointer-events-none z-10 select-none">
      {/* Low-health & reactive damage blood vignette */}
      {(lowHealth || snap.damageFlash > 0.02) && (
        <div
          className="fixed inset-0 transition-opacity duration-100"
          style={{
            opacity: Math.max(
              lowHealth ? Math.min(0.85, (0.42 - healthRatio) * 2.2) : 0,
              Math.min(0.9, snap.damageFlash * 0.85),
            ),
            background:
              'radial-gradient(circle at center, transparent 42%, rgba(135, 14, 14, 0.78) 100%)',
          }}
        />
      )}

      {/* Top-Left: Sector, Power, Hostiles, Easter Egg & Early Objective */}
      <div className="fixed top-5 left-6 flex flex-col gap-1.5 max-w-[310px]">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs tracking-wider uppercase text-[#c4beaf] bg-[#0d100f]/78 px-2.5 py-1 border border-white/10">
          <span className="font-semibold text-[#ece9e2]">{snap.currentZoneLabel}</span>
          <span aria-hidden="true">·</span>
          <span className={snap.powerOn ? 'text-emerald-400' : 'text-amber-400'}>
            {snap.powerOn ? 'Power Online' : 'Power Offline'}
          </span>
          <span aria-hidden="true">·</span>
          <span className="text-[#ece9e2] font-mono-tabular">
            Hostiles {snap.zombiesRemaining}
          </span>
          {snap.easterEggStep >= 1 && snap.easterEggStep < 4 && (
            <>
              <span aria-hidden="true">·</span>
              <span className="text-amber-300 tabular-nums">
                {snap.easterEggStep === 1 && `Fuses ${snap.fusesCollected}/3`}
                {snap.easterEggStep === 2 && 'Radio Ready'}
                {snap.easterEggStep === 3 && `Transmitting ${snap.radioDefendRemaining}s`}
              </span>
            </>
          )}
        </div>
        {snap.objectiveHint && (
          <p className="text-[11px] text-[#a8a295] leading-snug bg-[#0d100f]/82 px-2.5 py-1.5 border border-white/10">
            {snap.objectiveHint}
          </p>
        )}
      </div>

      {/* Top-Right: F3 Performance Overlay */}
      {snap.showDebug && (
        <div className="fixed top-5 right-6 bg-[#0a0c0b]/92 border border-white/15 px-3.5 py-2.5 font-mono-tabular text-[11px] text-[#d6d3cb] space-y-0.5">
          <div className="flex justify-between gap-6">
            <span className="text-[#8d877a]">FPS / Frame</span>
            <span>
              {snap.perf.fps} ({snap.perf.frameTimeMs} ms)
            </span>
          </div>
          <div className="flex justify-between gap-6">
            <span className="text-[#8d877a]">Draw Calls</span>
            <span>{snap.perf.drawCalls}</span>
          </div>
          <div className="flex justify-between gap-6">
            <span className="text-[#8d877a]">Triangles</span>
            <span>{snap.perf.triangles.toLocaleString()}</span>
          </div>
          <div className="flex justify-between gap-6">
            <span className="text-[#8d877a]">Zombies Alive</span>
            <span>{snap.perf.zombieCount}</span>
          </div>
          <div className="flex justify-between gap-6">
            <span className="text-[#8d877a]">AI Tick</span>
            <span>{snap.perf.aiTickMs} ms</span>
          </div>
          {snap.perf.memoryMb > 0 && (
            <div className="flex justify-between gap-6">
              <span className="text-[#8d877a]">JS Heap</span>
              <span>{snap.perf.memoryMb} MB</span>
            </div>
          )}
        </div>
      )}

      {/* Top-Center: Round Banner & Radio Transmissions */}
      <div className="fixed top-5 left-1/2 -translate-x-1/2 flex flex-col items-center gap-2 text-center max-w-[460px]">
        {snap.roundBannerText && (
          <div className="font-display text-3xl tracking-[0.18em] uppercase text-[#ece9e2] px-6 py-1.5 bg-[#0a0c0b]/82 border border-white/10">
            {snap.roundBannerText}
          </div>
        )}
        {snap.radioMessage && (
          <div className="text-xs text-[#e5decb] bg-[#0e1210]/92 border border-amber-500/35 px-4 py-1.5">
            {snap.radioMessage}
          </div>
        )}
      </div>

      {/* Active Power-Up Timers */}
      {snap.activePowerUps.length > 0 && (
        <div className="fixed top-28 left-1/2 -translate-x-1/2 flex items-center gap-3">
          {snap.activePowerUps.map((pu) => (
            <div
              key={pu.id}
              className="px-3 py-1 bg-[#111413]/90 border border-amber-400/35 text-xs font-mono-tabular text-amber-300"
            >
              {pu.label} · {Math.ceil(pu.remaining)}s
            </div>
          ))}
        </div>
      )}

      {/* Longbow Marksman Scope Vignette when ADS */}
      {snap.isAds && snap.activeWeaponId === 'longbow' && !snap.isReviving && (
        <div
          className="fixed inset-0 pointer-events-none"
          style={{
            background:
              'radial-gradient(circle at center, transparent 27%, rgba(5, 7, 6, 0.84) 44%, rgba(4, 5, 5, 0.96) 100%)',
          }}
        />
      )}

      {/* Center Tactical Crosshair ("Cross Aim") & Hit Markers */}
      <div className="fixed inset-0 flex items-center justify-center">
        {!snap.isReviving && (() => {
          const isScoped = snap.isAds && snap.activeWeaponId === 'longbow';
          const gap = snap.isAds
            ? 5
            : Math.round(7 + (snap.crosshairSpread ?? 0.25) * 18);
          const prongLen = snap.isAds ? 5 : 9;

          if (isScoped) {
            return (
              <div data-testid="crosshair" className="relative w-64 h-64 flex items-center justify-center">
                <span className="absolute left-0 right-0 top-1/2 -translate-y-1/2 h-[1px] bg-black/80" />
                <span className="absolute top-0 bottom-0 left-1/2 -translate-x-1/2 w-[1px] bg-black/80" />
                <span className="absolute left-12 right-12 top-1/2 -translate-y-1/2 h-[1px] bg-amber-300/70" />
                <span className="absolute top-12 bottom-12 left-1/2 -translate-x-1/2 w-[1px] bg-amber-300/70" />
                <span className="w-1.5 h-1.5 rounded-full bg-amber-400 shadow-[0_0_6px_rgba(251,191,36,0.95)]" />
              </div>
            );
          }

          return (
            <div data-testid="crosshair" className="relative w-20 h-20 flex items-center justify-center">
              {/* High-contrast precision center dot */}
              <span
                className={`w-[3px] h-[3px] rounded-full shadow-[0_0_2px_rgba(0,0,0,0.95),0_0_4px_rgba(0,0,0,0.85)] ${
                  snap.isAds ? 'bg-amber-300' : 'bg-white'
                }`}
              />
              {/* Top prong */}
              <span
                className="absolute left-1/2 -translate-x-1/2 w-[2px] bg-white/95 shadow-[0_0_2px_rgba(0,0,0,0.95)] transition-[bottom] duration-75"
                style={{ height: prongLen, bottom: `calc(50% + ${gap}px)` }}
              />
              {/* Bottom prong */}
              <span
                className="absolute left-1/2 -translate-x-1/2 w-[2px] bg-white/95 shadow-[0_0_2px_rgba(0,0,0,0.95)] transition-[top] duration-75"
                style={{ height: prongLen, top: `calc(50% + ${gap}px)` }}
              />
              {/* Left prong */}
              <span
                className="absolute top-1/2 -translate-y-1/2 h-[2px] bg-white/95 shadow-[0_0_2px_rgba(0,0,0,0.95)] transition-[right] duration-75"
                style={{ width: prongLen, right: `calc(50% + ${gap}px)` }}
              />
              {/* Right prong */}
              <span
                className="absolute top-1/2 -translate-y-1/2 h-[2px] bg-white/95 shadow-[0_0_2px_rgba(0,0,0,0.95)] transition-[left] duration-75"
                style={{ width: prongLen, left: `calc(50% + ${gap}px)` }}
              />
            </div>
          );
        })()}

        {snap.hitMarkerAlpha > 0 && snap.hitMarkerType !== 'none' && (
          <svg
            width={snap.hitMarkerType === 'headshot' ? 34 : 28}
            height={snap.hitMarkerType === 'headshot' ? 34 : 28}
            viewBox="0 0 28 28"
            className="absolute"
            style={{ opacity: snap.hitMarkerAlpha }}
          >
            <g
              stroke={
                snap.hitMarkerType === 'headshot'
                  ? '#f59e0b'
                  : snap.hitMarkerType === 'kill'
                    ? '#ef4444'
                    : '#ffffff'
              }
              strokeWidth={snap.hitMarkerType === 'headshot' ? '2.6' : '2.2'}
              strokeLinecap="round"
            >
              <line x1="4" y1="4" x2="10" y2="10" />
              <line x1="24" y1="4" x2="18" y2="10" />
              <line x1="4" y1="24" x2="10" y2="18" />
              <line x1="24" y1="24" x2="18" y2="18" />
            </g>
          </svg>
        )}

        {snap.hitMarkerAlpha > 0 && snap.hitMarkerType === 'headshot' && (
          <div
            className="absolute top-[53.5%] text-[10px] font-bold tracking-[0.22em] uppercase text-amber-400 drop-shadow-[0_1px_2px_rgba(0,0,0,0.95)]"
            style={{ opacity: snap.hitMarkerAlpha }}
          >
            HEADSHOT
          </div>
        )}

        {/* Directional Damage Indicator */}
        {snap.damageIndicatorAlpha > 0 && snap.damageIndicatorAngle !== null && (
          <div
            className="absolute w-36 h-36"
            style={{
              opacity: snap.damageIndicatorAlpha,
              transform: `rotate(${snap.damageIndicatorAngle}rad)`,
            }}
          >
            <div className="mx-auto w-12 h-2 bg-red-600/85" />
          </div>
        )}

        {/* Crisp center-offset kill & headshot score callouts */}
        {snap.pointDeltas.some((d) => d.reason !== 'Hit') && (
          <div className="absolute left-[54%] top-[47%] flex flex-col items-start gap-0.5">
            {snap.pointDeltas
              .filter((d) => d.reason !== 'Hit')
              .slice(-3)
              .map((d) => (
                <div
                  key={d.id}
                  className={`font-mono-tabular text-[11px] font-bold tracking-wider uppercase drop-shadow-[0_1px_2px_rgba(0,0,0,0.95)] ${
                    d.reason === 'Headshot'
                      ? 'text-amber-300'
                      : d.reason === 'Melee Kill'
                        ? 'text-emerald-300'
                        : 'text-[#f3efe6]'
                  }`}
                >
                  +{d.amount} {d.reason}
                </div>
              ))}
          </div>
        )}
      </div>

      {/* Reload / Low-Ammo / Revive Center Bars */}
      {snap.isReloading && (
        <div className="fixed top-[57%] left-1/2 -translate-x-1/2 w-36">
          <div className="text-[10px] uppercase tracking-widest text-center text-[#d6d3cb] mb-1">
            Reloading
          </div>
          <div className="h-1 bg-black/70 overflow-hidden">
            <div
              className="h-full bg-amber-400"
              style={{ width: `${Math.round(snap.reloadProgress * 100)}%` }}
            />
          </div>
        </div>
      )}

      {!snap.isReloading && activeWeapon && activeWeapon.mag === 0 && activeWeapon.reserve > 0 && (
        <div className="fixed top-[57%] left-1/2 -translate-x-1/2 text-[11px] font-semibold uppercase tracking-[0.16em] text-red-400 bg-[#0a0c0b]/80 border border-red-500/40 px-2.5 py-0.5">
          [R] Reload
        </div>
      )}

      {snap.isReviving && (
        <div className="fixed top-[58%] left-1/2 -translate-x-1/2 w-56 bg-[#0d100f]/92 border border-sky-400/40 p-3 text-center">
          <div className="text-xs font-semibold uppercase tracking-wider text-sky-300 mb-1.5">
            Second Wind Reviving
          </div>
          <div className="h-1.5 bg-black/80 overflow-hidden">
            <div
              className="h-full bg-sky-400"
              style={{ width: `${Math.round(snap.reviveProgress * 100)}%` }}
            />
          </div>
        </div>
      )}

      {/* Interact Prompt */}
      {snap.interactPrompt && (
        <div className="fixed bottom-32 left-1/2 -translate-x-1/2 bg-[#0d100f]/92 border border-white/15 px-5 py-2.5 text-center min-w-[260px]">
          <div className="text-sm font-semibold text-[#ece9e2]">
            [F] {snap.interactPrompt.title}
            {snap.interactPrompt.cost !== null && (
              <span
                className={`ml-2 font-mono-tabular ${
                  snap.interactPrompt.canAfford ? 'text-amber-400' : 'text-red-400'
                }`}
              >
                {snap.interactPrompt.cost} PTS
              </span>
            )}
          </div>
          <div
            className={`text-xs mt-0.5 ${
              snap.interactPrompt.blockedReason
                ? 'text-red-400'
                : !snap.interactPrompt.canAfford
                  ? 'text-red-400'
                  : 'text-[#a39d8f]'
            }`}
          >
            {snap.interactPrompt.blockedReason ??
              (!snap.interactPrompt.canAfford
                ? 'Insufficient Points'
                : snap.interactPrompt.subtitle)}
          </div>
          {snap.interactPrompt.progress > 0 && (
            <div className="h-1 bg-black/70 mt-2">
              <div
                className="h-full bg-amber-400"
                style={{ width: `${Math.round(snap.interactPrompt.progress * 100)}%` }}
              />
            </div>
          )}
        </div>
      )}

      {/* Click-to-capture or fallback aim hint when pointer isn't locked */}
      {!snap.pointerLocked && snap.screen === 'playing' && (
        <div
          className={`fixed ${snap.interactPrompt ? 'bottom-52' : 'bottom-6'} left-1/2 -translate-x-1/2 ${
            snap.pointerLockBlocked ? 'pointer-events-none' : 'pointer-events-auto'
          }`}
        >
          {snap.pointerLockBlocked ? (
            <div className="px-3 py-1 text-[11px] font-medium bg-[#0e1110]/85 border border-amber-500/25 text-amber-200/90 whitespace-nowrap">
              Mouse / RMB / Arrows to Aim · Esc Pause
            </div>
          ) : (
            <button
              type="button"
              onClick={onResumePointer}
              className="px-4 py-1.5 text-xs font-medium bg-[#151917]/95 border border-amber-500/40 text-amber-200 hover:bg-[#1e2421]"
            >
              Click Viewport to Lock Mouse Aim · Esc to Pause
            </button>
          )}
        </div>
      )}

      {/* Bottom-Left: Tally Round Counter, Health & Perks */}
      <div className="fixed bottom-5 left-6 flex flex-col gap-2.5">
        {snap.perks.length > 0 && (
          <div className="flex items-center gap-2">
            {snap.perks.map((p) => (
              <PerkSigil key={p} perkId={p} />
            ))}
          </div>
        )}

        <div className="flex items-end gap-5 bg-[#0c0e0d]/88 border border-white/10 px-4 py-3">
          <TallyCounter round={snap.round} isHoundRound={snap.isHoundRound} />

          <div className="w-40">
            <div className="flex items-center justify-between text-xs mb-1">
              <span className="text-[#9e988a] uppercase tracking-wider">Vitality</span>
              <span className="font-mono-tabular font-semibold text-[#ece9e2]">
                {snap.health}/{snap.maxHealth}
              </span>
            </div>
            <div className="h-2 bg-black/70 overflow-hidden">
              <div
                className={`h-full transition-all duration-100 ${
                  lowHealth ? 'bg-red-500' : 'bg-[#d4cec0]'
                }`}
                style={{ width: `${Math.round(healthRatio * 100)}%` }}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Bottom-Right: Points, Deltas, Weapon & Ammo */}
      <div className="fixed bottom-5 right-6 flex flex-col items-end gap-2">
        {/* Float-up point deltas */}
        <div className="flex flex-col items-end gap-0.5 min-h-[24px]">
          {snap.pointDeltas.map((d) => (
            <div
              key={d.id}
              className="font-mono-tabular text-xs font-semibold text-amber-400"
            >
              +{d.amount} {d.reason}
            </div>
          ))}
        </div>

        <div className="bg-[#0c0e0d]/88 border border-white/10 px-4 py-3 min-w-[240px]">
          <div className="flex items-baseline justify-between gap-6 border-b border-white/10 pb-2 mb-2">
            <span className="text-xs uppercase tracking-wider text-[#9e988a]">Points</span>
            <span className="font-mono-tabular text-2xl font-bold text-amber-400">
              {snap.points.toLocaleString()}
            </span>
          </div>

          {activeWeapon && (
            <div className="flex items-baseline justify-between gap-5">
              <div className="flex flex-col">
                <div className="flex items-center gap-2">
                  <span
                    className={`font-display text-lg tracking-wide uppercase leading-tight ${
                      activeWeapon.upgraded ? 'text-sky-300' : 'text-[#ece9e2]'
                    }`}
                  >
                    {activeWeapon.name}
                  </span>
                  {activeWeapon.upgraded && (
                    <span className="text-[10px] font-mono-tabular uppercase tracking-wider px-1.5 py-0.5 bg-sky-500/20 border border-sky-400/40 text-sky-300">
                      OC
                    </span>
                  )}
                </div>
                <span className="text-[11px] text-[#8d877a]">
                  Slot {snap.activeSlot + 1}/{snap.weapons.length} · Frag {snap.grenades}/
                  {snap.maxGrenades} · [T] Torch {snap.flashlightOn ? 'ON' : 'OFF'} · [X] Inspect
                </span>
              </div>
              <div
                className={`font-mono-tabular text-2xl font-bold ${
                  activeWeapon.mag === 0
                    ? 'text-red-400'
                    : activeWeapon.mag <= Math.max(1, Math.ceil(activeWeapon.magSize * 0.25))
                      ? 'text-amber-400'
                      : 'text-[#ece9e2]'
                }`}
              >
                {activeWeapon.mag}
                <span className="text-sm text-[#8d877a] font-normal">
                  /{activeWeapon.reserve}
                </span>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
