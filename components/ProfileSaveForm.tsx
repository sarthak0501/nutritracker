"use client";

import { useTransition, useState, type ReactNode } from "react";

type Props = {
  action: (formData: FormData) => Promise<void>;
  submitLabel: string;
  children: ReactNode;
};

export function ProfileSaveForm({ action, submitLabel, children }: Props) {
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    startTransition(async () => {
      await action(fd);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    });
  }

  return (
    <form onSubmit={handleSubmit} className="grid gap-4">
      {children}
      <button
        type="submit"
        disabled={pending}
        className={`rounded-xl px-4 py-2.5 text-sm font-bold text-white transition-all active:scale-[0.98] disabled:opacity-60 ${
          saved ? "bg-green-500" : "bg-brand-600 hover:bg-brand-700"
        }`}
      >
        {pending ? "Saving…" : saved ? "Saved ✓" : submitLabel}
      </button>
    </form>
  );
}
