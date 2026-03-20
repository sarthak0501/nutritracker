import { NextResponse } from "next/server";
import { z } from "zod";
import { generateWeeklySummary } from "@/lib/weekly-summary";

const RequestSchema = z.object({
  days: z.array(
    z.object({
      date: z.string(),
      kcal: z.number(),
      protein: z.number(),
      carbs: z.number(),
      fat: z.number(),
      fiber: z.number(),
    })
  ),
  targets: z.object({
    kcal: z.number(),
    protein: z.number(),
    carbs: z.number(),
    fat: z.number(),
    fiber: z.number().nullable(),
  }),
  workoutDays: z.number(),
  totalBurned: z.number(),
  weightChange: z.number().nullable(),
});

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as unknown;
    const input = RequestSchema.parse(body);
    const result = await generateWeeklySummary(input);
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
