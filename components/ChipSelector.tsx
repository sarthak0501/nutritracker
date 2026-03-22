"use client";

import { useState } from "react";

export function ChipSelector({
  name,
  options,
  selected: initialSelected,
}: {
  name: string;
  options: string[];
  selected: string[];
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set(initialSelected.filter(s => options.includes(s))));

  function toggle(value: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(value)) {
        next.delete(value);
      } else {
        next.add(value);
      }
      return next;
    });
  }

  return (
    <div className="flex flex-wrap gap-2">
      {options.map((option) => {
        const isSelected = selected.has(option);
        return (
          <label
            key={option}
            className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium cursor-pointer transition-all active:scale-95 select-none ${
              isSelected
                ? "bg-brand-100 text-brand-700 ring-1 ring-brand-300"
                : "bg-surface-muted text-gray-500 hover:bg-gray-200 hover:text-gray-700"
            }`}
          >
            <input
              type="checkbox"
              name={name}
              value={option}
              checked={isSelected}
              onChange={() => toggle(option)}
              className="sr-only"
            />
            {isSelected && <span className="text-brand-500">✓</span>}
            <span className="capitalize">{option}</span>
          </label>
        );
      })}
    </div>
  );
}
