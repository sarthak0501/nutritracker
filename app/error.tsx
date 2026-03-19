"use client";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="rounded-2xl bg-red-50 p-6 space-y-3">
      <div className="text-red-600 font-bold">Something went wrong</div>
      <div className="text-sm text-gray-500 font-mono break-all">
        {error.message || "Unknown error"}
      </div>
      {error.digest && (
        <div className="text-xs text-gray-400">Digest: {error.digest}</div>
      )}
      <button
        onClick={reset}
        className="rounded-xl bg-brand-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-brand-700 transition-colors"
      >
        Try again
      </button>
    </div>
  );
}
