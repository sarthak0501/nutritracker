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

function AvatarBadge({ name }: { name: string }) {
  const initial = (name ?? "?")[0].toUpperCase();
  return (
    <div className="flex items-center justify-center w-8 h-8 rounded-full bg-gradient-to-br from-blue-400 to-indigo-500 text-white font-bold text-xs shadow-sm">
      {initial}
    </div>
  );
}

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
        <div className="rounded-2xl bg-accent-50 border border-accent-100 p-4 text-sm">
          <span className="text-amber-800 font-medium">
            {!profile?.weightKg && !profile?.equipmentPreset
              ? "Add your weight and equipment in "
              : !profile?.weightKg
              ? "Add your weight in "
              : "Set your equipment in "}
          </span>
          <a href="/profile" className="font-bold text-amber-700 underline underline-offset-2">Profile</a>
          <span className="text-amber-800"> for better estimates and recommendations.</span>
        </div>
      )}

      {/* Today's workout summary — prominent when exercises exist */}
      {entries.length > 0 && (
        <Card>
          <div className="flex items-center justify-between">
            <div>
              <div className="text-[11px] font-bold uppercase tracking-wide text-gray-400">Today's session</div>
              <div className="text-sm text-gray-600 mt-0.5">{entries.length} exercise{entries.length !== 1 ? "s" : ""} logged</div>
            </div>
            <div className="text-right">
              <div className="text-2xl font-extrabold tabular-nums text-blue-600">{round0(totalBurned)}</div>
              <div className="text-xs text-gray-400">kcal burned</div>
            </div>
          </div>
        </Card>
      )}

      {/* Log workout — action card */}
      <Card variant="action" title="What's your workout?">
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
              <div key={e.id} className="rounded-xl bg-surface-muted p-3">
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
        <div className="text-center py-8">
          <div className="text-3xl mb-2">🏋️</div>
          <div className="text-sm font-medium text-gray-500">No workouts logged today</div>
          <div className="text-xs text-gray-400 mt-1">Describe your workout above or get AI recommendations</div>
        </div>
      )}

      {/* Buddy workout — social card */}
      {buddyId && (
        <Card variant="social">
          <div className="flex items-center gap-3 mb-3">
            <AvatarBadge name={buddyInfo?.username ?? "B"} />
            <div>
              <div className="text-sm font-bold text-gray-800">{buddyInfo?.username ?? "Buddy"}'s workout</div>
              <div className="text-xs text-gray-400">See what your buddy is up to</div>
            </div>
          </div>
          {buddyWorkouts.length === 0 ? (
            <div className="text-center py-3">
              <div className="text-xs text-gray-400">Your buddy hasn't logged any workouts today.</div>
            </div>
          ) : (
            <>
              <div className="flex items-baseline justify-between mb-3">
                <span className="text-xs text-gray-500">{buddyWorkouts.length} exercises</span>
                <span className="text-lg font-bold tabular-nums text-blue-600">{round0(buddyTotalBurned)} kcal</span>
              </div>
              <div className="space-y-2">
                {buddyWorkouts.map((e, i) => (
                  <div key={i} className="rounded-xl bg-white/70 p-2.5">
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
