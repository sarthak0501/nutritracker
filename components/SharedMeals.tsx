"use client";

import { useId, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/Card";
import { MealSelectionEditor, MEAL_OPTIONS, mealControl, mealPrimary, validMealPortion } from "@/components/MealLibrary";
import { respondMealProposal } from "@/app/actions/meals";
import { undoLogBatch } from "@/app/actions/logging";
import type { MealProposalView } from "@/lib/meal-types";

type MealType = typeof MEAL_OPTIONS[number]["value"];

function ProposalReview({ userId, proposal, onResult }: {
  userId: string;
  proposal: MealProposalView;
  onResult: (batchId: string | null, message: string) => void;
}) {
  const router = useRouter();
  const [selectedIds, setSelectedIds] = useState(proposal.items.map((item) => item.id));
  const [multiplier, setMultiplier] = useState("1");
  const [mealType, setMealType] = useState(proposal.mealType as MealType);
  const [date, setDate] = useState(proposal.date);
  const [error, setError] = useState<string | null>(null);
  const [resolved, setResolved] = useState(false);
  const [retryAction, setRetryAction] = useState<"accept" | "decline" | null>(null);
  const [pending, startTransition] = useTransition();
  const inFlight = useRef(false);
  const attemptedResponse = useRef<Parameters<typeof respondMealProposal>[0] | null>(null);
  const reviewLocked = pending || retryAction !== null;

  function respond(action: "accept" | "decline") {
    if (inFlight.current || resolved || (retryAction && retryAction !== action)) return;
    const attempt = attemptedResponse.current ?? (action === "decline"
      ? { expectedUserId: userId, proposalId: proposal.id, action }
      : { expectedUserId: userId, proposalId: proposal.id, action, date, mealType, multiplier: Number(multiplier), selectedItemIds: selectedIds });
    attemptedResponse.current = attempt;
    setRetryAction(action);
    inFlight.current = true;
    setError(null);
    startTransition(async () => {
      try {
        const result = await respondMealProposal(attempt);
        if (result.undone) onResult(null, "That accepted meal was already undone. Nothing was added to your log.");
        // Another tab may have accepted first with different choices; only confirm the returned count.
        else if (action === "accept" && result.batchId) onResult(result.batchId, `${result.entryCount ?? selectedIds.length} items saved to your log.`);
        else if (action === "decline") onResult(null, "Proposal declined. Your log is unchanged.");
        setResolved(true);
        router.refresh();
      } catch {
        setError(action === "accept" ? "Couldn’t confirm acceptance. Retry safely; the proposal can only be accepted once. If you switched accounts, reload this page." : "Couldn’t decline the proposal. Please try again, or reload if you switched accounts.");
      } finally { inFlight.current = false; }
    });
  }

  if (resolved) return <p role="status" className="rounded-xl bg-white/70 p-3 text-sm text-gray-700">Proposal updated.</p>;

  return (
    <article className="space-y-3 rounded-2xl border border-purple-100 bg-white/70 p-3 sm:p-4">
      <div>
        <h3 className="break-words text-sm font-bold text-gray-900">{proposal.name}</h3>
        <p className="mt-1 text-xs text-gray-600">From {proposal.sender.username} to you · {proposal.date}</p>
      </div>
      <p className="text-xs text-gray-600">Nothing is logged yet. Choose what you ate and your own portion.</p>
      <MealSelectionEditor items={proposal.items} selectedIds={selectedIds} multiplier={multiplier} onSelectedChange={setSelectedIds} onMultiplierChange={setMultiplier} disabled={reviewLocked} />
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <label className="block min-w-0 text-xs font-semibold text-gray-600">Your log date
          <input type="date" required value={date} onChange={(event) => setDate(event.target.value)} disabled={reviewLocked} className={`${mealControl} mt-1 block w-full min-w-0`} />
        </label>
        <label className="block min-w-0 text-xs font-semibold text-gray-600">Your meal
          <select value={mealType} onChange={(event) => setMealType(event.target.value as MealType)} disabled={reviewLocked} className={`${mealControl} mt-1 block w-full`}>{MEAL_OPTIONS.map((meal) => <option key={meal.value} value={meal.value}>{meal.label}</option>)}</select>
        </label>
      </div>
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => respond("accept")} disabled={pending || retryAction === "decline" || !selectedIds.length || !validMealPortion(multiplier) || !date} className={`${mealPrimary} flex-1`}>{pending ? "Working…" : retryAction === "accept" ? "Retry acceptance safely" : "Accept & save to my log"}</button>
        <button type="button" onClick={() => respond("decline")} disabled={pending || retryAction === "accept"} className={mealControl}>{retryAction === "decline" ? "Retry decline" : "Decline"}</button>
      </div>
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      {retryAction && !pending && <div className="space-y-2"><p className="text-xs text-gray-600">Your response is waiting for confirmation. Your selections are kept unchanged for a safe retry.</p><button type="button" className={mealControl} onClick={() => window.location.reload()}>Reload proposal status</button></div>}
    </article>
  );
}

type SharedMealsProps = {
  userId: string;
  date?: string;
  pending: MealProposalView[];
  sent: MealProposalView[];
};

export function SharedMeals(props: SharedMealsProps) {
  return <SharedMealsForAccount key={props.userId} {...props} />;
}

function SharedMealsForAccount({ userId, pending: proposals, sent }: SharedMealsProps) {
  const router = useRouter();
  const titleId = useId();
  const [batchId, setBatchId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const undoInFlight = useRef(false);

  if (proposals.length === 0 && sent.length === 0 && !batchId && !message) return null;

  return (
    <Card variant="social">
      <section aria-labelledby={titleId} className="space-y-3">
        <div>
          <h2 id={titleId} className="text-lg font-bold text-gray-900">Shared meals</h2>
          <p className="mt-1 text-xs text-gray-600">Same meal, your own choices. Only you can accept a meal into your log.</p>
        </div>
        {proposals.map((proposal) => <ProposalReview key={proposal.id} userId={userId} proposal={proposal} onResult={(id, nextMessage) => { if (id) setBatchId(id); setMessage(nextMessage); setError(null); }} />)}
        {proposals.length === 0 && <p className="text-sm text-gray-600">No meals waiting for your review.</p>}
        {sent.length > 0 && <details>
          <summary className="flex min-h-11 cursor-pointer items-center rounded-lg text-sm font-semibold text-gray-700 focus-visible:ring-2 focus-visible:ring-purple-500">Your sent proposals ({sent.length})</summary>
          <ul className="space-y-2 pt-2">{sent.map((proposal) => <li key={proposal.id} className="rounded-xl bg-white/70 p-3 text-sm text-gray-700"><span className="block break-words font-semibold">{proposal.name}</span><span className="block text-xs text-gray-500">To {proposal.recipient.username} · {proposal.date} · {proposal.status === "PENDING" ? "Waiting for their choice" : proposal.status === "ACCEPTED" ? "Accepted" : "Declined"}</span></li>)}</ul>
        </details>}
        <p role="status" aria-live="polite" className="text-sm text-brand-800">{message}</p>
        {batchId && <button type="button" disabled={pending} className={mealControl} onClick={() => {
          if (undoInFlight.current) return;
          undoInFlight.current = true;
          setError(null);
          startTransition(async () => {
            try {
              await undoLogBatch({ batchId, expectedUserId: userId });
              setBatchId(null); setMessage("Save undone. The accepted items were removed from your log."); router.refresh();
            } catch { setError("Couldn’t undo the save. Please try again, or reload if you switched accounts."); }
            finally { undoInFlight.current = false; }
          });
        }}>{pending ? "Undoing…" : "Undo accepted meal"}</button>}
        {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      </section>
    </Card>
  );
}
