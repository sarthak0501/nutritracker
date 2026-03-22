"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { completeOnboarding } from "@/app/actions/profile";

const GOALS = [
  { value: "lose", label: "Lose weight", desc: "Calorie deficit with high protein", emoji: "🔥" },
  { value: "maintain", label: "Stay healthy", desc: "Balanced nutrition for maintenance", emoji: "⚖️" },
  { value: "muscle", label: "Build muscle", desc: "High calories and protein for gains", emoji: "💪" },
  { value: "health", label: "Improve overall health", desc: "Nutrient-dense, whole-food eating", emoji: "🌿" },
];

const GOAL_TARGETS: Record<string, { kcalTarget: number; proteinTarget: number; carbsTarget: number; fatTarget: number; fiberTarget: number }> = {
  lose:     { kcalTarget: 1500, proteinTarget: 140, carbsTarget: 150, fatTarget: 50, fiberTarget: 35 },
  maintain: { kcalTarget: 2000, proteinTarget: 120, carbsTarget: 250, fatTarget: 70, fiberTarget: 30 },
  muscle:   { kcalTarget: 2600, proteinTarget: 180, carbsTarget: 300, fatTarget: 85, fiberTarget: 35 },
  health:   { kcalTarget: 1800, proteinTarget: 110, carbsTarget: 220, fatTarget: 60, fiberTarget: 35 },
};

const COMMON_ALLERGIES = ["peanuts", "tree nuts", "dairy", "eggs", "gluten/wheat", "soy", "shellfish", "fish"];
const COMMON_RESTRICTIONS = ["vegetarian", "vegan", "halal", "kosher", "keto", "low-sodium", "low-sugar", "gluten-free"];
const COMMON_CONDITIONS = ["type 1 diabetes", "type 2 diabetes", "hypertension", "celiac disease", "IBS", "high cholesterol", "lactose intolerance", "GERD"];

function toggle(arr: string[], item: string): string[] {
  return arr.includes(item) ? arr.filter((x) => x !== item) : [...arr, item];
}

const inputClass = "rounded-xl border-0 bg-surface-muted px-3 py-2.5 placeholder-gray-400 focus:ring-2 focus:ring-brand-500 text-sm w-full";

export function OnboardingWizard() {
  const [step, setStep] = useState(1);
  const [goal, setGoal] = useState("maintain");
  const [heightCm, setHeightCm] = useState("");
  const [weightKg, setWeightKg] = useState("");
  const [age, setAge] = useState("");
  const [gender, setGender] = useState("");
  const [allergies, setAllergies] = useState<string[]>([]);
  const [restrictions, setRestrictions] = useState<string[]>([]);
  const [conditions, setConditions] = useState<string[]>([]);
  const [showSuccess, setShowSuccess] = useState(false);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  const targets = GOAL_TARGETS[goal];

  function handleComplete() {
    startTransition(async () => {
      await completeOnboarding({
        goal,
        heightCm: heightCm ? Number(heightCm) : undefined,
        weightKg: weightKg ? Number(weightKg) : undefined,
        age: age ? Number(age) : undefined,
        gender: gender || undefined,
        ...targets,
        allergies,
        dietaryRestrictions: restrictions,
        healthConditions: conditions,
      });
      setShowSuccess(true);
      setTimeout(() => {
        router.push("/");
        router.refresh();
      }, 1500);
    });
  }

  if (showSuccess) {
    return (
      <div className="text-center py-8 space-y-3">
        <div className="text-4xl">🎉</div>
        <div className="text-lg font-bold text-gray-900">You're all set!</div>
        <div className="text-sm text-gray-500">Taking you to your dashboard...</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Step indicator */}
      <div className="flex gap-2">
        {[1, 2, 3].map((s) => (
          <div key={s} className={`h-1.5 flex-1 rounded-full transition-all ${s <= step ? "bg-brand-600" : "bg-gray-200"}`} />
        ))}
      </div>

      {/* Step 1 — Goal */}
      {step === 1 && (
        <div className="space-y-4">
          <div>
            <h2 className="text-lg font-bold text-gray-900">What's your goal?</h2>
            <p className="text-sm text-gray-500 mt-1">This sets your daily calorie and macro targets. You can adjust them later.</p>
          </div>
          <div className="grid gap-2">
            {GOALS.map((g) => (
              <button
                key={g.value}
                type="button"
                onClick={() => setGoal(g.value)}
                className={`flex items-center gap-3 rounded-xl p-3.5 text-left transition-all border-2 ${goal === g.value ? "border-brand-500 bg-brand-50" : "border-transparent bg-surface-muted hover:bg-gray-100"}`}
              >
                <span className="text-2xl">{g.emoji}</span>
                <div>
                  <div className="font-semibold text-sm text-gray-900">{g.label}</div>
                  <div className="text-xs text-gray-500">{g.desc}</div>
                </div>
              </button>
            ))}
          </div>
          <div className="rounded-xl bg-brand-50 border border-brand-100 p-3">
            <div className="text-[10px] font-medium text-brand-600 uppercase tracking-wide mb-1.5">Your daily targets</div>
            <div className="grid grid-cols-4 gap-2 text-center">
              <div><div className="text-sm font-bold text-gray-800">{targets.kcalTarget}</div><div className="text-[10px] text-gray-400">kcal</div></div>
              <div><div className="text-sm font-bold text-gray-800">{targets.proteinTarget}g</div><div className="text-[10px] text-gray-400">protein</div></div>
              <div><div className="text-sm font-bold text-gray-800">{targets.carbsTarget}g</div><div className="text-[10px] text-gray-400">carbs</div></div>
              <div><div className="text-sm font-bold text-gray-800">{targets.fatTarget}g</div><div className="text-[10px] text-gray-400">fat</div></div>
            </div>
          </div>
          <button onClick={() => setStep(2)} className="w-full rounded-xl bg-brand-600 px-4 py-3 text-sm font-bold text-white hover:bg-brand-700 transition-all active:scale-[0.98]">
            Continue
          </button>
        </div>
      )}

      {/* Step 2 — Body stats */}
      {step === 2 && (
        <div className="space-y-4">
          <div>
            <h2 className="text-lg font-bold text-gray-900">About you</h2>
            <p className="text-sm text-gray-500 mt-1">Helps us give more accurate calorie estimates and workout recommendations. Totally optional.</p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-gray-500 mb-1 block">Height (cm)</label>
              <input type="number" value={heightCm} onChange={(e) => setHeightCm(e.target.value)} placeholder="170" className={inputClass} />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-500 mb-1 block">Weight (kg)</label>
              <input type="number" value={weightKg} onChange={(e) => setWeightKg(e.target.value)} placeholder="70" className={inputClass} />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-500 mb-1 block">Age</label>
              <input type="number" value={age} onChange={(e) => setAge(e.target.value)} placeholder="25" className={inputClass} />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-500 mb-1 block">Gender</label>
              <select value={gender} onChange={(e) => setGender(e.target.value)} className={inputClass + " text-gray-900"}>
                <option value="">—</option>
                <option value="male">Male</option>
                <option value="female">Female</option>
                <option value="other">Other</option>
              </select>
            </div>
          </div>
          <div className="flex gap-3">
            <button onClick={() => setStep(1)} className="flex-1 rounded-xl bg-gray-100 px-4 py-3 text-sm font-bold text-gray-600 hover:bg-gray-200 transition-all">
              Back
            </button>
            <button onClick={() => setStep(3)} className="flex-1 rounded-xl bg-brand-600 px-4 py-3 text-sm font-bold text-white hover:bg-brand-700 transition-all active:scale-[0.98]">
              Continue
            </button>
          </div>
        </div>
      )}

      {/* Step 3 — Dietary & health */}
      {step === 3 && (
        <div className="space-y-5">
          <div>
            <h2 className="text-lg font-bold text-gray-900">Dietary preferences</h2>
            <p className="text-sm text-gray-500 mt-1">We use this to personalise meal suggestions. Tap any that apply, or skip to finish.</p>
          </div>

          <div>
            <div className="text-xs font-medium text-gray-500 mb-2">Allergies</div>
            <div className="flex flex-wrap gap-2">
              {COMMON_ALLERGIES.map((a) => (
                <button key={a} type="button" onClick={() => setAllergies(toggle(allergies, a))}
                  className={`rounded-full px-3 py-1.5 text-xs font-medium transition-all ${allergies.includes(a) ? "bg-red-100 text-red-700 ring-1 ring-red-200" : "bg-surface-muted text-gray-600 hover:bg-gray-200"}`}>
                  {allergies.includes(a) && <span className="mr-1">✕</span>}{a}
                </button>
              ))}
            </div>
          </div>

          <div>
            <div className="text-xs font-medium text-gray-500 mb-2">Dietary restrictions</div>
            <div className="flex flex-wrap gap-2">
              {COMMON_RESTRICTIONS.map((r) => (
                <button key={r} type="button" onClick={() => setRestrictions(toggle(restrictions, r))}
                  className={`rounded-full px-3 py-1.5 text-xs font-medium transition-all ${restrictions.includes(r) ? "bg-brand-100 text-brand-700 ring-1 ring-brand-200" : "bg-surface-muted text-gray-600 hover:bg-gray-200"}`}>
                  {restrictions.includes(r) && <span className="mr-1">✓</span>}{r}
                </button>
              ))}
            </div>
          </div>

          <div>
            <div className="text-xs font-medium text-gray-500 mb-2">Health conditions</div>
            <div className="flex flex-wrap gap-2">
              {COMMON_CONDITIONS.map((c) => (
                <button key={c} type="button" onClick={() => setConditions(toggle(conditions, c))}
                  className={`rounded-full px-3 py-1.5 text-xs font-medium transition-all ${conditions.includes(c) ? "bg-orange-100 text-orange-700 ring-1 ring-orange-200" : "bg-surface-muted text-gray-600 hover:bg-gray-200"}`}>
                  {conditions.includes(c) && <span className="mr-1">✓</span>}{c}
                </button>
              ))}
            </div>
          </div>

          <div className="rounded-xl bg-purple-50 border border-purple-100 p-3">
            <div className="text-xs text-purple-700">
              <span className="font-semibold">Tip:</span> After setup, add an accountability buddy from the Buddy tab to stay motivated together.
            </div>
          </div>

          <div className="flex gap-3">
            <button onClick={() => setStep(2)} className="flex-1 rounded-xl bg-gray-100 px-4 py-3 text-sm font-bold text-gray-600 hover:bg-gray-200 transition-all">
              Back
            </button>
            <button onClick={handleComplete} disabled={isPending}
              className="flex-1 rounded-xl bg-brand-600 px-4 py-3 text-sm font-bold text-white hover:bg-brand-700 disabled:opacity-60 transition-all active:scale-[0.98]">
              {isPending ? "Setting up..." : "Start tracking"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
