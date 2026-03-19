import { NextResponse } from "next/server";
import { z } from "zod";
import { estimateNutritionFromText } from "@/lib/llm";

const RequestSchema = z.object({
  text: z.string().min(1).max(2000)
});

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as unknown;
    const { text } = RequestSchema.parse(body);
    const result = await estimateNutritionFromText({ text });
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

