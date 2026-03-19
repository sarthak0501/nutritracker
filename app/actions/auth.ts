"use server";

import { signIn, signOut } from "@/auth";
import { AuthError } from "next-auth";
import { redirect } from "next/navigation";

export async function loginAction(
  _prevState: string | null,
  formData: FormData
): Promise<string | null> {
  try {
    await signIn("credentials", {
      username: formData.get("username") as string,
      password: formData.get("password") as string,
      redirect: false,
    });
  } catch (e) {
    if (e instanceof AuthError) return "Invalid username or password";
    throw e;
  }
  redirect("/");
}

export async function logoutAction() {
  await signOut({ redirectTo: "/login" });
}
