import { NextResponse } from "next/server";
import { z } from "zod";
import { estimateDayFromText } from "@/lib/day-estimate";

const RequestSchema = z.object({
  text: z.string().min(10, "Please describe at least a few foods").max(3000),
});

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as unknown;
    const { text } = RequestSchema.parse(body);
    const result = await estimateDayFromText(text);
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
