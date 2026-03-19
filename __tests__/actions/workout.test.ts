import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  createManualWorkoutEntry,
  applyEstimatedWorkout,
  addRecommendedExercise,
  addAllRecommendedExercises,
  deleteWorkoutEntry,
} from "@/app/actions/workout";
import type { WorkoutEstimateResponse, RecommendedExercise } from "@/lib/workout-llm";

vi.mock("@/lib/session", () => ({
  requireSession: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    workoutEntry: {
      create: vi.fn(),
      deleteMany: vi.fn(),
    },
  },
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

import { requireSession } from "@/lib/session";
import { prisma } from "@/lib/db";
import { revalidatePath } from "next/cache";

const mockRequireSession = requireSession as ReturnType<typeof vi.fn>;
const mockPrisma = prisma as {
  workoutEntry: {
    create: ReturnType<typeof vi.fn>;
    deleteMany: ReturnType<typeof vi.fn>;
  };
};
const mockRevalidatePath = revalidatePath as ReturnType<typeof vi.fn>;

const SESSION_USER = { id: "user-1", name: "alice" };

function makeFormData(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  return fd;
}

describe("createManualWorkoutEntry", () => {
  const VALID_WORKOUT = {
    exerciseName: "Bench Press",
    caloriesBurned: "150",
    date: "2024-01-15",
    muscleGroup: "chest",
    durationMinutes: "30",
    sets: "4",
    reps: "10",
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireSession.mockResolvedValue(SESSION_USER);
    mockPrisma.workoutEntry.create.mockResolvedValue({});
  });

  it("creates workout entry with valid data", async () => {
    const fd = makeFormData(VALID_WORKOUT);
    await createManualWorkoutEntry(fd);

    expect(mockPrisma.workoutEntry.create).toHaveBeenCalledOnce();
    const data = mockPrisma.workoutEntry.create.mock.calls[0][0].data;
    expect(data.exerciseName).toBe("Bench Press");
    expect(data.userId).toBe("user-1");
    expect(data.caloriesBurned).toBe(150);
    expect(data.date).toBe("2024-01-15");
  });

  it("throws when exerciseName is missing", async () => {
    const { exerciseName: _, ...rest } = VALID_WORKOUT;
    const fd = makeFormData(rest);
    await expect(createManualWorkoutEntry(fd)).rejects.toThrow("Missing required fields");
  });

  it("throws when caloriesBurned is zero/falsy", async () => {
    const fd = makeFormData({ ...VALID_WORKOUT, caloriesBurned: "0" });
    await expect(createManualWorkoutEntry(fd)).rejects.toThrow("Missing required fields");
  });

  it("throws when date is missing", async () => {
    const { date: _, ...rest } = VALID_WORKOUT;
    const fd = makeFormData(rest);
    await expect(createManualWorkoutEntry(fd)).rejects.toThrow("Missing required fields");
  });

  it("stores optional fields as null when not provided", async () => {
    const fd = makeFormData({
      exerciseName: "Push-ups",
      caloriesBurned: "50",
      date: "2024-01-15",
    });
    await createManualWorkoutEntry(fd);
    const data = mockPrisma.workoutEntry.create.mock.calls[0][0].data;
    expect(data.muscleGroup).toBeNull();
    expect(data.durationMinutes).toBeNull();
    expect(data.sets).toBeNull();
    expect(data.reps).toBeNull();
  });

  it("revalidates correct paths", async () => {
    const fd = makeFormData(VALID_WORKOUT);
    await createManualWorkoutEntry(fd);
    expect(mockRevalidatePath).toHaveBeenCalledWith("/");
    expect(mockRevalidatePath).toHaveBeenCalledWith("/workouts");
  });
});

describe("applyEstimatedWorkout", () => {
  const ESTIMATE: WorkoutEstimateResponse = {
    exercises: [
      {
        exerciseName: "Running",
        muscleGroup: "cardio",
        durationMinutes: 30,
        caloriesBurned: 300,
        confidence: 0.9,
        assumptions: ["moderate pace"],
      },
      {
        exerciseName: "Pull-ups",
        caloriesBurned: 50,
        confidence: 0.8,
        assumptions: [],
      },
    ],
    recommendations: [],
    notes: [],
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireSession.mockResolvedValue(SESSION_USER);
    mockPrisma.workoutEntry.create.mockResolvedValue({});
  });

  it("creates one entry per exercise", async () => {
    await applyEstimatedWorkout({ date: "2024-01-15", estimate: ESTIMATE, sourceText: "ran and did pull-ups" });
    expect(mockPrisma.workoutEntry.create).toHaveBeenCalledTimes(2);
  });

  it("marks entries as estimated with sourceText", async () => {
    await applyEstimatedWorkout({ date: "2024-01-15", estimate: ESTIMATE, sourceText: "my workout" });
    const data = mockPrisma.workoutEntry.create.mock.calls[0][0].data;
    expect(data.isEstimated).toBe(true);
    expect(data.sourceText).toBe("my workout");
  });

  it("stores confidence and assumptions in estimationMeta", async () => {
    await applyEstimatedWorkout({ date: "2024-01-15", estimate: ESTIMATE, sourceText: "workout" });
    const data = mockPrisma.workoutEntry.create.mock.calls[0][0].data;
    expect(data.estimationMeta.confidence).toBe(0.9);
    expect(data.estimationMeta.assumptions).toEqual(["moderate pace"]);
  });
});

describe("addRecommendedExercise", () => {
  const EXERCISE: RecommendedExercise & { userWeightKg?: number } = {
    exerciseName: "Barbell Squat",
    muscleGroup: "legs",
    sets: 4,
    reps: 10,
    restSeconds: 90,
    durationMinutes: 8,
    estimatedCalories: 60,
    notes: "Keep core tight",
    userWeightKg: 75,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireSession.mockResolvedValue(SESSION_USER);
    mockPrisma.workoutEntry.create.mockResolvedValue({});
  });

  it("creates one workout entry", async () => {
    await addRecommendedExercise({ date: "2024-01-15", exercise: EXERCISE });
    expect(mockPrisma.workoutEntry.create).toHaveBeenCalledOnce();
  });

  it("stores exercise details correctly", async () => {
    await addRecommendedExercise({ date: "2024-01-15", exercise: EXERCISE });
    const data = mockPrisma.workoutEntry.create.mock.calls[0][0].data;
    expect(data.exerciseName).toBe("Barbell Squat");
    expect(data.caloriesBurned).toBe(60);
    expect(data.weightKg).toBe(75);
    expect(data.sourceText).toBe("AI recommendation");
    expect(data.isEstimated).toBe(true);
  });

  it("uses null for weightKg when userWeightKg not provided", async () => {
    const { userWeightKg: _, ...exerciseWithoutWeight } = EXERCISE;
    await addRecommendedExercise({ date: "2024-01-15", exercise: exerciseWithoutWeight });
    const data = mockPrisma.workoutEntry.create.mock.calls[0][0].data;
    expect(data.weightKg).toBeNull();
  });
});

describe("addAllRecommendedExercises", () => {
  const EXERCISES: (RecommendedExercise & { userWeightKg?: number })[] = [
    { exerciseName: "Squat", muscleGroup: "legs", sets: 3, reps: 10, estimatedCalories: 50 },
    { exerciseName: "Deadlift", muscleGroup: "back", sets: 3, reps: 8, estimatedCalories: 70 },
    { exerciseName: "Bench Press", muscleGroup: "chest", sets: 4, reps: 8, estimatedCalories: 60 },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireSession.mockResolvedValue(SESSION_USER);
    mockPrisma.workoutEntry.create.mockResolvedValue({});
  });

  it("creates one entry per exercise", async () => {
    await addAllRecommendedExercises({ date: "2024-01-15", exercises: EXERCISES });
    expect(mockPrisma.workoutEntry.create).toHaveBeenCalledTimes(3);
  });

  it("all entries are scoped to current user", async () => {
    await addAllRecommendedExercises({ date: "2024-01-15", exercises: EXERCISES });
    for (const call of mockPrisma.workoutEntry.create.mock.calls) {
      expect(call[0].data.userId).toBe("user-1");
    }
  });

  it("handles empty exercises array without error", async () => {
    await addAllRecommendedExercises({ date: "2024-01-15", exercises: [] });
    expect(mockPrisma.workoutEntry.create).not.toHaveBeenCalled();
  });
});

describe("deleteWorkoutEntry", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireSession.mockResolvedValue(SESSION_USER);
    mockPrisma.workoutEntry.deleteMany.mockResolvedValue({ count: 1 });
  });

  it("deletes entry scoped to current user", async () => {
    const fd = makeFormData({ id: "entry-1" });
    await deleteWorkoutEntry(fd);

    expect(mockPrisma.workoutEntry.deleteMany).toHaveBeenCalledWith({
      where: { id: "entry-1", userId: "user-1" },
    });
  });

  it("throws when id is missing", async () => {
    const fd = makeFormData({});
    await expect(deleteWorkoutEntry(fd)).rejects.toThrow("Missing id");
  });

  it("revalidates correct paths", async () => {
    const fd = makeFormData({ id: "entry-1" });
    await deleteWorkoutEntry(fd);
    expect(mockRevalidatePath).toHaveBeenCalledWith("/");
    expect(mockRevalidatePath).toHaveBeenCalledWith("/workouts");
  });
});
