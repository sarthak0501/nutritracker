"use server";

import { requireSession } from "@/lib/session";
import { prisma } from "@/lib/db";
import { revalidatePath } from "next/cache";

export async function sendBuddyRequest(formData: FormData) {
  const user = await requireSession();
  const username = (formData.get("username") as string)?.trim();
  if (!username) return;

  const target = await prisma.user.findUnique({ where: { username } });
  if (!target || target.id === user.id) return;

  const existing = await prisma.buddyRelationship.findFirst({
    where: {
      OR: [
        { requesterId: user.id, addresseeId: target.id },
        { requesterId: target.id, addresseeId: user.id },
      ],
    },
  });
  if (existing) return;

  await prisma.buddyRelationship.create({
    data: { requesterId: user.id, addresseeId: target.id, status: "PENDING" },
  });

  revalidatePath("/buddy");
}

export async function respondToBuddyRequest(formData: FormData) {
  const user = await requireSession();
  const id = formData.get("id") as string;
  const action = formData.get("action") as "accept" | "decline";

  const rel = await prisma.buddyRelationship.findUnique({ where: { id } });
  if (!rel || rel.addresseeId !== user.id) return;

  if (action === "accept") {
    await prisma.buddyRelationship.update({ where: { id }, data: { status: "ACCEPTED" } });
  } else {
    await prisma.buddyRelationship.delete({ where: { id } });
  }

  revalidatePath("/buddy");
}

export async function removeBuddy(formData: FormData) {
  const user = await requireSession();
  const id = formData.get("id") as string;

  const rel = await prisma.buddyRelationship.findUnique({ where: { id } });
  if (!rel) return;
  if (rel.requesterId !== user.id && rel.addresseeId !== user.id) return;

  await prisma.buddyRelationship.delete({ where: { id } });
  revalidatePath("/buddy");
}
