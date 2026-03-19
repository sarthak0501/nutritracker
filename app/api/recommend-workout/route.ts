import { NextResponse } from "next/server";
import { z } from "zod";
import { recommendWorkout } from "@/lib/workout-llm";

const RequestSchema = z.object({
  focus: z.string().min(1).max(200),
  equipmentPreset: z.string().optional(),
  equipment: z.array(z.string()).optional(),
  weightKg: z.number().positive().optional(),
  heightCm: z.number().positive().optional(),
  age: z.number().positive().optional(),
  gender: z.string().optional(),
});

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as unknown;
    const input = RequestSchema.parse(body);
    const result = await recommendWorkout(input);
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
