"use client";

import { useRouter } from "next/navigation";

type Props = { date: string; maxDate: string };

export function HistoryDatePicker({ date, maxDate }: Props) {
  const router = useRouter();
  return (
    <label className="relative flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-surface-muted text-gray-600 focus-within:ring-2 focus-within:ring-brand-600">
      <span aria-hidden="true">📅</span>
      <input
        type="date"
        aria-label="Pick a date"
        value={date}
        max={maxDate}
        onChange={(event) => {
          const value = event.target.value;
          if (value) router.push(value === maxDate ? "/history" : `/history?date=${value}`);
        }}
        className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
      />
    </label>
  );
}
