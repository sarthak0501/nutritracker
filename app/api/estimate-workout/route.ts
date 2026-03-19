import { NextResponse } from "next/server";
import { z } from "zod";
import { estimateWorkoutFromText } from "@/lib/workout-llm";

const RequestSchema = z.object({
  text: z.string().min(1).max(2000),
  weightKg: z.number().positive().optional(),
});

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as unknown;
    const { text, weightKg } = RequestSchema.parse(body);
    const result = await estimateWorkoutFromText({ text, weightKg });
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
