"use client";

import { useOptimistic, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toggleReaction } from "@/app/actions/reactions";

type ReactionType = "THUMBS_UP" | "THUMBS_DOWN" | "FIRE" | "MUSCLE";

const REACTIONS: { type: ReactionType; emoji: string; label: string }[] = [
  { type: "THUMBS_UP", emoji: "👍", label: "Nice!" },
  { type: "THUMBS_DOWN", emoji: "👎", label: "Hmm" },
  { type: "FIRE", emoji: "🔥", label: "On fire!" },
  { type: "MUSCLE", emoji: "💪", label: "Strong!" },
];

type Reaction = {
  id: string;
  type: ReactionType;
  userId: string;
  user: { id: string; username: string };
};

export function ReactionBar({
  logEntryId,
  currentUserId,
  reactions,
}: {
  logEntryId: string;
  currentUserId: string;
  reactions: Reaction[];
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();

  const [optimisticReactions, setOptimisticReactions] = useOptimistic(
    reactions,
    (state: Reaction[], { type, add }: { type: ReactionType; add: boolean }) => {
      if (add) {
        const fake: Reaction = {
          id: "optimistic-" + type,
          type,
          userId: currentUserId,
          user: { id: currentUserId, username: "you" },
        };
        return [...state, fake];
      }
      return state.filter((r) => !(r.userId === currentUserId && r.type === type));
    }
  );

  function countFor(type: ReactionType) {
    return optimisticReactions.filter((r) => r.type === type).length;
  }

  function hasReacted(type: ReactionType) {
    return optimisticReactions.some((r) => r.userId === currentUserId && r.type === type);
  }

  function handleToggle(type: ReactionType) {
    const adding = !hasReacted(type);
    startTransition(async () => {
      setOptimisticReactions({ type, add: adding });
      await toggleReaction(logEntryId, type);
      router.refresh();
    });
  }

  return (
    <div className="flex items-center gap-1 flex-wrap mt-2">
      {REACTIONS.map(({ type, emoji }) => {
        const count = countFor(type);
        const active = hasReacted(type);
        return (
          <button
            key={type}
            onClick={() => handleToggle(type)}
            title={REACTIONS.find(r => r.type === type)?.label}
            className={`flex items-center gap-1 rounded-full px-2.5 py-1 text-xs transition-all ${
              active
                ? "bg-slate-200 text-slate-900 scale-110"
                : "bg-slate-100 text-slate-500 hover:bg-slate-200 hover:text-slate-700"
            }`}
          >
            <span>{emoji}</span>
            {count > 0 && <span className="tabular-nums font-medium">{count}</span>}
          </button>
        );
      })}
    </div>
  );
}
