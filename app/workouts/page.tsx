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
import { getBuddyId, getBuddyInfo } from "@/lib/buddy";
import { todayIsoDate } from "@/lib/dates";

export default async function WorkoutsPage() {
  const user = await requireSession();
  const today = todayIsoDate();

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

  // Fetch previous workout data (most recent entry per exercise, excluding today)
  const previousRaw = await prisma.workoutEntry.findMany({
    where: { userId: user.id, date: { not: today } },
    orderBy: { createdAt: "desc" },
    select: {
      exerciseName: true,
      sets: true,
      reps: true,
      weightKg: true,
      date: true,
    },
  });

  // De-dup to most recent per exercise name
  const previousMap = new Map<string, typeof previousRaw[number]>();
  for (const p of previousRaw) {
    const key = p.exerciseName.toLowerCase();
    if (!previousMap.has(key)) previousMap.set(key, p);
  }
  const previousWorkouts = Array.from(previousMap.values());

  // Buddy workout data
  const buddyId = await getBuddyId(user.id);
  let buddyWorkouts: { exerciseName: string; muscleGroup: string | null; sets: number | null; reps: number | null; weightKg: number | null; caloriesBurned: number }[] = [];
  let buddyInfo: { username: string } | null = null;
  let buddyTotalBurned = 0;

  if (buddyId) {
    const [info, bWorkouts] = await Promise.all([
      getBuddyInfo(buddyId),
      prisma.workoutEntry.findMany({
        where: { userId: buddyId, date: today },
        orderBy: { createdAt: "asc" },
      }),
    ]);
    buddyInfo = info;
    buddyWorkouts = bWorkouts;
    buddyTotalBurned = bWorkouts.reduce((s, e) => s + e.caloriesBurned, 0);
  }

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
          previousWorkouts={previousWorkouts}
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

      {/* Buddy workout feed */}
      {buddyId && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <span className="text-base font-semibold">{buddyInfo?.username ?? "Buddy"}'s Workout</span>
          </div>

          {buddyWorkouts.length === 0 ? (
            <Card>
              <p className="text-sm text-slate-500">Your buddy hasn't logged any workouts today.</p>
            </Card>
          ) : (
            <Card>
              <div className="flex items-baseline justify-between mb-3">
                <div className="text-sm text-slate-500">Training load</div>
                <div className="text-lg font-bold tabular-nums">
                  {round0(buddyTotalBurned)} <span className="text-sm font-normal text-slate-400">kcal burned</span>
                </div>
              </div>
              <div className="space-y-2">
                {buddyWorkouts.map((e, i) => (
                  <div key={i} className="rounded-lg border border-slate-200 bg-slate-50 p-2.5">
                    <div className="text-sm font-medium">{e.exerciseName}</div>
                    <div className="text-xs text-slate-500">
                      {e.muscleGroup && <span className="capitalize">{e.muscleGroup} · </span>}
                      {e.sets && e.reps && <span>{e.sets}×{e.reps} · </span>}
                      {e.weightKg && <span>{e.weightKg}kg · </span>}
                      ~{round0(e.caloriesBurned)} kcal
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}
