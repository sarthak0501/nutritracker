import { Card } from "@/components/Card";
import { prisma } from "@/lib/db";
import { updateProfile, updateBodyStats } from "@/app/actions/profile";
import { requireSession } from "@/lib/session";

export default async function ProfilePage() {
  const user = await requireSession();
  const profile = await prisma.profile.findUnique({ where: { userId: user.id } });

  const inputClass = "rounded-xl border-0 bg-gray-100 px-3 py-2.5 placeholder-gray-400 focus:ring-2 focus:ring-brand-500 text-sm";
  const labelClass = "text-xs font-medium text-gray-500";

  return (
    <div className="space-y-4 max-w-lg mx-auto">
      <div>
        <h1 className="text-xl font-bold">Profile</h1>
        <p className="text-sm text-gray-500 mt-1">Signed in as <span className="text-gray-800 font-semibold">{user.name}</span></p>
      </div>

      <Card title="Body Stats">
        <form action={updateBodyStats} className="grid gap-4">
          <div className="grid grid-cols-2 gap-3">
            <label className="grid gap-1 text-sm">
              <span className={labelClass}>Height (cm)</span>
              <input name="heightCm" type="number" step="1" defaultValue={profile?.heightCm ? Math.round(profile.heightCm) : ""}
                placeholder="170" className={inputClass} />
            </label>
            <label className="grid gap-1 text-sm">
              <span className={labelClass}>Weight (kg)</span>
              <input name="weightKg" type="number" step="0.1" defaultValue={profile?.weightKg ?? ""}
                placeholder="70" className={inputClass} />
            </label>
            <label className="grid gap-1 text-sm">
              <span className={labelClass}>Age</span>
              <input name="age" type="number" step="1" defaultValue={profile?.age ?? ""}
                placeholder="25" className={inputClass} />
            </label>
            <label className="grid gap-1 text-sm">
              <span className={labelClass}>Gender</span>
              <select name="gender" defaultValue={profile?.gender ?? ""} className={inputClass + " text-gray-900"}>
                <option value="">—</option>
                <option value="male">Male</option>
                <option value="female">Female</option>
                <option value="other">Other</option>
              </select>
            </label>
          </div>

          <label className="grid gap-1 text-sm">
            <span className={labelClass}>Equipment access</span>
            <select name="equipmentPreset" defaultValue={profile?.equipmentPreset ?? ""} className={inputClass + " text-gray-900"}>
              <option value="">—</option>
              <option value="gym">Full gym</option>
              <option value="home">Home gym</option>
              <option value="bodyweight">Bodyweight only</option>
              <option value="custom">Custom (list below)</option>
            </select>
          </label>

          <label className="grid gap-1 text-sm">
            <span className={labelClass}>Equipment list (comma-separated)</span>
            <input name="equipment" defaultValue={profile?.equipment?.join(", ") ?? ""}
              placeholder="dumbbells, pull-up bar, resistance bands"
              className={inputClass} />
          </label>

          <button type="submit" className="rounded-xl bg-brand-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-brand-700 active:scale-[0.98] transition-all">
            Save body stats
          </button>
        </form>
      </Card>

      <Card title="Daily Nutrition Targets">
        <form action={updateProfile} className="grid gap-4">
          <label className="grid gap-1 text-sm">
            <span className={labelClass}>Calories (kcal)</span>
            <input name="kcalTarget" type="number" step="1" defaultValue={Math.round(profile?.kcalTarget ?? 2000)}
              className={inputClass} />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="grid gap-1 text-sm">
              <span className={labelClass}>Protein (g)</span>
              <input name="proteinTarget" type="number" step="1" defaultValue={Math.round(profile?.proteinTarget ?? 120)}
                className={inputClass} />
            </label>
            <label className="grid gap-1 text-sm">
              <span className={labelClass}>Carbs (g)</span>
              <input name="carbsTarget" type="number" step="1" defaultValue={Math.round(profile?.carbsTarget ?? 250)}
                className={inputClass} />
            </label>
            <label className="grid gap-1 text-sm">
              <span className={labelClass}>Fat (g)</span>
              <input name="fatTarget" type="number" step="1" defaultValue={Math.round(profile?.fatTarget ?? 70)}
                className={inputClass} />
            </label>
            <label className="grid gap-1 text-sm">
              <span className={labelClass}>Fiber (g)</span>
              <input name="fiberTarget" type="number" step="1" defaultValue={Math.round(profile?.fiberTarget ?? 30)}
                className={inputClass} />
            </label>
          </div>
          <button type="submit" className="rounded-xl bg-brand-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-brand-700 active:scale-[0.98] transition-all">
            Save targets
          </button>
        </form>
      </Card>
    </div>
  );
}
