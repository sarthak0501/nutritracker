import { Card } from "@/components/Card";
import { LogWorkoutTabs } from "@/components/LogWorkoutTabs";
import {
  applyEstimatedWorkout,
  createManualWorkoutEntry,
  deleteWorkoutEntry,
  addRecommendedExercise,
  addAllRecommendedExercises,
} from "@/app/actions/workout";
import { prisma } from "@/lib/db";
import { requireSession } from "@/lib/session";
import { round0 } from "@/lib/nutrition";

export default async function WorkoutsPage() {
  const user = await requireSession();
  const today = new Date().toISOString().slice(0, 10);

  const profile = await prisma.profile.findUnique({ where: { userId: user.id } });

  const profileData = {
    equipmentPreset: profile?.equipmentPreset ?? undefined,
    equipment: profile?.equipment ?? undefined,
    weightKg: profile?.weightKg ?? undefined,
    heightCm: profile?.heightCm ?? undefined,
    age: profile?.age ?? undefined,
    gender: profile?.gender ?? undefined,
  };

  const entries = await prisma.workoutEntry.findMany({
    where: { userId: user.id, date: today },
    orderBy: { createdAt: "asc" },
  });

  const totalBurned = entries.reduce((s, e) => s + e.caloriesBurned, 0);

  return (
    <div className="space-y-4">
      {/* Prompt to complete profile if missing key info */}
      {(!profile?.weightKg || !profile?.equipmentPreset) && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm">
          <span className="text-amber-800">
            {!profile?.weightKg && !profile?.equipmentPreset
              ? "Add your weight and equipment access in "
              : !profile?.weightKg
              ? "Add your weight in "
              : "Set your equipment access in "}
          </span>
          <a href="/profile" className="font-medium text-amber-900 underline">Profile</a>
          <span className="text-amber-800"> for better calorie estimates and workout recommendations.</span>
        </div>
      )}

      {/* Daily summary */}
      {entries.length > 0 && (
        <Card>
          <div className="flex items-baseline justify-between">
            <div className="text-sm text-slate-500">{today} · Workouts</div>
            <div className="text-xl font-bold tabular-nums">
              {round0(totalBurned)} <span className="text-sm font-normal text-slate-400">kcal burned</span>
            </div>
          </div>
          <div className="mt-1 text-sm text-slate-500">
            {entries.length} exercise{entries.length !== 1 ? "s" : ""} logged today
          </div>
        </Card>
      )}

      {/* Log workout / Get recommendations */}
      <Card title="Workouts">
        <LogWorkoutTabs
          date={today}
          weightKg={profileData.weightKg}
          profile={profileData}
          onApplyEstimate={applyEstimatedWorkout}
          manualAction={createManualWorkoutEntry}
          onAddRecommended={addRecommendedExercise}
          onAddAllRecommended={addAllRecommendedExercises}
        />
      </Card>

      {/* Logged exercises */}
      {entries.length > 0 && (
        <Card title="Today's exercises">
          <div className="space-y-2">
            {entries.map((e) => (
              <div key={e.id} className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-sm font-medium">{e.exerciseName}</div>
                    <div className="text-xs text-slate-500">
                      {e.muscleGroup && <span className="capitalize">{e.muscleGroup} · </span>}
                      {e.durationMinutes && <span>{e.durationMinutes} min · </span>}
                      {e.sets && e.reps && <span>{e.sets}×{e.reps} · </span>}
                      {e.weightKg && <span>{e.weightKg}kg · </span>}
                      ~{round0(e.caloriesBurned)} kcal
                      {e.isEstimated ? " · estimated" : ""}
                    </div>
                  </div>
                  <form action={deleteWorkoutEntry}>
                    <input type="hidden" name="id" value={e.id} />
                    <button className="text-xs text-slate-400 hover:text-red-500">×</button>
                  </form>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {entries.length === 0 && (
        <div className="text-center py-6 text-sm text-slate-400">
          No workouts logged today. Log exercises or get AI recommendations above.
        </div>
      )}
    </div>
  );
}
