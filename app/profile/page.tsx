import { Card } from "@/components/Card";
import { prisma } from "@/lib/db";
import { updateProfile, updateBodyStats, updateHealthProfile } from "@/app/actions/profile";
import { requireSession } from "@/lib/session";
import { ChipSelector } from "@/components/ChipSelector";
import { ProfileSaveForm } from "@/components/ProfileSaveForm";
import { ThemePicker } from "@/components/ThemePicker";

export default async function ProfilePage() {
  const user = await requireSession();
  const profile = await prisma.profile.findUnique({ where: { userId: user.id } });

  const inputClass = "rounded-xl border-0 bg-surface-muted px-3 py-2.5 placeholder-gray-400 focus:ring-2 focus:ring-brand-500 text-sm";
  const labelClass = "text-xs font-medium text-gray-500";

  const ALLERGY_OPTIONS = ["peanuts", "tree nuts", "dairy", "eggs", "gluten/wheat", "soy", "shellfish", "fish"];
  const RESTRICTION_OPTIONS = ["vegetarian", "vegan", "halal", "kosher", "keto", "low-sodium", "low-sugar", "gluten-free"];
  const CONDITION_OPTIONS = ["type 1 diabetes", "type 2 diabetes", "hypertension", "celiac disease", "IBS", "high cholesterol", "lactose intolerance", "GERD"];

  return (
    <div className="space-y-4 max-w-lg mx-auto">
      <div>
        <h1 className="text-xl font-bold">Your Profile</h1>
        <p className="text-sm text-gray-500 mt-1">Signed in as <span className="text-gray-800 font-semibold">{user.name}</span></p>
      </div>

      <Card title="Theme">
        <ThemePicker current={profile?.theme ?? "light"} />
      </Card>

      <Card title="Body Stats">
        <ProfileSaveForm action={updateBodyStats} submitLabel="Save body stats">
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
        </ProfileSaveForm>
      </Card>

      <Card title="Your Nutrition Goals">
        <ProfileSaveForm action={updateProfile} submitLabel="Save goals">
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
        </ProfileSaveForm>
      </Card>

      <Card title="Health & Dietary Profile">
        <ProfileSaveForm action={updateHealthProfile} submitLabel="Save health profile">
          <div className="space-y-2">
            <span className={labelClass}>Allergies</span>
            <ChipSelector
              name="allergies"
              options={ALLERGY_OPTIONS}
              selected={profile?.allergies ?? []}
            />
            <input
              name="customAllergy"
              placeholder="Other allergies (comma-separated)"
              defaultValue={profile?.allergies?.filter(a => !ALLERGY_OPTIONS.includes(a)).join(", ")}
              className={inputClass + " w-full mt-1"}
            />
          </div>

          <div className="space-y-2">
            <span className={labelClass}>Dietary Restrictions</span>
            <ChipSelector
              name="dietaryRestrictions"
              options={RESTRICTION_OPTIONS}
              selected={profile?.dietaryRestrictions ?? []}
            />
            <input
              name="customRestriction"
              placeholder="Other restrictions (comma-separated)"
              defaultValue={profile?.dietaryRestrictions?.filter(r => !RESTRICTION_OPTIONS.includes(r)).join(", ")}
              className={inputClass + " w-full mt-1"}
            />
          </div>

          <div className="space-y-2">
            <span className={labelClass}>Pre-existing Conditions</span>
            <ChipSelector
              name="healthConditions"
              options={CONDITION_OPTIONS}
              selected={profile?.healthConditions ?? []}
            />
            <input
              name="customCondition"
              placeholder="Other conditions (comma-separated)"
              defaultValue={profile?.healthConditions?.filter(c => !CONDITION_OPTIONS.includes(c)).join(", ")}
              className={inputClass + " w-full mt-1"}
            />
          </div>

          <p className="text-xs text-gray-400">This information personalises your meal recommendations.</p>
        </ProfileSaveForm>
      </Card>
    </div>
  );
}
