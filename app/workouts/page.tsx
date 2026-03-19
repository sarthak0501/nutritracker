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

  const previousRaw = await prisma.workoutEntry.findMany({
    where: { userId: user.id, date: { not: today } },
    orderBy: { createdAt: "desc" },
    select: { exerciseName: true, sets: true, reps: true, weightKg: true, date: true },
  });

  const previousMap = new Map<string, typeof previousRaw[number]>();
  for (const p of previousRaw) {
    const key = p.exerciseName.toLowerCase();
    if (!previousMap.has(key)) previousMap.set(key, p);
  }
  const previousWorkouts = Array.from(previousMap.values());

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
      {(!profile?.weightKg || !profile?.equipmentPreset) && (
        <div className="rounded-2xl bg-brand-50 p-4 text-sm">
          <span className="text-brand-800 font-medium">
            {!profile?.weightKg && !profile?.equipmentPreset
              ? "Add your weight and equipment access in "
              : !profile?.weightKg
              ? "Add your weight in "
              : "Set your equipment access in "}
          </span>
          <a href="/profile" className="font-bold text-brand-600 underline underline-offset-2">Profile</a>
          <span className="text-brand-800"> for better estimates and recommendations.</span>
        </div>
      )}

      {entries.length > 0 && (
        <Card>
          <div className="flex items-center justify-between">
            <div>
              <div className="text-xs font-medium text-gray-400 uppercase tracking-wide">{today}</div>
              <div className="text-sm text-gray-500 mt-0.5">{entries.length} exercise{entries.length !== 1 ? "s" : ""} logged</div>
            </div>
            <div className="text-right">
              <div className="text-2xl font-extrabold tabular-nums text-blue-600">{round0(totalBurned)}</div>
              <div className="text-xs text-gray-400">kcal burned</div>
            </div>
          </div>
        </Card>
      )}

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

      {entries.length > 0 && (
        <Card title="Today's exercises">
          <div className="space-y-2">
            {entries.map((e) => (
              <div key={e.id} className="rounded-xl bg-gray-50 p-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-gray-800">{e.exerciseName}</div>
                    <div className="text-xs text-gray-500 mt-0.5">
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
                    <button className="rounded-lg p-1.5 text-gray-300 hover:bg-red-50 hover:text-red-400 transition-colors">
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
                    </button>
                  </form>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {entries.length === 0 && (
        <div className="text-center py-8 text-sm text-gray-400">
          No workouts logged today. Get started above.
        </div>
      )}

      {buddyId && (
        <Card title={`${buddyInfo?.username ?? "Buddy"}'s workout`}>
          {buddyWorkouts.length === 0 ? (
            <p className="text-sm text-gray-400">Your buddy hasn't logged any workouts today.</p>
          ) : (
            <>
              <div className="flex items-baseline justify-between mb-3">
                <span className="text-sm text-gray-500">{buddyWorkouts.length} exercises</span>
                <span className="text-lg font-bold tabular-nums text-blue-600">{round0(buddyTotalBurned)} kcal</span>
              </div>
              <div className="space-y-2">
                {buddyWorkouts.map((e, i) => (
                  <div key={i} className="rounded-xl bg-gray-50 p-2.5">
                    <div className="text-sm font-semibold text-gray-800">{e.exerciseName}</div>
                    <div className="text-xs text-gray-500">
                      {e.muscleGroup && <span className="capitalize">{e.muscleGroup} · </span>}
                      {e.sets && e.reps && <span>{e.sets}×{e.reps} · </span>}
                      {e.weightKg && <span>{e.weightKg}kg · </span>}
                      ~{round0(e.caloriesBurned)} kcal
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </Card>
      )}
    </div>
  );
}
