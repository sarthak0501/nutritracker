"use client";

export function DraftPrivacy({ available, onDiscard, disabled = false }: { available: boolean; onDiscard: () => void; disabled?: boolean }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-gray-500">
      <p className="max-w-md">{available
        ? "Unsaved food details stay on this device for 24 hours after your last edit. They are cleared when you log out."
        : "Draft storage is unavailable. Keep this page open until your meal is saved."}</p>
      <button type="button" disabled={disabled} onClick={onDiscard} className="min-h-11 rounded-lg px-3 font-semibold text-gray-600 hover:bg-gray-100 disabled:opacity-50">Discard draft</button>
    </div>
  );
}
