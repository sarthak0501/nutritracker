export default function TodayPage() {
  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
        <div className="text-sm text-zinc-400">Today</div>
        <div className="text-lg font-semibold">{today}</div>
        <div className="mt-2 text-sm text-zinc-400">
          Next: meal logging + totals + LLM estimate flow.
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
          <div className="text-sm font-medium">Log a meal</div>
          <div className="mt-1 text-sm text-zinc-400">
            Add foods to breakfast/lunch/dinner/snacks.
          </div>
        </div>
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
          <div className="text-sm font-medium">Estimate from text</div>
          <div className="mt-1 text-sm text-zinc-400">
            Paste what you ate; LLM will estimate nutrition (marked as
            estimates).
          </div>
        </div>
      </div>
    </div>
  );
}

