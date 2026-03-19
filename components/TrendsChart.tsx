"use client";

import {
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";

export type TrendPoint = {
  date: string;
  kcal: number;
  protein_g: number;
  fiber_g: number;
};

export type WorkoutTrendPoint = {
  date: string;
  caloriesBurned: number;
  exerciseCount: number;
  totalWeightKg: number;
};

export function NutritionChart({ data }: { data: TrendPoint[] }) {
  const formatted = data.map((d) => ({
    ...d,
    date: d.date.slice(5),
  }));

  return (
    <ResponsiveContainer width="100%" height={260}>
      <LineChart data={formatted} margin={{ top: 5, right: 10, left: -10, bottom: 5 }}>
        <XAxis dataKey="date" tick={{ fontSize: 11, fill: "#94a3b8" }} />
        <YAxis tick={{ fontSize: 11, fill: "#94a3b8" }} />
        <Tooltip
          contentStyle={{ background: "#ffffff", border: "1px solid #e2e8f0", borderRadius: 8 }}
          labelStyle={{ color: "#64748b" }}
        />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        <Line type="monotone" dataKey="kcal" stroke="#0f172a" dot={false} strokeWidth={2} name="Calories" />
        <Line type="monotone" dataKey="protein_g" stroke="#16a34a" dot={false} strokeWidth={2} name="Protein (g)" />
        <Line type="monotone" dataKey="fiber_g" stroke="#2563eb" dot={false} strokeWidth={2} name="Fiber (g)" />
      </LineChart>
    </ResponsiveContainer>
  );
}

export function WorkoutChart({ data }: { data: WorkoutTrendPoint[] }) {
  const formatted = data.map((d) => ({
    ...d,
    date: d.date.slice(5),
  }));

  return (
    <ResponsiveContainer width="100%" height={260}>
      <BarChart data={formatted} margin={{ top: 5, right: 10, left: -10, bottom: 5 }}>
        <XAxis dataKey="date" tick={{ fontSize: 11, fill: "#94a3b8" }} />
        <YAxis tick={{ fontSize: 11, fill: "#94a3b8" }} />
        <Tooltip
          contentStyle={{ background: "#ffffff", border: "1px solid #e2e8f0", borderRadius: 8 }}
          labelStyle={{ color: "#64748b" }}
        />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        <Bar dataKey="caloriesBurned" fill="#0f172a" radius={[4, 4, 0, 0]} name="Calories burned" />
        <Bar dataKey="totalWeightKg" fill="#6366f1" radius={[4, 4, 0, 0]} name="Volume (kg)" />
      </BarChart>
    </ResponsiveContainer>
  );
}

// Keep backward compat — old import name
export function TrendsChart({ data }: { data: TrendPoint[] }) {
  return <NutritionChart data={data} />;
}
