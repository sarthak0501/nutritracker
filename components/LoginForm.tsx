"use client";

import { useActionState } from "react";
import { loginAction } from "@/app/actions/auth";

export function LoginForm() {
  const [error, action, isPending] = useActionState(loginAction, null);

  return (
    <form action={action} className="space-y-4">
      <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-6 space-y-4">
        <label className="block space-y-1.5">
          <span className="text-sm text-zinc-400">Username</span>
          <input
            name="username"
            type="text"
            autoComplete="username"
            required
            className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2.5 text-zinc-100 placeholder-zinc-500 focus:border-zinc-500 focus:outline-none"
            placeholder="your username"
          />
        </label>
        <label className="block space-y-1.5">
          <span className="text-sm text-zinc-400">Password</span>
          <input
            name="password"
            type="password"
            autoComplete="current-password"
            required
            className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2.5 text-zinc-100 placeholder-zinc-500 focus:border-zinc-500 focus:outline-none"
            placeholder="••••••••"
          />
        </label>
        {error && (
          <div className="rounded-lg bg-red-950/50 border border-red-800 px-3 py-2 text-sm text-red-400">
            {error}
          </div>
        )}
        <button
          type="submit"
          disabled={isPending}
          className="w-full rounded-lg bg-zinc-100 px-4 py-2.5 text-sm font-semibold text-zinc-950 hover:bg-white disabled:opacity-50"
        >
          {isPending ? "Signing in…" : "Sign in"}
        </button>
      </div>
    </form>
  );
}
