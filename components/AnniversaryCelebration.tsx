type Props = {
  partnerName?: string | null;
  yearCount: number;
  yearOrdinal: string;
  daysTogether: number;
};

export function AnniversaryCelebration({ partnerName, yearCount, yearOrdinal, daysTogether }: Props) {
  const minutes = daysTogether * 24 * 60;
  const husbandLine = partnerName
    ? `${daysTogether} days as your husband.`
    : `${daysTogether} days with you.`;

  return (
    <div className="relative overflow-hidden rounded-3xl border-2 border-rose-200 bg-gradient-to-br from-rose-50 via-pink-50 to-rose-100 px-6 py-7 text-center shadow-lg">
      <div className="absolute -top-4 -left-4 text-7xl opacity-10 select-none">💕</div>
      <div className="absolute -bottom-6 -right-4 text-7xl opacity-10 select-none">🌹</div>

      <div className="relative">
        <div className="text-3xl mb-2">💍 ✨ 💕</div>
        <div className="text-[11px] font-extrabold tracking-[0.25em] text-rose-400 mb-1">
          ✦ {yearOrdinal.toUpperCase()} ANNIVERSARY ✦
        </div>
        <div className="text-2xl font-extrabold text-rose-600 tracking-tight leading-tight">
          Happy Anniversary,<br />my love
        </div>

        <div className="mt-4 text-sm text-rose-500 font-medium leading-relaxed max-w-md mx-auto">
          {husbandLine} <span className="tabular-nums">{minutes.toLocaleString()}</span> minutes.<br />
          Every single one I&apos;d choose again.
        </div>

        <div className="mt-4 inline-flex items-center gap-2 rounded-full bg-white/70 backdrop-blur px-4 py-1.5 text-xs font-semibold text-rose-500 border border-rose-200">
          🥂 No tracking pressure today — just celebrate {yearCount === 1 ? "us" : "year " + yearCount}
        </div>

        <div className="mt-4 text-sm text-pink-500 font-semibold italic">
          I love you, today &amp; every day.
        </div>
        {partnerName && (
          <div className="mt-1 text-xs text-rose-400 font-bold tracking-wide">
            — {partnerName} 💕
          </div>
        )}
      </div>
    </div>
  );
}
