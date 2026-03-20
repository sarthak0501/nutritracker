import { NextResponse } from "next/server";
import { z } from "zod";
import { suggestMeals } from "@/lib/meal-suggestions";
import { getSession } from "@/lib/auth-session";
import { prisma } from "@/lib/db";

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

    const session = await getSession();
    let allergies: string[] = [];
    let dietaryRestrictions: string[] = [];
    let healthConditions: string[] = [];

    if (session?.id) {
      const profile = await prisma.profile.findUnique({ where: { userId: session.id } });
      if (profile) {
        allergies = profile.allergies;
        dietaryRestrictions = profile.dietaryRestrictions;
        healthConditions = profile.healthConditions;
      }
    }

    const result = await suggestMeals({ ...input, allergies, dietaryRestrictions, healthConditions });
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
