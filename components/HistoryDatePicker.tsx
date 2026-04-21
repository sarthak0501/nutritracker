"use client";

import { useRouter } from "next/navigation";
import { useRef } from "react";

type Props = {
  date: string;
  maxDate: string;
};

export function HistoryDatePicker({ date, maxDate }: Props) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <button
      type="button"
      onClick={() => {
        const el = inputRef.current;
        if (!el) return;
        if (typeof el.showPicker === "function") el.showPicker();
        else el.click();
      }}
      className="rounded-xl bg-surface-muted px-3 py-2 text-sm font-semibold text-gray-600 hover:bg-gray-200 transition-colors"
      aria-label="Pick a date"
      title="Pick a date"
    >
      📅
      <input
        ref={inputRef}
        type="date"
        value={date}
        max={maxDate}
        onChange={(e) => {
          const v = e.target.value;
          if (!v) return;
          if (v === maxDate) router.push("/history");
          else router.push(`/history?date=${v}`);
        }}
        className="sr-only"
        aria-hidden="true"
        tabIndex={-1}
      />
    </button>
  );
}
