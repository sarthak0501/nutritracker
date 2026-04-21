import { NextResponse } from "next/server";
import { z } from "zod";
import { generateMonthlySummary } from "@/lib/monthly-summary";

const RequestSchema = z.object({
  days: z.array(
    z.object({
      date: z.string(),
      kcal: z.number(),
      protein: z.number(),
      carbs: z.number(),
      fat: z.number(),
      fiber: z.number(),
      workoutKcal: z.number(),
      hasWorkout: z.boolean(),
    })
  ),
  targets: z.object({
    kcal: z.number(),
    protein: z.number(),
    carbs: z.number(),
    fat: z.number(),
    fiber: z.number().nullable(),
  }),
  weights: z.array(
    z.object({
      date: z.string(),
      weightKg: z.number(),
    })
  ),
  rangeDays: z.number(),
});

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as unknown;
    const input = RequestSchema.parse(body);
    const result = await generateMonthlySummary(input);
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
