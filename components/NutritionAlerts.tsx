import { prisma } from "@/lib/db";
import { safeNutrientsForEntry, addNutrients } from "@/lib/nutrition";
import { lastIsoDates, isoDaysBack } from "@/lib/dates";

type Alert = { type: "warn" | "good"; icon: string; message: string };

function emptyTotals() {
  return { kcal: 0, protein_g: 0, fiber_g: 0 };
}

export async function NutritionAlerts({
  userId,
  kcalTarget,
  proteinTarget,
  fiberTarget,
}: {
  userId: string;
  kcalTarget: number;
  proteinTarget: number;
  fiberTarget: number;
}) {
  const days = lastIsoDates(7);
  const from = isoDaysBack(6);

  const entries = await prisma.logEntry.findMany({
    where: { userId, date: { gte: from } },
    include: { food: true },
  });

  const byDate = new Map<string, { kcal: number; protein_g: number; fiber_g: number }>();
  for (const e of entries) {
    const n = safeNutrientsForEntry(e, e.food);
    if (!n) continue;
    const existing = byDate.get(e.date) ?? emptyTotals();
    byDate.set(e.date, {
      kcal: existing.kcal + n.kcal,
      protein_g: existing.protein_g + n.protein_g,
      fiber_g: existing.fiber_g + (n.fiber_g ?? 0),
    });
  }

  const logged = days.map((d) => byDate.get(d)).filter(Boolean) as { kcal: number; protein_g: number; fiber_g: number }[];

  if (logged.length < 3) return null; // not enough data

  const alerts: Alert[] = [];

  const lowFiberDays = logged.filter((d) => d.fiber_g < fiberTarget * 0.75).length;
  const lowProteinDays = logged.filter((d) => d.protein_g < proteinTarget * 0.75).length;
  const overKcalDays = logged.filter((d) => d.kcal > kcalTarget * 1.15).length;
  const hitProteinDays = logged.filter((d) => d.protein_g >= proteinTarget * 0.9).length;
  const underKcalDays = logged.filter((d) => d.kcal <= kcalTarget).length;

  // Warnings
  if (lowFiberDays >= Math.ceil(logged.length * 0.6)) {
    alerts.push({ type: "warn", icon: "🥦", message: `Fiber has been low ${lowFiberDays} of the last ${logged.length} days — try adding veggies or legumes` });
  }
  if (lowProteinDays >= Math.ceil(logged.length * 0.6)) {
    alerts.push({ type: "warn", icon: "🥩", message: `Protein under target ${lowProteinDays} of the last ${logged.length} days` });
  }
  if (overKcalDays >= 4) {
    alerts.push({ type: "warn", icon: "⚠️", message: `Over calorie target ${overKcalDays} days this week — worth a check-in` });
  }

  // Positives (only if no warnings of the same type)
  if (hitProteinDays >= logged.length && alerts.every((a) => !a.message.includes("Protein"))) {
    alerts.push({ type: "good", icon: "🔥", message: `Crushing protein goals — ${hitProteinDays} days in a row!` });
  }
  if (underKcalDays === logged.length && alerts.every((a) => !a.message.includes("calorie"))) {
    alerts.push({ type: "good", icon: "🎯", message: `Under calorie target every day this week — great discipline!` });
  }

  if (alerts.length === 0) return null;

  return (
    <div className="space-y-2">
      {alerts.slice(0, 3).map((alert, i) => (
        <div
          key={i}
          className={`flex items-start gap-3 rounded-2xl px-4 py-3 text-sm ${
            alert.type === "good"
              ? "bg-green-50 text-green-800 border border-green-100"
              : "bg-amber-50 text-amber-800 border border-amber-100"
          }`}
        >
          <span className="text-base shrink-0 mt-0.5">{alert.icon}</span>
          <span className="font-medium leading-snug">{alert.message}</span>
        </div>
      ))}
    </div>
  );
}
