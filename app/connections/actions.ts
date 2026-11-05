"use server";
import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/session";
import { revokeUserConnection } from "@/lib/oauth";
export async function disconnectAssistant(form: FormData) {
  const session = await requireSession();
  const connectionId = form.get("connectionId");
  if (typeof connectionId !== "string" || connectionId.length > 100) return;
  await revokeUserConnection(session.id, connectionId);
  revalidatePath("/connections");
}
