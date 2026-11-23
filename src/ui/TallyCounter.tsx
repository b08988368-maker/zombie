interface TallyCounterProps {
  round: number;
  isHoundRound: boolean;
}

const SLASH_PATHS = [
  'M 4 5 Q 3 19 4.5 34',
  'M 13 4 Q 11.5 18 13 35',
  'M 22 5 Q 23.5 19 21.5 34',
  'M 31 4 Q 29.5 18 31 35',
];

export function TallyCounter({ round, isHoundRound }: TallyCounterProps) {
  const accent = isHoundRound ? '#facc15' : '#dc2626';
  const glow = isHoundRound
    ? 'rgba(234, 179, 8, 0.55)'
    : 'rgba(185, 28, 28, 0.72)';

  if (round > 10) {
    return (
      <div className="flex items-baseline gap-2.5" aria-label={`Round ${round}`}>
        <span
          className="font-display text-6xl font-bold tracking-tight tabular-nums leading-none"
          style={{
            color: accent,
            textShadow: `0 0 18px ${glow}, 0 3px 10px rgba(0,0,0,0.95)`,
          }}
        >
          {round}
        </span>
        <span className="text-[11px] uppercase tracking-[0.22em] text-[#c4beaf] font-semibold">
          {isHoundRound ? 'Feral Wave' : 'Round'}
        </span>
      </div>
    );
  }

  const groups = Math.floor(round / 5);
  const rem = round % 5;
  const totalWidth = Math.max(38, groups * 48 + (rem > 0 ? rem * 9.5 + 8 : 0));

  return (
    <div className="flex items-end gap-2.5" aria-label={`Round ${round}`}>
      <svg
        width={totalWidth}
        height={42}
        viewBox={`0 0 ${totalWidth} 42`}
        className="overflow-visible"
        style={{ filter: `drop-shadow(0 0 7px ${glow}) drop-shadow(0 2px 3px rgba(0,0,0,0.95))` }}
      >
        {Array.from({ length: groups }).map((_, g) => {
          const ox = g * 48;
          return (
            <g key={g} fill="none" strokeLinecap="round">
              {/* Soft chalk smear underlay */}
              <g stroke={accent} strokeOpacity="0.28" strokeWidth="6.2" transform={`translate(${ox}, 2)`}>
                {SLASH_PATHS.map((d, i) => (
                  <path key={`u-${i}`} d={d} />
                ))}
                <path d="M 0 31 Q 17 19 36 8" strokeWidth="6.6" />
              </g>
              {/* Crisp jagged primary scratches */}
              <g stroke={accent} strokeWidth="3.3" transform={`translate(${ox}, 2)`}>
                {SLASH_PATHS.map((d, i) => (
                  <path key={`p-${i}`} d={d} />
                ))}
                <path d="M 0 31 Q 17 19 36 8" strokeWidth="3.6" />
              </g>
            </g>
          );
        })}
        {Array.from({ length: rem }).map((_, r) => {
          const ox = groups * 48 + r * 9.5;
          const d = SLASH_PATHS[r % SLASH_PATHS.length]!;
          return (
            <g key={r} fill="none" strokeLinecap="round" transform={`translate(${ox}, 2)`}>
              <path d={d} stroke={accent} strokeOpacity="0.28" strokeWidth="6.2" />
              <path d={d} stroke={accent} strokeWidth="3.3" />
            </g>
          );
        })}
      </svg>
      <span className="font-mono-tabular text-[11px] uppercase tracking-widest text-[#b5afa0] pb-1">
        {isHoundRound ? `Feral R${round}` : `R${round}`}
      </span>
    </div>
  );
}

