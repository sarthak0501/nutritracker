import { auth } from "@/auth";
import { redirect } from "next/navigation";

export async function requireSession() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  return session.user as { id: string; name?: string | null };
}
