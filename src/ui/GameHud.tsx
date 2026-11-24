import { BALANCE, type PerkId } from '../config/balance';
import type { HudSnapshot } from '../game/types';
import { TallyCounter } from './TallyCounter';

interface GameHudProps {
  snap: HudSnapshot;
  onResumePointer: () => void;
}

function PerkIconPath({ perkId }: { perkId: PerkId }) {
  switch (perkId) {
    case 'ironhide':
      // Shield + cross
      return (
        <>
          <path d="M12 3.5L5.5 6.5V12c0 4.2 2.8 7.5 6.5 8.8 3.7-1.3 6.5-4.6 6.5-8.8V6.5L12 3.5z" fill="currentColor" fillOpacity="0.22" stroke="currentColor" strokeWidth="1.6" />
          <path d="M12 8.2v6.6M8.7 11.5h6.6" stroke="#ffffff" strokeWidth="1.9" strokeLinecap="round" />
        </>
      );
    case 'second_wind':
      // Winged revive cross / heart
      return (
        <>
          <path d="M12 19.2s-6.4-4-6.4-8.7a3.6 3.6 0 0 1 6.4-2.2 3.6 3.6 0 0 1 6.4 2.2c0 4.7-6.4 8.7-6.4 8.7z" fill="currentColor" fillOpacity="0.3" stroke="currentColor" strokeWidth="1.5" />
          <path d="M12 9.4v4.6M9.7 11.7h4.6" stroke="#ffffff" strokeWidth="1.7" strokeLinecap="round" />
        </>
      );
    case 'quickhands':
      // Lightning bolt reload
      return (
        <path d="M13.5 3.8L7.2 12.6h4.4l-1.1 7.6 6.5-8.9h-4.5l1-7.5z" fill="currentColor" stroke="#ffffff" strokeWidth="1.2" strokeLinejoin="round" />
      );
    case 'twin_barrel':
      // Twin bullets
      return (
        <>
          <path d="M8.5 18.5V9.5c0-1.9 1.3-4.2 1.3-4.2s1.3 2.3 1.3 4.2v9h-2.6zM13.4 18.5V9.5c0-1.9 1.3-4.2 1.3-4.2s1.3 2.3 1.3 4.2v9h-2.6z" fill="currentColor" stroke="#ffffff" strokeWidth="1.1" />
        </>
      );
    case 'marathon':
      // Winged sprint chevron
      return (
        <path d="M5.5 16.5l4.2-4.5-3.2-2 6.8-4.5 2.1 2.2-3.4 2.5 4.8 3.2-2.6 3.1H5.5z" fill="currentColor" stroke="#ffffff" strokeWidth="1.1" strokeLinejoin="round" />
      );
  }
}

function PerkSigil({ perkId }: { perkId: PerkId }) {
  const cfg = BALANCE.perks.list[perkId];
  return (
    <div
      className="relative flex items-center justify-center w-9 h-9 rounded-full border shadow-[0_2px_10px_rgba(0,0,0,0.9)]"
      style={{
        borderColor: `${cfg.accentHex}cc`,
        background: `radial-gradient(circle at 32% 30%, ${cfg.accentHex}55, #0a0c0b 82%)`,
        color: cfg.accentHex,
        boxShadow: `0 0 12px ${cfg.accentHex}44, inset 0 1px 2px rgba(255,255,255,0.22)`,
      }}
      title={`${cfg.name}: ${cfg.shortDesc}`}
    >
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <PerkIconPath perkId={perkId} />
      </svg>
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

      {/* Top-Left: Sector Status + 6-Chapter Campaign Mission Tracker (max-w-[332px] keeps ~190px clearance before top-center at 1280x720) */}
      <div className="fixed top-5 left-6 flex flex-col gap-1.5 max-w-[332px]">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] tracking-[0.14em] uppercase text-[#c4beaf] border-l-2 border-amber-500/75 bg-gradient-to-r from-[#090b0a]/85 via-[#090b0a]/50 to-transparent pl-3 pr-5 py-1.5">
          <span className="font-semibold text-[#ece9e2]">{snap.currentZoneLabel}</span>
          <span aria-hidden="true" className="text-white/30">/</span>
          <span className={snap.powerOn ? 'text-emerald-400' : 'text-amber-400'}>
            {snap.powerOn ? 'Power Online' : 'Power Offline'}
          </span>
          <span aria-hidden="true" className="text-white/30">/</span>
          <span className="text-[#ece9e2] font-mono-tabular">
            {snap.zombiesRemaining} Hostiles
          </span>
        </div>

        {snap.campaign && (
          <div className="bg-gradient-to-r from-[#090b0a]/88 via-[#090b0a]/65 to-[#090b0a]/20 border-l-2 border-sky-400/80 pl-3 pr-3.5 py-2 space-y-1 shadow-[0_4px_14px_rgba(0,0,0,0.55)]">
            <div className="flex items-center justify-between gap-2 text-[10px] font-mono-tabular uppercase tracking-[0.1em]">
              <span className="text-sky-300 font-semibold min-w-0 truncate">
                {snap.campaign.endlessMode
                  ? 'Endless Survival'
                  : `CH ${snap.campaign.chapter}/${snap.campaign.totalChapters} · ${snap.campaign.chapterTitle}`}
              </span>
              <span className="text-amber-300 shrink-0 whitespace-nowrap">{snap.campaign.progressText}</span>
            </div>

            <div className="flex items-center justify-between gap-2.5">
              <p className="text-xs font-semibold text-[#f3efe6] leading-snug">
                {snap.campaign.instruction}
              </p>
              {snap.campaign.targetDistance !== null && snap.campaign.targetBearingRad !== null && (
                <div className="flex items-center gap-1 shrink-0 bg-[#121614]/90 border border-sky-400/35 px-1.5 py-0.5 text-[11px] font-mono-tabular text-sky-200">
                  <svg
                    width="13"
                    height="13"
                    viewBox="0 0 16 16"
                    className="text-amber-400 transition-transform duration-75"
                    style={{ transform: `rotate(${snap.campaign.targetBearingRad}rad)` }}
                    aria-hidden="true"
                  >
                    <path d="M8 1.5L13 13.5L8 10.8L3 13.5Z" fill="currentColor" />
                  </svg>
                  <span>{snap.campaign.targetDistance}m</span>
                </div>
              )}
            </div>

            <p className="text-[11px] text-[#b4ad9f] leading-snug">
              {snap.campaign.detail}
            </p>
          </div>
        )}

        {!snap.campaign && snap.objectiveHint && (
          <p className="text-[11px] text-[#b8b1a3] leading-snug pl-3.5 pr-4 py-0.5 drop-shadow-[0_1px_3px_rgba(0,0,0,0.95)]">
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

      {/* Top-Center: Dramatic Unboxed Round Banner, Boss Health Bar & Radio Transmissions */}
      <div className="fixed top-5 left-1/2 -translate-x-1/2 flex flex-col items-center gap-2 text-center max-w-[460px] pointer-events-none">
        {snap.boss && (
          <div data-testid="boss-bar" className="w-[360px] bg-[#0a0c0b]/88 border border-red-500/45 px-4 py-2 shadow-[0_6px_22px_rgba(0,0,0,0.85)]">
            <div className="flex items-center justify-between text-[11px] font-mono-tabular uppercase tracking-[0.16em] mb-1">
              <span className="text-red-300 font-bold">{snap.boss.name}</span>
              <span className="text-amber-300">
                {snap.boss.health.toLocaleString()} / {snap.boss.maxHealth.toLocaleString()}
              </span>
            </div>
            <div className="h-2 bg-black/85 overflow-hidden border border-white/10">
              <div
                className="h-full bg-gradient-to-r from-red-600 via-orange-500 to-amber-400 transition-all duration-100"
                style={{
                  width: `${Math.max(0, Math.min(100, (snap.boss.health / Math.max(1, snap.boss.maxHealth)) * 100))}%`,
                }}
              />
            </div>
          </div>
        )}
        {snap.roundBannerText && (
          <div className="flex flex-col items-center gap-1 px-8 py-1">
            <div
              className="font-display text-4xl font-bold tracking-[0.26em] uppercase text-[#ece9e2]"
              style={{
                textShadow: snap.isHoundRound
                  ? '0 0 22px rgba(234, 179, 8, 0.7), 0 3px 10px rgba(0,0,0,0.95)'
                  : '0 0 22px rgba(185, 28, 28, 0.78), 0 3px 10px rgba(0,0,0,0.95)',
              }}
            >
              {snap.roundBannerText}
            </div>
            <div
              className={`w-64 h-[1px] bg-gradient-to-r from-transparent ${
                snap.isHoundRound ? 'via-amber-400/80' : 'via-red-600/85'
              } to-transparent`}
            />
          </div>
        )}
        {snap.radioMessage && (
          <div className="text-xs text-[#ece6d8] bg-gradient-to-r from-transparent via-[#0c0f0e]/90 to-transparent border-y border-amber-500/35 px-8 py-1.5 drop-shadow-[0_2px_6px_rgba(0,0,0,0.95)]">
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
              className="px-3 py-1 bg-[#0b0e0d]/78 border-b-2 border-amber-400/70 text-[11px] font-mono-tabular uppercase tracking-wider text-amber-300 shadow-[0_2px_10px_rgba(0,0,0,0.8)]"
            >
              {pu.label} · {Math.ceil(pu.remaining)}s
            </div>
          ))}
        </div>
      )}

      {/* Power-Up Collector Announcer Banner */}
      {snap.powerUpBanner && (
        <div className="fixed top-[20%] left-1/2 -translate-x-1/2 flex flex-col items-center pointer-events-none">
          <div
            className="font-display text-4xl font-bold tracking-[0.26em] uppercase px-10 py-1"
            style={{
              color: snap.powerUpBanner.colorHex,
              textShadow: `0 0 24px ${snap.powerUpBanner.colorHex}88, 0 3px 10px rgba(0,0,0,0.95)`,
            }}
          >
            {snap.powerUpBanner.label}
          </div>
          <div
            className="w-56 h-[1px]"
            style={{
              background: `linear-gradient(to right, transparent, ${snap.powerUpBanner.colorHex}aa, transparent)`,
            }}
          />
        </div>
      )}

      {/* Tactical Sprint-Slide kinetic edge vignette */}
      {snap.isSliding && !snap.isAds && !snap.isReviving && (
        <div
          className="fixed inset-0 pointer-events-none"
          style={{
            background:
              'radial-gradient(ellipse at center, transparent 58%, rgba(236, 233, 226, 0.1) 86%, rgba(12, 16, 14, 0.44) 100%)',
          }}
        />
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
          const adsMix = snap.adsBlend ?? (snap.isAds ? 1 : 0);
          const gap = snap.isAds
            ? 5
            : Math.round((7 + (snap.crosshairSpread ?? 0.25) * 18) * (1 - adsMix * 0.45));
          const prongLen = snap.isAds ? 5 : 9;

          if (isScoped) {
            return (
              <div data-testid="crosshair" className="relative w-64 h-64 flex items-center justify-center">
                <span className="absolute left-0 right-0 top-1/2 -translate-y-1/2 h-[1px] bg-black/85" />
                <span className="absolute top-0 bottom-0 left-1/2 -translate-x-1/2 w-[1px] bg-black/85" />
                <span className="absolute left-12 right-12 top-1/2 -translate-y-1/2 h-[1px] bg-amber-300/75" />
                <span className="absolute top-12 bottom-12 left-1/2 -translate-x-1/2 w-[1px] bg-amber-300/75" />
                {/* Calibrated Mil-Dot Stadia Marks */}
                <span className="absolute left-16 top-1/2 -translate-y-1/2 w-[1px] h-2 bg-amber-300/80" />
                <span className="absolute left-24 top-1/2 -translate-y-1/2 w-[1px] h-1.5 bg-amber-300/65" />
                <span className="absolute right-24 top-1/2 -translate-y-1/2 w-[1px] h-1.5 bg-amber-300/65" />
                <span className="absolute right-16 top-1/2 -translate-y-1/2 w-[1px] h-2 bg-amber-300/80" />
                <span className="absolute top-16 left-1/2 -translate-x-1/2 h-[1px] w-2 bg-amber-300/80" />
                <span className="absolute top-24 left-1/2 -translate-x-1/2 h-[1px] w-1.5 bg-amber-300/65" />
                <span className="absolute bottom-24 left-1/2 -translate-x-1/2 h-[1px] w-1.5 bg-amber-300/65" />
                <span className="absolute bottom-16 left-1/2 -translate-x-1/2 h-[1px] w-2 bg-amber-300/80" />
                <span
                  className={`w-1.5 h-1.5 rounded-full ${
                    snap.isHoldingBreath
                      ? 'bg-emerald-300 shadow-[0_0_8px_rgba(52,211,153,0.98)]'
                      : 'bg-amber-400 shadow-[0_0_6px_rgba(251,191,36,0.95)]'
                  }`}
                />
                <span
                  className={`absolute -bottom-6 font-mono-tabular text-[10px] tracking-[0.18em] uppercase drop-shadow-[0_1px_2px_rgba(0,0,0,0.95)] ${
                    snap.isHoldingBreath ? 'text-emerald-300' : 'text-amber-200/80'
                  }`}
                >
                  {snap.isHoldingBreath ? 'BREATH STEADY' : '[SHIFT] HOLD BREATH'}
                </span>
              </div>
            );
          }

          if (snap.isAds || adsMix > 0.72) {
            return (
              <div data-testid="crosshair" className="relative w-8 h-8 flex items-center justify-center">
                <span className="w-[3px] h-[3px] rounded-full bg-amber-300 shadow-[0_0_5px_rgba(251,191,36,0.95)]" />
                <span className="absolute left-1/2 -translate-x-1/2 w-[1px] h-[3px] bg-white/35 top-0" />
                <span className="absolute left-1/2 -translate-x-1/2 w-[1px] h-[3px] bg-white/35 bottom-0" />
                <span className="absolute top-1/2 -translate-y-1/2 h-[1px] w-[3px] bg-white/35 left-0" />
                <span className="absolute top-1/2 -translate-y-1/2 h-[1px] w-[3px] bg-white/35 right-0" />
              </div>
            );
          }

          return (
            <div data-testid="crosshair" className="relative w-20 h-20 flex items-center justify-center">
              {/* High-contrast precision center dot */}
              <span className="w-[3px] h-[3px] rounded-full bg-white shadow-[0_0_2px_rgba(0,0,0,0.95),0_0_4px_rgba(0,0,0,0.85)]" />
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

        {/* Off-screen Flanking Threat Warning Chevrons (up to 3 nearest flanking/attacking hostiles) */}
        {!snap.isReviving &&
          (snap.offscreenThreats && snap.offscreenThreats.length > 0
            ? snap.offscreenThreats
            : snap.offscreenThreat
              ? [{ id: 0, angle: snap.offscreenThreat.angle, urgency: snap.offscreenThreat.urgency, isAttacking: snap.offscreenThreat.urgency > 0.65 }]
              : []
          ).map((threat) => (
            <div
              key={threat.id}
              className="absolute w-64 h-64 pointer-events-none transition-transform duration-75"
              style={{
                opacity: Math.min(0.98, 0.45 + threat.urgency * 0.55),
                transform: `rotate(${threat.angle}rad)`,
              }}
            >
              <svg
                width={threat.isAttacking ? 62 : 54}
                height={threat.isAttacking ? 26 : 24}
                viewBox="0 0 54 24"
                className={`mx-auto ${
                  threat.isAttacking || threat.urgency > 0.65
                    ? 'drop-shadow-[0_0_10px_rgba(255,69,58,0.98)]'
                    : 'drop-shadow-[0_0_8px_rgba(245,158,11,0.9)]'
                }`}
              >
                <path
                  d="M7 18 L27 5 L47 18"
                  fill="none"
                  stroke="#090b0a"
                  strokeWidth="6.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  opacity="0.72"
                />
                <path
                  d="M7 18 L27 5 L47 18"
                  fill="none"
                  stroke={threat.isAttacking || threat.urgency > 0.65 ? '#ff453a' : '#fbbf24'}
                  strokeWidth={threat.isAttacking ? '4.2' : '3.5'}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </div>
          ))}

        {/* Directional Radial Damage Hit Chevrons */}
        {snap.damageIndicators.length > 0
          ? snap.damageIndicators.map((ind) => (
              <div
                key={ind.id}
                className="absolute w-52 h-52 pointer-events-none"
                style={{
                  opacity: Math.min(1, ind.alpha * 1.1),
                  transform: `rotate(${ind.angle}rad)`,
                }}
              >
                <svg
                  width="84"
                  height="32"
                  viewBox="0 0 84 32"
                  className="mx-auto drop-shadow-[0_0_12px_rgba(239,68,68,0.98)]"
                >
                  <path
                    d="M6 25 Q42 4 78 25 L68 29 Q42 12 16 29 Z"
                    fill="#ff3b30"
                    stroke="#fecaca"
                    strokeOpacity="0.55"
                    strokeWidth="1.2"
                  />
                </svg>
              </div>
            ))
          : snap.damageIndicatorAlpha > 0 &&
            snap.damageIndicatorAngle !== null && (
              <div
                className="absolute w-52 h-52 pointer-events-none"
                style={{
                  opacity: Math.min(1, snap.damageIndicatorAlpha * 1.1),
                  transform: `rotate(${snap.damageIndicatorAngle}rad)`,
                }}
              >
                <svg
                  width="84"
                  height="32"
                  viewBox="0 0 84 32"
                  className="mx-auto drop-shadow-[0_0_12px_rgba(239,68,68,0.98)]"
                >
                  <path
                    d="M6 25 Q42 4 78 25 L68 29 Q42 12 16 29 Z"
                    fill="#ff3b30"
                    stroke="#fecaca"
                    strokeOpacity="0.55"
                    strokeWidth="1.2"
                  />
                </svg>
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

      {/* Bloater Proximity Warning & Attributed Damage Callout */}
      {snap.bloaterWarningDist !== null && (
        <div className="fixed top-[63%] left-1/2 -translate-x-1/2 bg-[#1b2209]/92 border border-lime-400/75 px-3.5 py-1 text-[11px] font-mono-tabular font-bold uppercase tracking-[0.16em] text-lime-300 shadow-[0_0_16px_rgba(132,204,22,0.45)] animate-pulse">
          BLOATER RUPTURING · {Math.max(1, Math.round(snap.bloaterWarningDist))}m — TAKE COVER
        </div>
      )}

      {snap.damageCallout && snap.damageCallout.alpha > 0.05 && (
        <div
          data-testid="damage-callout"
          className="fixed bottom-48 left-1/2 -translate-x-1/2 bg-[#1c0909]/90 border border-red-500/65 px-3.5 py-1 text-[11px] font-mono-tabular font-bold uppercase tracking-[0.15em] text-red-200 shadow-[0_2px_12px_rgba(0,0,0,0.9)]"
          style={{ opacity: Math.min(1, snap.damageCallout.alpha) }}
        >
          {snap.damageCallout.text}
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

      {/* Bottom-Left: Unboxed COD Tally Counter, Slim Vitality & Perk Medallions */}
      <div className="fixed bottom-5 left-6 flex flex-col gap-2.5 bg-gradient-to-r from-[#070908]/75 via-[#070908]/35 to-transparent pr-10 py-1.5 pl-1">
        {snap.perks.length > 0 && (
          <div className="flex items-center gap-2">
            {snap.perks.map((p) => (
              <PerkSigil key={p} perkId={p} />
            ))}
          </div>
        )}

        <div className="flex items-end gap-5">
          <TallyCounter round={snap.round} isHoundRound={snap.isHoundRound} />

          <div className="w-36 pb-1">
            <div className="flex items-center justify-between text-[10px] tracking-[0.16em] uppercase mb-1 drop-shadow-[0_1px_2px_rgba(0,0,0,0.95)]">
              <span className="text-[#a8a295]">Vitality</span>
              <span className="font-mono-tabular font-semibold text-[#ece9e2]">
                {snap.health}/{snap.maxHealth}
              </span>
            </div>
            <div className="h-1.5 bg-black/75 overflow-hidden">
              <div
                className={`h-full transition-all duration-100 ${
                  lowHealth ? 'bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.8)]' : 'bg-[#d8d2c5]'
                }`}
                style={{ width: `${Math.round(healthRatio * 100)}%` }}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Bottom-Right: Unboxed COD Points, Weapon Plate & Large Ammo Counter */}
      <div className="fixed bottom-5 right-6 flex flex-col items-end gap-1.5">
        {/* Float-up point deltas stacked cleanly above points */}
        <div className="flex flex-col items-end gap-0.5 min-h-[22px] pr-1">
          {snap.pointDeltas.slice(-5).map((d) => (
            <div
              key={d.id}
              className={`font-mono-tabular text-xs font-semibold drop-shadow-[0_1px_3px_rgba(0,0,0,0.95)] ${
                d.reason === 'Headshot'
                  ? 'text-amber-300'
                  : d.reason === 'Melee Kill'
                    ? 'text-emerald-300'
                    : 'text-amber-400'
              }`}
            >
              +{d.amount} {d.reason}
            </div>
          ))}
        </div>

        <div
          className={`bg-gradient-to-l from-[#070908]/82 via-[#070908]/45 to-transparent border-r-2 ${
            activeWeapon?.upgraded ? 'border-sky-400/80' : 'border-amber-500/80'
          } pl-12 pr-4 py-2.5 min-w-[270px] flex flex-col items-end gap-1.5`}
        >
          {/* Points Score */}
          <div className="flex items-baseline gap-3">
            <span className="text-[10px] uppercase tracking-[0.2em] text-[#9e988a]">Points</span>
            <span
              className="font-mono-tabular text-3xl font-bold text-amber-400 leading-none"
              style={{ textShadow: '0 0 14px rgba(245, 158, 11, 0.35), 0 2px 6px rgba(0,0,0,0.95)' }}
            >
              {snap.points.toLocaleString()}
            </span>
          </div>

          {/* Weapon Slots */}
          {snap.weapons.length > 0 && (
            <div className="flex items-center gap-1.5 w-full justify-end">
              {snap.weapons.map((w, idx) => (
                <div
                  key={`${w.id}-${idx}`}
                  className={`px-2 py-0.5 text-[10px] font-mono-tabular uppercase truncate border-b ${
                    idx === snap.activeSlot
                      ? 'border-amber-400/80 text-[#ece9e2] bg-amber-500/12'
                      : 'border-white/15 text-[#8d877a] bg-black/35'
                  }`}
                >
                  [{idx + 1}] {w.name}
                </div>
              ))}
            </div>
          )}

          {/* Active Weapon & Oversized Magazine Counter */}
          {activeWeapon && (
            <div className="flex items-end justify-between gap-6 w-full pt-0.5">
              <div className="flex flex-col items-start">
                <div className="flex items-center gap-2">
                  <span
                    className={`font-display text-lg tracking-wider uppercase leading-tight drop-shadow-[0_1px_3px_rgba(0,0,0,0.95)] ${
                      activeWeapon.upgraded ? 'text-sky-300' : 'text-[#ece9e2]'
                    }`}
                  >
                    {activeWeapon.name}
                  </span>
                  {activeWeapon.upgraded && (
                    <span className="text-[10px] font-mono-tabular uppercase tracking-wider px-1.5 py-0.5 bg-sky-500/20 border border-sky-400/45 text-sky-300">
                      OC
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2.5 text-[10px] text-[#9e988a] mt-0.5">
                  <span className="flex items-center gap-1" title="Frag Grenades [G]">
                    <span className="uppercase tracking-wider">Frag</span>
                    <span className="flex items-center gap-1">
                      {Array.from({ length: snap.maxGrenades }).map((_, gi) => (
                        <span
                          key={gi}
                          className={`inline-block w-1.5 h-1.5 rotate-45 ${
                            gi < snap.grenades ? 'bg-amber-400 shadow-[0_0_4px_rgba(251,191,36,0.8)]' : 'bg-white/20'
                          }`}
                        />
                      ))}
                    </span>
                  </span>
                  <span>·</span>
                  <span>[T] Torch {snap.flashlightOn ? 'ON' : 'OFF'}</span>
                </div>
              </div>

              <div
                className={`font-display text-4xl font-bold tabular-nums leading-none drop-shadow-[0_2px_6px_rgba(0,0,0,0.95)] ${
                  activeWeapon.mag === 0
                    ? 'text-red-400'
                    : activeWeapon.mag <= Math.max(1, Math.ceil(activeWeapon.magSize * 0.25))
                      ? 'text-amber-400'
                      : 'text-[#ece9e2]'
                }`}
              >
                {activeWeapon.mag}
                <span className="font-mono-tabular text-base text-[#9e988a] font-normal ml-1">
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
