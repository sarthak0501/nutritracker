"use client";

import { useState, useTransition, type ReactNode } from "react";
import { updateLogEntry, deleteLogEntry } from "@/app/actions/logging";

const MEALS = [
  { key: "BREAKFAST", label: "Breakfast" },
  { key: "LUNCH", label: "Lunch" },
  { key: "DINNER", label: "Dinner" },
  { key: "SNACK", label: "Snacks" },
  { key: "CUSTOM", label: "Custom" },
];

type Props = {
  entryId: string;
  foodName: string;
  brand: string | null;
  amount: number;
  unit: string;
  mealType: string;
  macroLine: string;
  children?: ReactNode; // reactions slot
};

export function LogEntryCard({
  entryId,
  foodName,
  brand,
  amount,
  unit,
  mealType,
  macroLine,
  children,
}: Props) {
  const [editing, setEditing] = useState(false);
  const [editAmount, setEditAmount] = useState(Math.round(amount));
  const [editMealType, setEditMealType] = useState(mealType);
  const [saving, startSave] = useTransition();
  const [deleting, startDelete] = useTransition();

  function handleSave() {
    startSave(async () => {
      const fd = new FormData();
      fd.set("id", entryId);
      fd.set("amount", String(editAmount));
      fd.set("mealType", editMealType);
      await updateLogEntry(fd);
      setEditing(false);
    });
  }

  function handleDelete() {
    startDelete(async () => {
      const fd = new FormData();
      fd.set("id", entryId);
      await deleteLogEntry(fd);
    });
  }

  const unitLabel = unit === "GRAM" ? "g" : "srv";

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
            onClick={() => {
              setEditing((o) => !o);
              setEditAmount(Math.round(amount));
              setEditMealType(mealType);
            }}
            className={`rounded-lg p-1.5 transition-colors ${
              editing
                ? "bg-blue-100 text-blue-500"
                : "text-gray-300 hover:bg-blue-50 hover:text-blue-400"
            }`}
            title="Edit"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
            </svg>
          </button>

          {/* Delete button */}
          <button
            onClick={handleDelete}
            disabled={deleting}
            className="rounded-lg p-1.5 text-gray-300 hover:bg-red-50 hover:text-red-400 transition-colors disabled:opacity-40"
            title="Delete"
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
              onClick={() => setEditAmount((a) => Math.max(1, a - 10))}
              className="px-2.5 py-1.5 text-sm font-bold text-gray-500 hover:bg-gray-50 leading-none"
            >
              −
            </button>
            <input
              type="number"
              value={editAmount}
              onChange={(e) => setEditAmount(Math.max(1, Number(e.target.value) || 1))}
              className="w-14 border-0 bg-transparent text-center text-sm font-semibold tabular-nums focus:outline-none focus:ring-0"
            />
            <span className="pr-2 text-xs text-gray-400">{unitLabel}</span>
            <button
              type="button"
              onClick={() => setEditAmount((a) => a + 10)}
              className="px-2.5 py-1.5 text-sm font-bold text-gray-500 hover:bg-gray-50 leading-none"
            >
              +
            </button>
          </div>

          {/* Meal type */}
          <select
            value={editMealType}
            onChange={(e) => setEditMealType(e.target.value)}
            className="rounded-lg border border-blue-100 bg-white px-2.5 py-1.5 text-sm focus:ring-2 focus:ring-brand-500"
          >
            {MEALS.map((m) => (
              <option key={m.key} value={m.key}>{m.label}</option>
            ))}
          </select>

          <button
            onClick={handleSave}
            disabled={saving}
            className="rounded-lg bg-brand-600 px-3.5 py-1.5 text-xs font-bold text-white hover:bg-brand-700 disabled:opacity-50 transition-colors"
          >
            {saving ? "Saving…" : "Save"}
          </button>
          <button
            onClick={() => setEditing(false)}
            className="rounded-lg border border-gray-200 bg-white px-3.5 py-1.5 text-xs font-medium text-gray-500 hover:text-gray-700 transition-colors"
          >
            Cancel
          </button>
        </div>
      )}

      {/* Reactions slot */}
      {children}
    </div>
  );
}
