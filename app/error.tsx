"use client";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="rounded-xl border border-red-200 bg-red-50 p-6 space-y-3">
      <div className="text-red-600 font-semibold">Something went wrong</div>
      <div className="text-sm text-slate-500 font-mono break-all">
        {error.message || "Unknown error"}
      </div>
      {error.digest && (
        <div className="text-xs text-slate-400">Digest: {error.digest}</div>
      )}
      <button
        onClick={reset}
        className="rounded-lg bg-slate-900 px-3 py-2 text-sm text-white hover:bg-slate-800"
      >
        Try again
      </button>
    </div>
  );
}
