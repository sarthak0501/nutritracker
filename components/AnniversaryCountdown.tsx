export function AnniversaryCountdown({ days }: { days: number }) {
  const text =
    days === 1
      ? "Tomorrow's our anniversary"
      : `${days} days until our anniversary`;

  return (
    <div className="rounded-2xl bg-gradient-to-r from-pink-50 via-rose-50 to-pink-50 border border-pink-100 px-4 py-2.5 flex items-center justify-center gap-2 shadow-sm">
      <span className="text-base animate-pulse">💕</span>
      <span className="text-sm font-semibold text-rose-500 tracking-tight">{text}</span>
      <span className="text-base animate-pulse">💕</span>
    </div>
  );
}
