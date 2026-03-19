import { getSession } from "@/lib/auth-session";
import { redirect } from "next/navigation";

export async function requireSession() {
  const user = await getSession();
  if (!user) redirect("/login");
  return { id: user.id, name: user.username };
}
