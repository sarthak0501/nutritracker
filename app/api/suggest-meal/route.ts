import { NextResponse } from "next/server";
import { z } from "zod";
import { suggestMeals } from "@/lib/meal-suggestions";

const RequestSchema = z.object({
  remainingKcal: z.number(),
  remainingProtein: z.number(),
  remainingCarbs: z.number(),
  remainingFat: z.number(),
  mealSlot: z.string(),
});

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as unknown;
    const input = RequestSchema.parse(body);
    const result = await suggestMeals(input);
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
