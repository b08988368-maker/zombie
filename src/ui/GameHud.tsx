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
      {/* Low-health blood vignette */}
      {lowHealth && (
        <div
          className="fixed inset-0 transition-opacity duration-200"
          style={{
            opacity: Math.min(0.85, (0.42 - healthRatio) * 2.2),
            background:
              'radial-gradient(circle at center, transparent 48%, rgba(125, 14, 14, 0.72) 100%)',
          }}
        />
      )}

      {/* Top-Left: Sector, Power, Easter Egg & Early Objective */}
      <div className="fixed top-5 left-6 flex flex-col gap-1.5 max-w-[265px]">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs tracking-wider uppercase text-[#c4beaf]">
          <span className="font-semibold text-[#ece9e2]">{snap.currentZoneLabel}</span>
          <span aria-hidden="true">·</span>
          <span className={snap.powerOn ? 'text-emerald-400' : 'text-amber-400'}>
            {snap.powerOn ? 'Power Online' : 'Power Offline'}
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

      {/* Center Crosshair & Hit Markers */}
      <div className="fixed inset-0 flex items-center justify-center">
        {!snap.isAds && !snap.isReviving && (
          <div className="relative w-8 h-8">
            <span
              className="absolute left-1/2 -translate-x-1/2 w-[2px] h-2 bg-white/80"
              style={{ top: snap.isSprinting ? -2 : 2 }}
            />
            <span
              className="absolute left-1/2 -translate-x-1/2 w-[2px] h-2 bg-white/80"
              style={{ bottom: snap.isSprinting ? -2 : 2 }}
            />
            <span
              className="absolute top-1/2 -translate-y-1/2 h-[2px] w-2 bg-white/80"
              style={{ left: snap.isSprinting ? -2 : 2 }}
            />
            <span
              className="absolute top-1/2 -translate-y-1/2 h-[2px] w-2 bg-white/80"
              style={{ right: snap.isSprinting ? -2 : 2 }}
            />
          </div>
        )}

        {snap.hitMarkerAlpha > 0 && snap.hitMarkerType !== 'none' && (
          <svg
            width="28"
            height="28"
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
              strokeWidth="2.2"
              strokeLinecap="round"
            >
              <line x1="5" y1="5" x2="10" y2="10" />
              <line x1="23" y1="5" x2="18" y2="10" />
              <line x1="5" y1="23" x2="10" y2="18" />
              <line x1="23" y1="23" x2="18" y2="18" />
            </g>
          </svg>
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
      </div>

      {/* Reload / Revive Center Bars */}
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

      {/* Click-to-capture hint when pointer isn't locked */}
      {!snap.pointerLocked && snap.screen === 'playing' && (
        <div className="fixed bottom-44 left-1/2 -translate-x-1/2 pointer-events-auto">
          <button
            type="button"
            onClick={onResumePointer}
            className="px-4 py-2 text-xs font-medium bg-[#151917]/95 border border-amber-500/40 text-amber-200 hover:bg-[#1e2421]"
          >
            Click Viewport to Lock Mouse Aim · Esc to Pause
          </button>
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
                  {snap.maxGrenades}
                </span>
              </div>
              <div className="font-mono-tabular text-2xl font-bold text-[#ece9e2]">
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
