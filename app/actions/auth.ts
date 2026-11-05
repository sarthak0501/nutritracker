"use server";

import { prisma } from "@/lib/db";
import bcrypt from "bcryptjs";
import { createSession, deleteSession } from "@/lib/auth-session";
import { redirect } from "next/navigation";
import { safeOAuthReturn } from "@/lib/oauth-config";

export async function loginAction(
  _prevState: string | null,
  formData: FormData
): Promise<string | null> {
  const usernameField = formData.get("username");
  const passwordField = formData.get("password");
  const username = typeof usernameField === "string" ? usernameField.trim() : "";
  const password = typeof passwordField === "string" ? passwordField : "";

  if (!username || !password) return "Please enter username and password";

  const user = await prisma.user.findUnique({ where: { username } });
  if (!user) return "Invalid username or password";

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) return "Invalid username or password";

  await createSession({ id: user.id, username: user.username });

  const next = safeOAuthReturn(formData.get("next"));
  if (next) redirect(next);

  const profile = await prisma.profile.findUnique({ where: { userId: user.id } });
  if (!profile?.onboardingCompleted) redirect("/onboarding");
  redirect("/");
}

export async function logoutAction() {
  await deleteSession();
  redirect("/login");
}
