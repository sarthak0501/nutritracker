"use client";

type Props = {
  days: string[];
  kcalByDate: Record<string, number>;
  kcalTarget: number;
};

function cellColor(kcal: number, target: number): string {
  if (kcal === 0) return "bg-gray-100";
  const pct = kcal / target;
  if (pct >= 0.9 && pct <= 1.1) return "bg-green-400";
  if (pct >= 0.7 && pct < 0.9) return "bg-green-200";
  if (pct > 1.1 && pct <= 1.3) return "bg-amber-300";
  if (pct > 1.3) return "bg-red-400";
  return "bg-green-100";
}

export function CalendarHeatmap({ days, kcalByDate, kcalTarget }: Props) {
  return (
    <div>
      <div className="flex flex-wrap gap-1.5">
        {days.map((d) => {
          const kcal = kcalByDate[d] ?? 0;
          const color = cellColor(kcal, kcalTarget);
          const label = kcal > 0 ? `${d.slice(5)}: ${Math.round(kcal)} kcal` : `${d.slice(5)}: not logged`;
          return (
            <div
              key={d}
              title={label}
              className={`w-6 h-6 rounded-sm ${color} cursor-default transition-opacity hover:opacity-70`}
            />
          );
        })}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-3 text-[10px] text-gray-400">
        <div className="flex items-center gap-1">
          <div className="w-3 h-3 rounded-sm bg-gray-100" />
          Not logged
        </div>
        <div className="flex items-center gap-1">
          <div className="w-3 h-3 rounded-sm bg-green-100" />
          Under
        </div>
        <div className="flex items-center gap-1">
          <div className="w-3 h-3 rounded-sm bg-green-400" />
          On target
        </div>
        <div className="flex items-center gap-1">
          <div className="w-3 h-3 rounded-sm bg-amber-300" />
          Over
        </div>
        <div className="flex items-center gap-1">
          <div className="w-3 h-3 rounded-sm bg-red-400" />
          Way over
        </div>
      </div>
    </div>
  );
}
