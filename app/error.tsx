"use client";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="rounded-xl border border-red-900 bg-red-950/30 p-6 space-y-3">
      <div className="text-red-400 font-semibold">Something went wrong</div>
      <div className="text-sm text-zinc-400 font-mono break-all">
        {error.message || "Unknown error"}
      </div>
      {error.digest && (
        <div className="text-xs text-zinc-500">Digest: {error.digest}</div>
      )}
      <button
        onClick={reset}
        className="rounded-lg bg-zinc-800 px-3 py-2 text-sm hover:bg-zinc-700"
      >
        Try again
      </button>
    </div>
  );
}
