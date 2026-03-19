import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth-session";

export async function GET() {
  const results: Record<string, unknown> = {};

  try {
    const session = await getSession();
    results.session = session ? { id: session.id, username: session.username } : null;
  } catch (e) {
    results.sessionError = String(e);
  }

  try {
    const users = await prisma.user.findMany({ select: { id: true, username: true } });
    results.users = users;
  } catch (e) {
    results.usersError = String(e);
  }

  try {
    const profile = await prisma.profile.findFirst();
    results.profile = profile ? "found" : "none";
  } catch (e) {
    results.profileError = String(e);
  }

  try {
    const foods = await prisma.food.findMany({ take: 5 });
    results.foodCount = foods.length;
  } catch (e) {
    results.foodsError = String(e);
  }

  try {
    const today = new Date().toISOString().slice(0, 10);
    const entries = await prisma.logEntry.findMany({
      where: { date: today },
      include: {
        food: true,
        reactions: { include: { user: { select: { id: true, username: true } } } },
      },
      take: 5,
    });
    results.entryCount = entries.length;
  } catch (e) {
    results.entriesError = String(e);
  }

  try {
    const buddy = await prisma.buddyRelationship.findFirst();
    results.buddy = buddy ? "found" : "none";
  } catch (e) {
    results.buddyError = String(e);
  }

  return NextResponse.json(results);
}
