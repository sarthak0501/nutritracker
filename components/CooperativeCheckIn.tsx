"use client";

import { useId, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/Card";
import { mealControl, mealPrimary } from "@/components/MealLibrary";
import { completeWeeklyCheckIn, setCooperativeCheckIn } from "@/app/actions/meals";
import type { MealLibraryData } from "@/lib/meal-types";

type CooperativeCheckInProps = { userId: string; checkIn: MealLibraryData["checkIn"]; buddyName?: string };

export function CooperativeCheckIn(props: CooperativeCheckInProps) {
  return <CooperativeCheckInForAccount key={props.userId} {...props} />;
}

function CooperativeCheckInForAccount({ userId, checkIn, buddyName }: CooperativeCheckInProps) {
  const router = useRouter();
  const titleId = useId();
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const inFlight = useRef(false);

  function run(action: () => Promise<unknown>, success: string) {
    if (inFlight.current) return;
    inFlight.current = true;
    setError(null);
    startTransition(async () => {
      try { await action(); setMessage(success); router.refresh(); }
      catch { setError("Couldn’t save your check-in choice. Please try again, or reload if you switched accounts."); }
      finally { inFlight.current = false; }
    });
  }

  return (
    <Card variant="social">
      <section aria-labelledby={titleId} className="space-y-3">
        <div>
          <h2 id={titleId} className="text-lg font-bold text-gray-900">A small weekly win, together</h2>
          <p className="mt-1 text-sm text-gray-600">An optional check-in alongside your weekly challenge. No scores or reminders.</p>
        </div>
        {!checkIn.enabled ? <>
          <p className="text-xs text-gray-500">Turn it on for yourself. {buddyName ? `${buddyName} decides separately whether to join.` : "Your buddy chooses whether to join separately."}</p>
          <button type="button" disabled={pending} className={mealPrimary} onClick={() => run(() => setCooperativeCheckIn({ expectedUserId: userId, enabled: true }), "Your weekly check-in is on.")}>{pending ? "Saving…" : "Try weekly check-ins"}</button>
        </> : <>
          <p className="text-xs font-semibold text-gray-500">Week of {checkIn.weekStart}</p>
          <div className="rounded-xl bg-white/80 p-3 text-sm text-gray-700">
            <p className="font-semibold">What made logging easier this week?</p>
            <p className="mt-1">Take a moment to notice one small win and choose one meal to make easier next week.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <span className="rounded-full bg-brand-50 px-3 py-2 text-xs font-semibold text-brand-800">You: {checkIn.completed ? "✓ checked in" : "ready when you are"}</span>
            {buddyName && <span className="rounded-full bg-purple-50 px-3 py-2 text-xs text-purple-800">{buddyName}: {checkIn.buddyEnabled ? (checkIn.buddyCompleted ? "✓ checked in" : "ready when they are") : "hasn’t opted in"}</span>}
          </div>
          {!checkIn.completed && <button type="button" disabled={pending} className={mealPrimary} onClick={() => run(() => completeWeeklyCheckIn({ expectedUserId: userId }), "Your check-in is saved for this week.")}>{pending ? "Saving…" : "I’ve checked in this week"}</button>}
          <div><button type="button" disabled={pending} className={mealControl} onClick={() => run(() => setCooperativeCheckIn({ expectedUserId: userId, enabled: false }), "Your weekly check-in is off. Your buddy’s choice is unchanged.")}>Turn off for me</button></div>
        </>}
        <p role="status" aria-live="polite" className="text-sm text-brand-800">{message}</p>
        {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      </section>
    </Card>
  );
}
