"use server";

import { requireSession } from "@/lib/session";
import { prisma } from "@/lib/db";
import { revalidatePath } from "next/cache";
import { removeOwnedBuddyRelationship, setOwnerMealLoggingGrant } from "@/lib/buddy-grants";
import { assertExpectedUser } from "@/lib/expected-user";

export async function sendBuddyRequest(formData: FormData) {
  const user = await requireSession();
  const username = (formData.get("username") as string)?.trim();
  if (!username) return;

  const target = await prisma.user.findUnique({ where: { username } });
  if (!target || target.id === user.id) return;

  await prisma.$transaction(async tx => {
    // Simultaneous requests in opposite directions should create one invitation.
    const pair = JSON.stringify([user.id, target.id].sort());
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`buddy-request:${pair}`}, 0))`;
    const existing = await tx.buddyRelationship.findFirst({
      where: { OR: [
        { requesterId: user.id, addresseeId: target.id },
        { requesterId: target.id, addresseeId: user.id },
      ] },
    });
    if (!existing) await tx.buddyRelationship.create({ data: { requesterId: user.id, addresseeId: target.id } });
  });

  revalidatePath("/buddy");
}

export async function respondToBuddyRequest(formData: FormData) {
  const user = await requireSession();
  const id = formData.get("id") as string;
  const action = formData.get("action") as "accept" | "decline";

  const where = { id, addresseeId: user.id, status: "PENDING" as const };
  if (action === "accept") {
    await prisma.buddyRelationship.updateMany({ where, data: { status: "ACCEPTED" } });
  } else if (action === "decline") {
    await prisma.buddyRelationship.deleteMany({ where });
  }

  revalidatePath("/buddy");
}

export async function removeBuddy(formData: FormData) {
  const user = await requireSession();
  assertExpectedUser(user.id, formData.get("expectedUserId"));
  const id = formData.get("id") as string;

  if (typeof id !== "string" || !id) return;
  await removeOwnedBuddyRelationship(user.id, id);
  revalidatePath("/buddy");
}

export async function setBuddyMealLogging(formData: FormData) {
  const user = await requireSession();
  const id = formData.get("id");
  const allow = formData.get("allow");
  if (typeof id !== "string" || !id || (allow !== "true" && allow !== "false")) return;
  assertExpectedUser(user.id, formData.get("expectedUserId"));
  await setOwnerMealLoggingGrant(user.id, id, allow === "true");
  revalidatePath("/buddy");
}
