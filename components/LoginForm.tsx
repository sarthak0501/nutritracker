"use client";

import { useActionState } from "react";
import { loginAction } from "@/app/actions/auth";

export function LoginForm() {
  const [error, action, isPending] = useActionState(loginAction, null);

  return (
    <form action={action} className="space-y-4">
      <div className="rounded-2xl bg-surface-card p-6 shadow-card space-y-4">
        <label className="block space-y-1.5">
          <span className="text-sm font-medium text-gray-700">Username</span>
          <input
            name="username"
            type="text"
            autoComplete="username"
            required
            className="w-full rounded-xl border-0 bg-surface-muted px-4 py-3 text-gray-900 placeholder-gray-400 ring-1 ring-transparent focus:bg-white focus:ring-2 focus:ring-brand-500 focus:outline-none transition-all"
            placeholder="your username"
          />
        </label>
        <label className="block space-y-1.5">
          <span className="text-sm font-medium text-gray-700">Password</span>
          <input
            name="password"
            type="password"
            autoComplete="current-password"
            required
            className="w-full rounded-xl border-0 bg-surface-muted px-4 py-3 text-gray-900 placeholder-gray-400 ring-1 ring-transparent focus:bg-white focus:ring-2 focus:ring-brand-500 focus:outline-none transition-all"
            placeholder="••••••••"
          />
        </label>
        {error && (
          <div className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-600">
            {error}
          </div>
        )}
        <button
          type="submit"
          disabled={isPending}
          className="w-full rounded-xl bg-brand-600 px-4 py-3 text-sm font-bold text-white hover:bg-brand-700 active:scale-[0.98] disabled:opacity-50 transition-all"
        >
          {isPending ? "Setting things up..." : "Get started"}
        </button>
      </div>
    </form>
  );
}
