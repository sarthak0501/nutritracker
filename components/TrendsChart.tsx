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
  const formatted = data.map((d) => ({ ...d, date: d.date.slice(5) }));

  return (
    <ResponsiveContainer width="100%" height={260}>
      <LineChart data={formatted} margin={{ top: 5, right: 10, left: -10, bottom: 5 }}>
        <XAxis dataKey="date" tick={{ fontSize: 11, fill: "#9ca3af" }} />
        <YAxis tick={{ fontSize: 11, fill: "#9ca3af" }} />
        <Tooltip
          contentStyle={{ background: "#fff", border: "none", borderRadius: 12, boxShadow: "0 4px 12px rgba(0,0,0,0.08)" }}
          labelStyle={{ color: "#6b7280", fontWeight: 600 }}
        />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        <Line type="monotone" dataKey="kcal" stroke="#10b981" dot={false} strokeWidth={2.5} name="Calories" />
        <Line type="monotone" dataKey="protein_g" stroke="#3b82f6" dot={false} strokeWidth={2} name="Protein (g)" />
        <Line type="monotone" dataKey="fiber_g" stroke="#f59e0b" dot={false} strokeWidth={2} name="Fiber (g)" />
      </LineChart>
    </ResponsiveContainer>
  );
}

export function WorkoutChart({ data }: { data: WorkoutTrendPoint[] }) {
  const formatted = data.map((d) => ({ ...d, date: d.date.slice(5) }));

  return (
    <ResponsiveContainer width="100%" height={260}>
      <BarChart data={formatted} margin={{ top: 5, right: 10, left: -10, bottom: 5 }}>
        <XAxis dataKey="date" tick={{ fontSize: 11, fill: "#9ca3af" }} />
        <YAxis tick={{ fontSize: 11, fill: "#9ca3af" }} />
        <Tooltip
          contentStyle={{ background: "#fff", border: "none", borderRadius: 12, boxShadow: "0 4px 12px rgba(0,0,0,0.08)" }}
          labelStyle={{ color: "#6b7280", fontWeight: 600 }}
        />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        <Bar dataKey="caloriesBurned" fill="#3b82f6" radius={[6, 6, 0, 0]} name="Calories burned" />
        <Bar dataKey="totalWeightKg" fill="#8b5cf6" radius={[6, 6, 0, 0]} name="Volume (kg)" />
      </BarChart>
    </ResponsiveContainer>
  );
}

export function TrendsChart({ data }: { data: TrendPoint[] }) {
  return <NutritionChart data={data} />;
}
