"use server";

import { prisma } from "@/lib/db";
import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/session";
import type { WorkoutEstimateResponse } from "@/lib/workout-llm";

export async function createManualWorkoutEntry(formData: FormData) {
  const user = await requireSession();

  const exerciseName = (formData.get("exerciseName") as string)?.trim();
  const muscleGroup = (formData.get("muscleGroup") as string)?.trim() || null;
  const durationMinutes = formData.get("durationMinutes") ? Number(formData.get("durationMinutes")) : null;
  const sets = formData.get("sets") ? Number(formData.get("sets")) : null;
  const reps = formData.get("reps") ? Number(formData.get("reps")) : null;
  const caloriesBurned = Number(formData.get("caloriesBurned"));
  const date = formData.get("date") as string;

  if (!exerciseName || !caloriesBurned || !date) throw new Error("Missing required fields");

  await prisma.workoutEntry.create({
    data: {
      userId: user.id,
      date,
      exerciseName,
      muscleGroup,
      durationMinutes,
      sets,
      reps,
      caloriesBurned,
    },
  });

  revalidatePath("/");
  revalidatePath("/workouts");
}

export async function applyEstimatedWorkout(input: {
  date: string;
  estimate: WorkoutEstimateResponse;
  sourceText: string;
}) {
  const user = await requireSession();

  for (const ex of input.estimate.exercises) {
    await prisma.workoutEntry.create({
      data: {
        userId: user.id,
        date: input.date,
        exerciseName: ex.exerciseName,
        muscleGroup: ex.muscleGroup,
        durationMinutes: ex.durationMinutes,
        sets: ex.sets,
        reps: ex.reps,
        caloriesBurned: ex.caloriesBurned,
        isEstimated: true,
        sourceText: input.sourceText,
        estimationMeta: {
          confidence: ex.confidence,
          assumptions: ex.assumptions,
        },
      },
    });
  }

  revalidatePath("/");
  revalidatePath("/workouts");
}

export async function deleteWorkoutEntry(formData: FormData) {
  const user = await requireSession();
  const id = (formData.get("id") as string)?.trim();
  if (!id) throw new Error("Missing id");

  await prisma.workoutEntry.deleteMany({ where: { id, userId: user.id } });

  revalidatePath("/");
  revalidatePath("/workouts");
}
