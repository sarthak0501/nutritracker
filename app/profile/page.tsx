import { Card } from "@/components/Card";
import { prisma } from "@/lib/db";
import { updateProfile } from "@/app/actions/profile";
import { ensureProfile } from "@/app/actions/logging";

export default async function ProfilePage() {
  await ensureProfile();
  const profile = await prisma.profile.findUnique({ where: { id: 1 } });

  return (
    <div className="space-y-4 max-w-lg mx-auto">
      <h1 className="text-xl font-semibold">Daily Targets</h1>
      <Card>
        <form action={updateProfile} className="grid gap-4">
          <label className="grid gap-1 text-sm">
            <span className="text-xs text-zinc-400">Calories (kcal)</span>
            <input
              name="kcalTarget"
              type="number"
              inputMode="decimal"
              defaultValue={profile?.kcalTarget ?? 2000}
              className="rounded-lg border border-zinc-800 bg-zinc-950/30 px-3 py-2"
            />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="grid gap-1 text-sm">
              <span className="text-xs text-zinc-400">Protein (g)</span>
              <input
                name="proteinTarget"
                type="number"
                inputMode="decimal"
                defaultValue={profile?.proteinTarget ?? 120}
                className="rounded-lg border border-zinc-800 bg-zinc-950/30 px-3 py-2"
              />
            </label>
            <label className="grid gap-1 text-sm">
              <span className="text-xs text-zinc-400">Carbs (g)</span>
              <input
                name="carbsTarget"
                type="number"
                inputMode="decimal"
                defaultValue={profile?.carbsTarget ?? 250}
                className="rounded-lg border border-zinc-800 bg-zinc-950/30 px-3 py-2"
              />
            </label>
            <label className="grid gap-1 text-sm">
              <span className="text-xs text-zinc-400">Fat (g)</span>
              <input
                name="fatTarget"
                type="number"
                inputMode="decimal"
                defaultValue={profile?.fatTarget ?? 70}
                className="rounded-lg border border-zinc-800 bg-zinc-950/30 px-3 py-2"
              />
            </label>
            <label className="grid gap-1 text-sm">
              <span className="text-xs text-zinc-400">Fiber (g)</span>
              <input
                name="fiberTarget"
                type="number"
                inputMode="decimal"
                defaultValue={profile?.fiberTarget ?? 30}
                className="rounded-lg border border-zinc-800 bg-zinc-950/30 px-3 py-2"
              />
            </label>
          </div>
          <button
            type="submit"
            className="rounded-lg bg-zinc-50 px-4 py-2 text-sm font-medium text-zinc-950 hover:bg-white"
          >
            Save targets
          </button>
        </form>
      </Card>
    </div>
  );
}
