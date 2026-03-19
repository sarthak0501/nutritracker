import { Card } from "@/components/Card";
import { prisma } from "@/lib/db";
import { updateProfile } from "@/app/actions/profile";
import { requireSession } from "@/lib/session";

export default async function ProfilePage() {
  const user = await requireSession();
  const profile = await prisma.profile.findUnique({ where: { userId: user.id } });

  return (
    <div className="space-y-4 max-w-lg mx-auto">
      <div>
        <h1 className="text-xl font-semibold">Profile</h1>
        <p className="text-sm text-slate-500">Signed in as <span className="text-slate-800 font-medium">{user.name}</span></p>
      </div>
      <Card title="Daily Targets">
        <form action={updateProfile} className="grid gap-4">
          <label className="grid gap-1 text-sm">
            <span className="text-xs text-slate-500">Calories (kcal)</span>
            <input name="kcalTarget" type="number" step="1" defaultValue={Math.round(profile?.kcalTarget ?? 2000)}
              className="rounded-lg border border-slate-300 bg-white px-3 py-2" />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="grid gap-1 text-sm">
              <span className="text-xs text-slate-500">Protein (g)</span>
              <input name="proteinTarget" type="number" step="1" defaultValue={Math.round(profile?.proteinTarget ?? 120)}
                className="rounded-lg border border-slate-300 bg-white px-3 py-2" />
            </label>
            <label className="grid gap-1 text-sm">
              <span className="text-xs text-slate-500">Carbs (g)</span>
              <input name="carbsTarget" type="number" step="1" defaultValue={Math.round(profile?.carbsTarget ?? 250)}
                className="rounded-lg border border-slate-300 bg-white px-3 py-2" />
            </label>
            <label className="grid gap-1 text-sm">
              <span className="text-xs text-slate-500">Fat (g)</span>
              <input name="fatTarget" type="number" step="1" defaultValue={Math.round(profile?.fatTarget ?? 70)}
                className="rounded-lg border border-slate-300 bg-white px-3 py-2" />
            </label>
            <label className="grid gap-1 text-sm">
              <span className="text-xs text-slate-500">Fiber (g)</span>
              <input name="fiberTarget" type="number" step="1" defaultValue={Math.round(profile?.fiberTarget ?? 30)}
                className="rounded-lg border border-slate-300 bg-white px-3 py-2" />
            </label>
          </div>
          <button type="submit" className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800">
            Save targets
          </button>
        </form>
      </Card>
    </div>
  );
}
