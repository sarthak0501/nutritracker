"use client";

import {
  LineChart,
  Line,
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

export function TrendsChart({ data }: { data: TrendPoint[] }) {
  const formatted = data.map((d) => ({
    ...d,
    date: d.date.slice(5), // MM-DD
  }));

  return (
    <ResponsiveContainer width="100%" height={280}>
      <LineChart data={formatted} margin={{ top: 5, right: 10, left: -10, bottom: 5 }}>
        <XAxis dataKey="date" tick={{ fontSize: 11, fill: "#71717a" }} />
        <YAxis tick={{ fontSize: 11, fill: "#71717a" }} />
        <Tooltip
          contentStyle={{ background: "#18181b", border: "1px solid #3f3f46", borderRadius: 8 }}
          labelStyle={{ color: "#a1a1aa" }}
        />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        <Line type="monotone" dataKey="kcal" stroke="#ffffff" dot={false} strokeWidth={2} />
        <Line type="monotone" dataKey="protein_g" stroke="#4ade80" dot={false} strokeWidth={2} />
        <Line type="monotone" dataKey="fiber_g" stroke="#60a5fa" dot={false} strokeWidth={2} />
      </LineChart>
    </ResponsiveContainer>
  );
}
