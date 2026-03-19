"use client";

import { useActionState } from "react";
import { loginAction } from "@/app/actions/auth";

export function LoginForm() {
  const [error, action, isPending] = useActionState(loginAction, null);

  return (
    <form action={action} className="space-y-4">
      <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm space-y-4">
        <label className="block space-y-1.5">
          <span className="text-sm text-slate-600">Username</span>
          <input
            name="username"
            type="text"
            autoComplete="username"
            required
            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-slate-900 placeholder-slate-400 focus:border-slate-500 focus:outline-none"
            placeholder="your username"
          />
        </label>
        <label className="block space-y-1.5">
          <span className="text-sm text-slate-600">Password</span>
          <input
            name="password"
            type="password"
            autoComplete="current-password"
            required
            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-slate-900 placeholder-slate-400 focus:border-slate-500 focus:outline-none"
            placeholder="••••••••"
          />
        </label>
        {error && (
          <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-600">
            {error}
          </div>
        )}
        <button
          type="submit"
          disabled={isPending}
          className="w-full rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
        >
          {isPending ? "Signing in…" : "Sign in"}
        </button>
      </div>
    </form>
  );
}
