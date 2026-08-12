"use client";

import { useState } from "react";
import {
  ComposedChart,
  Line,
  Area,
  AreaChart,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  ResponsiveContainer,
  ReferenceLine,
} from "recharts";

export type TrendPoint = {
  date: string;
  kcal: number | null;
  protein_g: number | null;
  carbs_g: number | null;
  fat_g: number | null;
  fiber_g: number | null;
};

export type WorkoutTrendPoint = {
  date: string;
  caloriesBurned: number;
  exerciseCount: number;
  totalWeightKg: number;
};

export type WeightTrendPoint = {
  date: string;
  weightKg: number;
};

const tooltipStyle = {
  contentStyle: { background: "#fff", border: "none", borderRadius: 12, boxShadow: "0 4px 12px rgba(0,0,0,0.08)" },
  labelStyle: { color: "#6b7280", fontWeight: 600 },
};

type Metric = "kcal" | "protein_g" | "carbs_g" | "fat_g" | "fiber_g";

const METRICS: { key: Metric; label: string; color: string }[] = [
  { key: "kcal",      label: "Calories", color: "#10b981" },
  { key: "protein_g", label: "Protein",  color: "#3b82f6" },
  { key: "carbs_g",   label: "Carbs",    color: "#f59e0b" },
  { key: "fat_g",     label: "Fat",      color: "#f43f5e" },
  { key: "fiber_g",   label: "Fiber",    color: "#8b5cf6" },
];

export function NutritionChart({ data, kcalTarget }: { data: TrendPoint[]; kcalTarget?: number }) {
  const [active, setActive] = useState<Set<Metric>>(new Set(["kcal", "protein_g"]));
  const formatted = data.map((d) => ({ ...d, date: d.date.slice(5) }));

  const showKcal = active.has("kcal");
  const showMacros = (["protein_g", "carbs_g", "fat_g", "fiber_g"] as Metric[]).some((k) => active.has(k));
  const rightMargin = showMacros ? 40 : 10;

  function toggle(key: Metric) {
    setActive((prev) => {
      const next = new Set(prev);
      if (next.has(key) && next.size === 1) return prev; // keep at least one
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  }

  return (
    <div>
      {/* Toggle chips */}
      <div className="flex flex-wrap gap-2 mb-4">
        {METRICS.map(({ key, label, color }) => {
          const on = active.has(key);
          return (
            <button
              key={key}
              onClick={() => toggle(key)}
              className={`rounded-full px-3 py-1 text-xs font-semibold transition-all border ${
                on ? "text-white border-transparent" : "bg-white text-gray-400 border-gray-200 hover:border-gray-300"
              }`}
              style={on ? { backgroundColor: color, borderColor: color } : {}}
            >
              {label}
            </button>
          );
        })}
      </div>

      <ResponsiveContainer width="100%" height={260}>
        <ComposedChart data={formatted} margin={{ top: 5, right: rightMargin, left: -10, bottom: 5 }}>
          <XAxis dataKey="date" tick={{ fontSize: 11, fill: "#9ca3af" }} />
          {showKcal && <YAxis yAxisId="kcal" tick={{ fontSize: 11, fill: "#9ca3af" }} />}
          {showMacros && <YAxis yAxisId="g" orientation={showKcal ? "right" : "left"} tick={{ fontSize: 11, fill: "#9ca3af" }} unit="g" />}
          <Tooltip {...tooltipStyle} />
          {showKcal && kcalTarget && (
            <ReferenceLine
              yAxisId="kcal"
              y={kcalTarget}
              stroke="#10b981"
              strokeDasharray="5 3"
              strokeOpacity={0.5}
              label={{ value: "target", position: "insideTopRight", fontSize: 10, fill: "#10b981" }}
            />
          )}
          {showKcal && (
            <Bar yAxisId="kcal" dataKey="kcal" fill="#10b981" fillOpacity={0.7} radius={[4, 4, 0, 0]} name="Calories" />
          )}
          {active.has("protein_g") && (
            <Line yAxisId="g" type="monotone" dataKey="protein_g" stroke="#3b82f6" dot={false} strokeWidth={2} name="Protein (g)" connectNulls={false} />
          )}
          {active.has("carbs_g") && (
            <Line yAxisId="g" type="monotone" dataKey="carbs_g" stroke="#f59e0b" dot={false} strokeWidth={2} name="Carbs (g)" connectNulls={false} />
          )}
          {active.has("fat_g") && (
            <Line yAxisId="g" type="monotone" dataKey="fat_g" stroke="#f43f5e" dot={false} strokeWidth={2} name="Fat (g)" connectNulls={false} />
          )}
          {active.has("fiber_g") && (
            <Line yAxisId="g" type="monotone" dataKey="fiber_g" stroke="#8b5cf6" dot={false} strokeWidth={2} name="Fiber (g)" connectNulls={false} />
          )}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

// Volume peaks around 14x calories burned, so one shared axis flattens the
// calorie series into an unreadable stub. Two stacked facets on a common x-axis
// give each measure its own scale without a second y-axis inventing a
// correlation between them. Fixed YAxis width keeps the days aligned vertically.
const FACET_AXIS_WIDTH = 46;
const VOLUME_COLOR = "#2a78d6";
const BURNED_COLOR = "#eb6834";

function FacetLabel({ children }: { children: React.ReactNode }) {
  return <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">{children}</div>;
}

export function WorkoutChart({ data }: { data: WorkoutTrendPoint[] }) {
  const formatted = data.map((d) => ({ ...d, date: d.date.slice(5) }));

  return (
    <div className="grid gap-2">
      <FacetLabel>Volume (kg)</FacetLabel>
      <ResponsiveContainer width="100%" height={120}>
        {/* syncId links the two facets so hovering a day highlights it in both */}
        <BarChart data={formatted} syncId="workout" margin={{ top: 4, right: 10, left: 0, bottom: 0 }}>
          <XAxis dataKey="date" hide />
          <YAxis
            width={FACET_AXIS_WIDTH}
            tick={{ fontSize: 11, fill: "#9ca3af" }}
            axisLine={false}
            tickLine={false}
            tickFormatter={(v: number) => (v >= 1000 ? `${v / 1000}k` : String(v))}
          />
          <Tooltip
            {...tooltipStyle}
            cursor={{ fill: "rgba(0,0,0,0.04)" }}
            formatter={(value: number) => [`${value.toLocaleString()} kg`, "Volume"]}
          />
          <Bar dataKey="totalWeightKg" fill={VOLUME_COLOR} radius={[4, 4, 0, 0]} name="Volume" />
        </BarChart>
      </ResponsiveContainer>

      <FacetLabel>Calories burned</FacetLabel>
      <ResponsiveContainer width="100%" height={140}>
        <BarChart data={formatted} syncId="workout" margin={{ top: 4, right: 10, left: 0, bottom: 0 }}>
          {/* preserveStartEnd keeps the first and last day labelled when the
              30-day range has more dates than fit across a phone screen */}
          <XAxis
            dataKey="date"
            tick={{ fontSize: 11, fill: "#9ca3af" }}
            axisLine={false}
            tickLine={false}
            interval="preserveStartEnd"
            minTickGap={12}
          />
          <YAxis
            width={FACET_AXIS_WIDTH}
            tick={{ fontSize: 11, fill: "#9ca3af" }}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip
            {...tooltipStyle}
            cursor={{ fill: "rgba(0,0,0,0.04)" }}
            formatter={(value: number) => [`${Math.round(value)} kcal`, "Burned"]}
          />
          <Bar dataKey="caloriesBurned" fill={BURNED_COLOR} radius={[4, 4, 0, 0]} name="Calories burned" />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function WeightChart({ data }: { data: WeightTrendPoint[] }) {
  const formatted = data.map((d) => ({ ...d, date: d.date.slice(5) }));
  const weights = data.map((d) => d.weightKg);
  const min = Math.floor(Math.min(...weights) - 1);
  const max = Math.ceil(Math.max(...weights) + 1);

  return (
    <ResponsiveContainer width="100%" height={260}>
      <AreaChart data={formatted} margin={{ top: 5, right: 10, left: -10, bottom: 5 }}>
        <defs>
          <linearGradient id="weightGradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#8b5cf6" stopOpacity={0.3} />
            <stop offset="95%" stopColor="#8b5cf6" stopOpacity={0} />
          </linearGradient>
        </defs>
        <XAxis dataKey="date" tick={{ fontSize: 11, fill: "#9ca3af" }} />
        <YAxis domain={[min, max]} tick={{ fontSize: 11, fill: "#9ca3af" }} />
        <Tooltip
          contentStyle={{ background: "#fff", border: "none", borderRadius: 12, boxShadow: "0 4px 12px rgba(0,0,0,0.08)" }}
          labelStyle={{ color: "#6b7280", fontWeight: 600 }}
          formatter={(value: number) => [`${value} kg`, "Weight"]}
        />
        <Area
          type="monotone"
          dataKey="weightKg"
          stroke="#8b5cf6"
          strokeWidth={2.5}
          fill="url(#weightGradient)"
          dot={{ r: 4, fill: "#8b5cf6", strokeWidth: 0 }}
          name="Weight (kg)"
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

export function TrendsChart({ data }: { data: TrendPoint[] }) {
  return <NutritionChart data={data} />;
}
