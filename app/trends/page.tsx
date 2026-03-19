import Link from "next/link";
import { Card } from "@/components/Card";
import { TrendsChart, type TrendPoint } from "@/components/TrendsChart";
import { prisma } from "@/lib/db";
import { addNutrients, safeNutrientsForEntry } from "@/lib/nutrition";
import { isoDaysBack, lastIsoDates } from "@/lib/dates";
import { requireSession } from "@/lib/session";

function empty() {
  return { kcal: 0, protein_g: 0, carbs_g: 0, fat_g: 0, fiber_g: 0, sodium_mg: 0 };
}

function toFixed1(n: number) {
  return Math.round(n * 10) / 10;
}

export default async function TrendsPage({
  searchParams
}: {
  searchParams?: Promise<{ range?: string }>;
}) {
  const user = await requireSession();
  const sp = (await searchParams) ?? {};
  const range = sp.range === "7" ? 7 : 30;
  const fromDate = isoDaysBack(range - 1);
  const days = lastIsoDates(range);

  const entries = await prisma.logEntry.findMany({
    where: { userId: user.id, date: { gte: fromDate } },
    include: { food: true }
  });

  const totalsByDate = new Map<string, ReturnType<typeof empty>>();
  for (const d of days) totalsByDate.set(d, empty());

  for (const e of entries) {
    const n = safeNutrientsForEntry(e, e.food);
    if (!n) continue;
    const existing = totalsByDate.get(e.date) ?? empty();
    totalsByDate.set(e.date, addNutrients(existing, n) as any);
  }

  const data: TrendPoint[] = days.map((d) => {
    const t = totalsByDate.get(d) ?? empty();
    return {
      date: d,
      kcal: Math.round(t.kcal),
      protein_g: toFixed1(t.protein_g),
      fiber_g: toFixed1(t.fiber_g ?? 0)
    };
  });

  const sum = data.reduce(
    (acc, p) => {
      acc.kcal += p.kcal;
      acc.protein += p.protein_g;
      acc.fiber += p.fiber_g;
      return acc;
    },
    { kcal: 0, protein: 0, fiber: 0 }
  );

  const avg = {
    kcal: Math.round(sum.kcal / range),
    protein: toFixed1(sum.protein / range),
    fiber: toFixed1(sum.fiber / range)
  };

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-lg font-semibold">Trends</div>
            <div className="mt-1 text-sm text-slate-500">
              {range}-day view for calories, protein, and fiber.
            </div>
          </div>
          <div className="flex gap-2">
            <Link
              href="/trends?range=7"
              className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm hover:bg-slate-50"
            >
              7d
            </Link>
            <Link
              href="/trends?range=30"
              className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm hover:bg-slate-50"
            >
              30d
            </Link>
          </div>
        </div>

        <div className="mt-3 grid gap-2 md:grid-cols-3">
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
            <div className="text-xs text-slate-500">Avg calories</div>
            <div className="mt-1 text-lg font-semibold tabular-nums">{avg.kcal} kcal</div>
          </div>
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
            <div className="text-xs text-slate-500">Avg protein</div>
            <div className="mt-1 text-lg font-semibold tabular-nums">{avg.protein} g</div>
          </div>
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
            <div className="text-xs text-slate-500">Avg fiber</div>
            <div className="mt-1 text-lg font-semibold tabular-nums">{avg.fiber} g</div>
          </div>
        </div>
      </Card>

      <Card title="Daily totals">
        <TrendsChart data={data} />
      </Card>
    </div>
  );
}
