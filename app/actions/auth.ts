"use server";

import { signIn, signOut } from "@/auth";
import { AuthError } from "next-auth";

export async function loginAction(
  _prevState: string | null,
  formData: FormData
): Promise<string | null> {
  try {
    await signIn("credentials", {
      username: formData.get("username") as string,
      password: formData.get("password") as string,
      redirectTo: "/",
    });
  } catch (e) {
    if (e instanceof AuthError) return "Invalid username or password";
    throw e; // re-throw NEXT_REDIRECT so Next.js handles it
  }
  return null;
}

export async function logoutAction() {
  await signOut({ redirectTo: "/login" });
}
