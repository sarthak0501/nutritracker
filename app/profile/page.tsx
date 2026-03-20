import { Card } from "@/components/Card";
import { prisma } from "@/lib/db";
import { updateProfile, updateBodyStats, updateHealthProfile } from "@/app/actions/profile";
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

      <Card title="Health & Dietary Profile">
        <form action={updateHealthProfile} className="grid gap-5">
          <div className="grid gap-2">
            <span className={labelClass}>Allergies</span>
            {[
              { value: "peanuts", label: "Peanuts" },
              { value: "tree nuts", label: "Tree nuts" },
              { value: "dairy", label: "Dairy" },
              { value: "eggs", label: "Eggs" },
              { value: "gluten/wheat", label: "Gluten / Wheat" },
              { value: "soy", label: "Soy" },
              { value: "shellfish", label: "Shellfish" },
              { value: "fish", label: "Fish" },
            ].map(({ value, label }) => (
              <label key={value} className="flex items-center gap-2 text-sm cursor-pointer">
                <input
                  type="checkbox"
                  name="allergies"
                  value={value}
                  defaultChecked={profile?.allergies?.includes(value)}
                  className="rounded accent-brand-600"
                />
                {label}
              </label>
            ))}
            <input
              name="customAllergy"
              placeholder="Other (comma-separated)"
              defaultValue={profile?.allergies?.filter(a => !["peanuts","tree nuts","dairy","eggs","gluten/wheat","soy","shellfish","fish"].includes(a)).join(", ")}
              className={inputClass + " mt-1"}
            />
          </div>

          <div className="grid gap-2">
            <span className={labelClass}>Dietary Restrictions</span>
            {[
              { value: "vegetarian", label: "Vegetarian" },
              { value: "vegan", label: "Vegan" },
              { value: "halal", label: "Halal" },
              { value: "kosher", label: "Kosher" },
              { value: "keto", label: "Keto" },
              { value: "low-sodium", label: "Low sodium" },
              { value: "low-sugar", label: "Low sugar" },
              { value: "gluten-free", label: "Gluten-free" },
            ].map(({ value, label }) => (
              <label key={value} className="flex items-center gap-2 text-sm cursor-pointer">
                <input
                  type="checkbox"
                  name="dietaryRestrictions"
                  value={value}
                  defaultChecked={profile?.dietaryRestrictions?.includes(value)}
                  className="rounded accent-brand-600"
                />
                {label}
              </label>
            ))}
            <input
              name="customRestriction"
              placeholder="Other (comma-separated)"
              defaultValue={profile?.dietaryRestrictions?.filter(r => !["vegetarian","vegan","halal","kosher","keto","low-sodium","low-sugar","gluten-free"].includes(r)).join(", ")}
              className={inputClass + " mt-1"}
            />
          </div>

          <div className="grid gap-2">
            <span className={labelClass}>Pre-existing Conditions</span>
            {[
              { value: "type 1 diabetes", label: "Type 1 Diabetes" },
              { value: "type 2 diabetes", label: "Type 2 Diabetes" },
              { value: "hypertension", label: "Hypertension (high blood pressure)" },
              { value: "celiac disease", label: "Celiac Disease" },
              { value: "IBS", label: "IBS (Irritable Bowel Syndrome)" },
              { value: "high cholesterol", label: "High Cholesterol" },
              { value: "lactose intolerance", label: "Lactose Intolerance" },
              { value: "GERD", label: "GERD / Acid Reflux" },
            ].map(({ value, label }) => (
              <label key={value} className="flex items-center gap-2 text-sm cursor-pointer">
                <input
                  type="checkbox"
                  name="healthConditions"
                  value={value}
                  defaultChecked={profile?.healthConditions?.includes(value)}
                  className="rounded accent-brand-600"
                />
                {label}
              </label>
            ))}
            <input
              name="customCondition"
              placeholder="Other (comma-separated)"
              defaultValue={profile?.healthConditions?.filter(c => !["type 1 diabetes","type 2 diabetes","hypertension","celiac disease","IBS","high cholesterol","lactose intolerance","GERD"].includes(c)).join(", ")}
              className={inputClass + " mt-1"}
            />
          </div>

          <p className="text-xs text-gray-400">This information is used only to personalise your meal recommendations.</p>

          <button type="submit" className="rounded-xl bg-brand-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-brand-700 active:scale-[0.98] transition-all">
            Save health profile
          </button>
        </form>
      </Card>
    </div>
  );
}
