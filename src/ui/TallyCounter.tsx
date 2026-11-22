interface TallyCounterProps {
  round: number;
  isHoundRound: boolean;
}

export function TallyCounter({ round, isHoundRound }: TallyCounterProps) {
  const accent = isHoundRound ? '#eab308' : '#b91c1c';

  if (round > 10) {
    return (
      <div className="flex items-baseline gap-2.5">
        <span
          className="font-display text-5xl font-bold tracking-tight tabular-nums leading-none"
          style={{ color: accent, textShadow: '0 2px 10px rgba(0,0,0,0.85)' }}
        >
          {round}
        </span>
        <span className="text-xs uppercase tracking-widest text-[#9c9688]">
          {isHoundRound ? 'Feral Wave' : 'Round'}
        </span>
      </div>
    );
  }

  const groups = Math.floor(round / 5);
  const rem = round % 5;

  return (
    <div className="flex items-center gap-3" aria-label={`Round ${round}`}>
      <svg
        width={Math.max(32, groups * 42 + (rem > 0 ? rem * 8 + 8 : 0))}
        height={38}
        viewBox={`0 0 ${Math.max(32, groups * 42 + (rem > 0 ? rem * 8 + 8 : 0))} 38`}
        className="overflow-visible"
      >
        {Array.from({ length: groups }).map((_, g) => {
          const ox = g * 42;
          return (
            <g key={g} stroke={accent} strokeWidth="3.2" strokeLinecap="round">
              <line x1={ox + 4} y1={5} x2={ox + 3} y2={33} />
              <line x1={ox + 12} y1={4} x2={ox + 11} y2={34} />
              <line x1={ox + 20} y1={5} x2={ox + 19} y2={33} />
              <line x1={ox + 28} y1={4} x2={ox + 27} y2={34} />
              <line x1={ox + 1} y1={28} x2={ox + 33} y2={9} strokeWidth="3.4" />
            </g>
          );
        })}
        {Array.from({ length: rem }).map((_, r) => {
          const ox = groups * 42 + r * 9;
          return (
            <line
              key={r}
              x1={ox + 4}
              y1={5 + (r % 2)}
              x2={ox + 3}
              y2={33 - (r % 2)}
              stroke={accent}
              strokeWidth="3.2"
              strokeLinecap="round"
            />
          );
        })}
      </svg>
      <span className="font-mono-tabular text-xs text-[#9c9688]">R{round}</span>
    </div>
  );
}
