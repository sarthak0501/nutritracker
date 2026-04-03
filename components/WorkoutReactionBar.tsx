"use client";

import { useOptimistic, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toggleWorkoutReaction } from "@/app/actions/workout-reactions";

type ReactionType = "THUMBS_UP" | "THUMBS_DOWN" | "FIRE" | "MUSCLE";

const REACTIONS: { type: ReactionType; emoji: string; activeColor: string }[] = [
  { type: "THUMBS_UP", emoji: "👍", activeColor: "bg-green-100 text-green-700 ring-1 ring-green-200" },
  { type: "FIRE",      emoji: "🔥", activeColor: "bg-orange-100 text-orange-700 ring-1 ring-orange-200" },
  { type: "MUSCLE",    emoji: "💪", activeColor: "bg-purple-100 text-purple-700 ring-1 ring-purple-200" },
];

type Reaction = { id: string; type: ReactionType; userId: string; user: { id: string; username: string } };

export function WorkoutReactionBar({
  workoutEntryId,
  currentUserId,
  reactions,
}: {
  workoutEntryId: string;
  currentUserId: string;
  reactions: Reaction[];
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();

  const [optimisticReactions, setOptimisticReactions] = useOptimistic(
    reactions,
    (state: Reaction[], { type, add }: { type: ReactionType; add: boolean }) => {
      if (add) {
        return [...state, { id: "opt-" + type, type, userId: currentUserId, user: { id: currentUserId, username: "you" } }];
      }
      return state.filter((r) => !(r.userId === currentUserId && r.type === type));
    }
  );

  function count(type: ReactionType) {
    return optimisticReactions.filter((r) => r.type === type).length;
  }

  function hasReacted(type: ReactionType) {
    return optimisticReactions.some((r) => r.userId === currentUserId && r.type === type);
  }

  function handleToggle(type: ReactionType) {
    const adding = !hasReacted(type);
    startTransition(async () => {
      setOptimisticReactions({ type, add: adding });
      await toggleWorkoutReaction(workoutEntryId, type);
      router.refresh();
    });
  }

  return (
    <div className="flex items-center gap-1.5 flex-wrap mt-2">
      {REACTIONS.map(({ type, emoji, activeColor }) => {
        const n = count(type);
        const active = hasReacted(type);
        return (
          <button
            key={type}
            onClick={() => handleToggle(type)}
            className={`flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium transition-all active:scale-95 ${
              active ? `${activeColor} scale-105 shadow-sm` : "bg-white/80 text-gray-400 hover:bg-gray-100 hover:text-gray-600 shadow-sm"
            }`}
          >
            <span className={active ? "text-sm" : ""}>{emoji}</span>
            {n > 0 && <span className="tabular-nums font-bold">{n}</span>}
          </button>
        );
      })}
    </div>
  );
}
