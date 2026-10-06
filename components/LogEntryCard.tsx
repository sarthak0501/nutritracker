"use client";

import { useRef, useState, useTransition, type ReactNode } from "react";
import { updateLogEntry, deleteLogEntry } from "@/app/actions/logging";

const MEALS = [
  { key: "BREAKFAST", label: "Breakfast" },
  { key: "LUNCH", label: "Lunch" },
  { key: "DINNER", label: "Dinner" },
  { key: "SNACK", label: "Snacks" },
  { key: "CUSTOM", label: "Custom" },
];

type Props = {
  userId: string;
  entryId: string;
  foodName: string;
  brand: string | null;
  amount: number;
  unit: string;
  mealType: string;
  macroLine: string;
  isLegacyPortion?: boolean;
  portionLabel?: string;
  children?: ReactNode; // reactions slot
};

export function LogEntryCard({
  userId,
  entryId,
  foodName,
  brand,
  amount,
  unit,
  mealType,
  macroLine,
  isLegacyPortion = false,
  portionLabel,
  children,
}: Props) {
  const [editing, setEditing] = useState(false);
  const [editAmount, setEditAmount] = useState(String(isLegacyPortion ? 1 : amount));
  const [editMealType, setEditMealType] = useState(mealType);
  const [saving, startSave] = useTransition();
  const [deleting, startDelete] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [deleted, setDeleted] = useState(false);
  const editBaseAmount = useRef(amount);
  const editOwnerId = useRef(userId);
  const requestIds = useRef(new Map<string, { requestId: string; expectedUserId: string }>());
  const inFlight = useRef(false);
  const step = isLegacyPortion || unit === "SERVING" ? 0.25 : 10;
  const amountNumber = Number(editAmount);
  const validAmount = editAmount.trim() !== "" && Number.isFinite(amountNumber) && amountNumber > 0 && (!isLegacyPortion || amountNumber <= 20);
  const busy = saving || deleting;

  function requestFor(key: string, expectedUserId: string) {
    const request = requestIds.current.get(key) ?? { requestId: crypto.randomUUID(), expectedUserId };
    requestIds.current.set(key, request);
    return request;
  }

  function adjustAmount(direction: 1 | -1) {
    const current = Number.isFinite(amountNumber) ? amountNumber : 0;
    const next = Math.max(isLegacyPortion || unit === "SERVING" ? 0.25 : 1, current + direction * step);
    setEditAmount(String(Number((isLegacyPortion ? Math.min(20, next) : next).toFixed(4))));
  }

  function handleSave() {
    if (inFlight.current || !validAmount) return;
    const targetAmount = isLegacyPortion ? editBaseAmount.current * amountNumber : amountNumber;
    const key = JSON.stringify({ entryId, targetAmount, editMealType });
    const { requestId, expectedUserId } = requestFor(key, editOwnerId.current);
    inFlight.current = true;
    setError(null);
    setNotice(null);
    startSave(async () => {
      try {
        const fd = new FormData();
        fd.set("id", entryId);
        fd.set("amount", String(targetAmount));
        fd.set("mealType", editMealType);
        fd.set("requestId", requestId);
        fd.set("expectedUserId", expectedUserId);
        if (isLegacyPortion) fd.set("portionMultiplier", String(amountNumber));
        await updateLogEntry(fd);
        requestIds.current.delete(key);
        setEditing(false);
        setNotice("Changes saved.");
      } catch {
        setError("Couldn't confirm your changes were saved. Your edits are still here; tap Save to retry.");
      } finally {
        inFlight.current = false;
      }
    });
  }

  function handleDelete() {
    if (inFlight.current) return;
    const key = `delete:${entryId}`;
    const { requestId, expectedUserId } = requestFor(key, userId);
    inFlight.current = true;
    setError(null);
    setNotice(null);
    startDelete(async () => {
      try {
        const fd = new FormData();
        fd.set("id", entryId);
        fd.set("requestId", requestId);
        fd.set("expectedUserId", expectedUserId);
        await deleteLogEntry(fd);
        requestIds.current.delete(key);
        setDeleted(true);
      } catch {
        setError("Couldn't confirm this item was deleted. Tap Delete to retry.");
      } finally {
        inFlight.current = false;
      }
    });
  }

  const unitLabel = isLegacyPortion ? "× logged portion" : unit === "GRAM" ? "g" : "servings";

  if (deleted) return <p role="status" className="rounded-xl bg-surface-muted p-3 text-sm text-gray-600">{foodName} deleted.</p>;

  return (
    <div className={`rounded-xl bg-surface-muted p-3 transition-opacity ${deleting ? "opacity-40" : ""}`}>
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold text-gray-800">
            {foodName}
            {brand && <span className="font-normal text-gray-400"> ({brand})</span>}
          </div>
          <div className="mt-0.5 text-xs text-gray-500 tabular-nums">{macroLine}</div>
        </div>

        <div className="flex items-center gap-1 flex-shrink-0">
          {/* Edit button */}
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              setEditing((o) => !o);
              setEditAmount(String(isLegacyPortion ? 1 : amount));
              editBaseAmount.current = amount;
              editOwnerId.current = userId;
              setEditMealType(mealType);
              setError(null);
              setNotice(null);
            }}
            className={`rounded-lg p-1.5 transition-colors ${
              editing
                ? "bg-blue-100 text-blue-500"
                : "text-gray-300 hover:bg-blue-50 hover:text-blue-400"
            }`}
            title="Edit"
            aria-label={`Edit ${foodName}`}
            aria-expanded={editing}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
            </svg>
          </button>

          {/* Delete button */}
          <button
            type="button"
            onClick={handleDelete}
            disabled={busy}
            className="rounded-lg p-1.5 text-gray-300 hover:bg-red-50 hover:text-red-400 transition-colors disabled:opacity-40"
            title="Delete"
            aria-label={`Delete ${foodName}`}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>

      {/* Inline edit form */}
      {editing && (
        <div className="mt-2 flex flex-wrap items-center gap-2 rounded-xl bg-blue-50 px-3 py-2.5">
          {/* Amount stepper */}
          <div className="flex items-center overflow-hidden rounded-lg border border-blue-100 bg-white">
            <button
              type="button"
              disabled={busy}
              aria-label={`Decrease ${isLegacyPortion ? "portion" : "amount"}`}
              onClick={() => adjustAmount(-1)}
              className="px-2.5 py-1.5 text-sm font-bold text-gray-500 hover:bg-gray-50 leading-none"
            >
              −
            </button>
            <input
              type="number"
              value={editAmount}
              min={isLegacyPortion || unit === "SERVING" ? 0.25 : 1}
              max={isLegacyPortion ? 20 : undefined}
              step={isLegacyPortion || unit === "SERVING" ? 0.25 : 1}
              disabled={busy}
              aria-label={isLegacyPortion ? "Multiplier of logged portion" : `Amount in ${unit === "GRAM" ? "grams" : "servings"}`}
              aria-invalid={!validAmount}
              onChange={(e) => setEditAmount(e.target.value)}
              className="w-14 border-0 bg-transparent text-center text-sm font-semibold tabular-nums focus:outline-none focus:ring-0"
            />
            <span className="pr-2 text-xs text-gray-400">{unitLabel}</span>
            <button
              type="button"
              disabled={busy}
              aria-label={`Increase ${isLegacyPortion ? "portion" : "amount"}`}
              onClick={() => adjustAmount(1)}
              className="px-2.5 py-1.5 text-sm font-bold text-gray-500 hover:bg-gray-50 leading-none"
            >
              +
            </button>
          </div>

          {/* Meal type */}
          <select
            value={editMealType}
            disabled={busy}
            aria-label="Meal"
            onChange={(e) => setEditMealType(e.target.value)}
            className="rounded-lg border border-blue-100 bg-white px-2.5 py-1.5 text-sm focus:ring-2 focus:ring-brand-500"
          >
            {MEALS.map((m) => (
              <option key={m.key} value={m.key}>{m.label}</option>
            ))}
          </select>

          <button
            type="button"
            onClick={handleSave}
            disabled={busy || !validAmount}
            className="rounded-lg bg-brand-600 px-3.5 py-1.5 text-xs font-bold text-white hover:bg-brand-700 disabled:opacity-50 transition-colors"
          >
            {saving ? "Saving…" : "Save"}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => { setEditing(false); setError(null); }}
            className="rounded-lg border border-gray-200 bg-white px-3.5 py-1.5 text-xs font-medium text-gray-500 hover:text-gray-700 transition-colors"
          >
            Cancel
          </button>
          {isLegacyPortion && <p className="w-full text-xs text-gray-600">{portionLabel ?? "Original logged portion"} · Use 0.5 for half or 2 for double. Grams are unknown.</p>}
          {!validAmount && <p className="w-full text-xs text-red-600">{isLegacyPortion ? "Enter a portion multiplier greater than 0 and no more than 20." : "Enter an amount greater than 0."}</p>}
        </div>
      )}

      {error && <p role="alert" className="mt-2 text-sm text-red-600">{error}</p>}
      {notice && <p role="status" className="mt-2 text-sm text-brand-700">{notice}</p>}

      {/* Reactions slot */}
      {children}
    </div>
  );
}
