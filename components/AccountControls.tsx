"use client";

import { useEffect, useRef, useState } from "react";
import { logoutAction } from "@/app/actions/auth";
import { clearMealDrafts, pruneMealDrafts } from "@/lib/drafts";

const ACCOUNT_KEY = "nutritracker:active-account";
const CHANGE_KEY = "nutritracker:account-change";
function announceAccountChange() {
  try { window.localStorage.setItem(CHANGE_KEY, crypto.randomUUID()); } catch { /* Storage can be unavailable in private browsing. */ }
}

export function DraftPrivacyBoundary({ userId }: { userId: string | null }) {
  const previousUser = useRef(userId);
  const [changedElsewhere, setChangedElsewhere] = useState(false);
  useEffect(() => {
    if (!userId || previousUser.current !== userId) clearMealDrafts();
    if (userId) pruneMealDrafts(userId);
    previousUser.current = userId;
    try {
      const storedUser = window.localStorage.getItem(ACCOUNT_KEY);
      if (storedUser && storedUser !== userId) announceAccountChange();
      if (userId) window.localStorage.setItem(ACCOUNT_KEY, userId);
      else window.localStorage.removeItem(ACCOUNT_KEY);
    } catch { /* Draft persistence also degrades gracefully without storage. */ }
  }, [userId]);
  useEffect(() => {
    const changed = (event: StorageEvent) => {
      if (event.key !== CHANGE_KEY) return;
      clearMealDrafts();
      const main = document.getElementById("main-content");
      if (main) { main.inert = true; main.style.visibility = "hidden"; }
      setChangedElsewhere(true);
    };
    window.addEventListener("storage", changed);
    return () => window.removeEventListener("storage", changed);
  }, []);
  if (!changedElsewhere) return null;
  return <div role="alertdialog" aria-modal="true" aria-labelledby="account-changed-title" className="fixed inset-0 z-50 flex items-center justify-center bg-surface p-6">
    <div className="max-w-sm space-y-4 text-center">
      <h1 id="account-changed-title" className="text-lg font-bold">Your account changed in another tab</h1>
      <p className="text-sm text-gray-600">Local drafts were cleared. Reload to continue with your current account.</p>
      <button autoFocus onClick={() => window.location.reload()} className="rounded-xl bg-brand-600 px-5 py-3 font-semibold text-white">Reload securely</button>
    </div>
  </div>;
}

export function LogoutButton({ username }: { username: string }) {
  return (
    <form action={logoutAction} onSubmit={() => { clearMealDrafts(); announceAccountChange(); }} className="shrink-0">
      <button className="rounded-xl bg-surface-muted px-3 py-2 text-xs font-medium text-gray-600 hover:bg-gray-200" aria-label={`Log out ${username}`}>
        <span className="hidden sm:inline">{username} · </span>Log out
      </button>
    </form>
  );
}
