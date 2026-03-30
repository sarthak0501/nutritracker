"use client";

import { useEffect, useState } from "react";
import type { DayScore, WeekResult } from "@/lib/challenge";
import { MAX_PER_WEEK } from "@/lib/challenge";

const DAY_LETTER = ["M", "T", "W", "T", "F", "S", "S"];

type Props = {
  myName: string;
  buddyName: string;
  currentWeek: WeekResult;
  pastWeeks: WeekResult[];
  todayIso: string;
};

export function WeeklyChallenge({ myName, buddyName, currentWeek, pastWeeks, todayIso }: Props) {
  const [animated, setAnimated] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setAnimated(true), 200);
    return () => clearTimeout(t);
  }, []);

  const { myScores, buddyScores, myTotal, buddyTotal, days } = currentWeek;
  const myPct = Math.min(100, (myTotal / MAX_PER_WEEK) * 100);
  const buddyPct = Math.min(100, (buddyTotal / MAX_PER_WEEK) * 100);
  const diff = myTotal - buddyTotal;
  const daysLeft = days.filter((d) => d > todayIso).length;
  const weekEnded = daysLeft === 0;

  const myWins = pastWeeks.filter((w) => w.winner === "me").length;
  const buddyWins = pastWeeks.filter((w) => w.winner === "buddy").length;

  const weekLabel = `${days[0].slice(5).replace("-", "/")} – ${days[6].slice(5).replace("-", "/")}`;

  return (
    <div className="space-y-5">
      {/* Header row */}
      <div className="flex items-center justify-between">
        <div>
          <div className="text-[11px] font-bold uppercase tracking-wide text-purple-400">
            Weekly Challenge
          </div>
          <div className="text-xs text-gray-400 mt-0.5">{weekLabel}</div>
        </div>
        {!weekEnded && daysLeft > 0 && (
          <span className="rounded-full border border-amber-100 bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-600">
            {daysLeft}d left
          </span>
        )}
        {weekEnded && diff > 0 && (
          <span className="rounded-full border border-green-200 bg-green-50 px-2.5 py-1 text-xs font-bold text-green-700">
            🏆 You won!
          </span>
        )}
        {weekEnded && diff < 0 && (
          <span className="rounded-full border border-purple-200 bg-purple-50 px-2.5 py-1 text-xs font-bold text-purple-700">
            {buddyName} won
          </span>
        )}
        {weekEnded && diff === 0 && (
          <span className="rounded-full border border-gray-200 bg-gray-50 px-2.5 py-1 text-xs font-bold text-gray-500">
            Tied 🤝
          </span>
        )}
      </div>

      {/* Scoreboard */}
      <div className="flex items-center justify-between px-1">
        <div className="text-center">
          <div className="text-4xl font-black tabular-nums text-gray-900">{myTotal}</div>
          <div className="mt-1 text-[11px] font-semibold text-gray-500">{myName}</div>
        </div>
        <div className="flex-1 text-center">
          {diff === 0 ? (
            <div className="text-sm font-bold text-gray-400">Tied 🤝</div>
          ) : diff > 0 ? (
            <div className="text-xs font-bold text-green-600">+{diff} ahead</div>
          ) : (
            <div className="text-xs font-bold text-purple-600">{-diff} behind</div>
          )}
          <div className="mt-0.5 text-[9px] text-gray-300">pts this week</div>
        </div>
        <div className="text-center">
          <div className="text-4xl font-black tabular-nums text-gray-900">{buddyTotal}</div>
          <div className="mt-1 text-[11px] font-semibold text-gray-500">{buddyName}</div>
        </div>
      </div>

      {/* Race track */}
      <div className="space-y-1.5">
        {/* You row */}
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 flex-shrink-0 rounded-full bg-green-500 text-white text-xs font-bold shadow flex items-center justify-center">
            {myName[0].toUpperCase()}
          </div>
          <div className="relative flex-1 h-5 overflow-hidden rounded-full bg-gray-100">
            <div
              className="absolute inset-y-0 left-0 flex items-center justify-end rounded-full bg-gradient-to-r from-green-400 to-emerald-500 pr-2 transition-all duration-1000 ease-out"
              style={{ width: animated ? `${Math.max(myPct, myTotal > 0 ? 4 : 0)}%` : "0%" }}
            >
              {myPct > 10 && (
                <span className="text-[9px] font-bold text-white tabular-nums">{myTotal}</span>
              )}
            </div>
          </div>
        </div>

        {/* Day labels between the bars */}
        <div className="ml-9 grid grid-cols-7 text-center">
          {DAY_LETTER.map((l, i) => {
            const isToday = days[i] === todayIso;
            const isPast = days[i] < todayIso;
            return (
              <div
                key={i}
                className={`text-[9px] font-bold ${
                  isToday ? "text-brand-600" : isPast ? "text-gray-400" : "text-gray-200"
                }`}
              >
                {l}
              </div>
            );
          })}
        </div>

        {/* Buddy row */}
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 flex-shrink-0 rounded-full bg-gradient-to-br from-purple-400 to-pink-400 text-white text-xs font-bold shadow flex items-center justify-center">
            {buddyName[0].toUpperCase()}
          </div>
          <div className="relative flex-1 h-5 overflow-hidden rounded-full bg-gray-100">
            <div
              className="absolute inset-y-0 left-0 flex items-center justify-end rounded-full bg-gradient-to-r from-purple-400 to-pink-500 pr-2 transition-all duration-1000 ease-out"
              style={{ width: animated ? `${Math.max(buddyPct, buddyTotal > 0 ? 4 : 0)}%` : "0%" }}
            >
              {buddyPct > 10 && (
                <span className="text-[9px] font-bold text-white tabular-nums">{buddyTotal}</span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Day-by-day dots */}
      <div className="grid grid-cols-7 gap-1">
        {days.map((date, i) => {
          const myDay = myScores[i];
          const buddyDay = buddyScores[i];
          const isFuture = date > todayIso;
          const isToday = date === todayIso;
          const myWonDay = !isFuture && myDay.points > buddyDay.points;
          const buddyWonDay = !isFuture && buddyDay.points > myDay.points;
          const tieDay =
            !isFuture && !myWonDay && !buddyWonDay && (myDay.points > 0 || buddyDay.points > 0);

          function dotClass(wonDay: boolean, points: number): string {
            const base = "w-6 h-6 rounded-full flex items-center justify-center text-[9px] font-bold border-2 transition-all";
            if (isFuture) return `${base} border-gray-100 bg-gray-50 text-gray-200`;
            if (points === 0) return `${base} border-gray-100 bg-gray-100 text-gray-300 ${isToday ? "border-dashed" : ""}`;
            if (wonDay) return `${base} border-transparent text-white`;
            if (tieDay) return `${base} border-transparent bg-gray-300 text-white`;
            return `${base} border-gray-100 bg-gray-100 text-gray-400`;
          }

          return (
            <div key={date} className="flex flex-col items-center gap-1">
              <div
                title={`${myName}: ${myDay.points}pts${myDay.breakdown.perfect ? " ⭐" : ""}`}
                className={dotClass(myWonDay, myDay.points)}
                style={myWonDay ? { background: "linear-gradient(135deg,#4ade80,#10b981)" } : undefined}
              >
                {!isFuture && myDay.points > 0 ? myDay.points : ""}
              </div>

              <div className={`text-[8px] font-bold ${isToday ? "text-brand-600" : "text-gray-300"}`}>
                {DAY_LETTER[i]}
              </div>

              <div
                title={`${buddyName}: ${buddyDay.points}pts${buddyDay.breakdown.perfect ? " ⭐" : ""}`}
                className={dotClass(buddyWonDay, buddyDay.points)}
                style={buddyWonDay ? { background: "linear-gradient(135deg,#a78bfa,#ec4899)" } : undefined}
              >
                {!isFuture && buddyDay.points > 0 ? buddyDay.points : ""}
              </div>
            </div>
          );
        })}
      </div>

      {/* Legend */}
      <div className="flex flex-wrap items-center gap-3 text-[10px] text-gray-400">
        <div className="flex items-center gap-1">
          <div className="w-3 h-3 rounded-full bg-green-500" />
          You won
        </div>
        <div className="flex items-center gap-1">
          <div className="w-3 h-3 rounded-full bg-purple-400" />
          {buddyName} won
        </div>
        <div className="flex items-center gap-1">
          <div className="w-3 h-3 rounded-full bg-gray-300" />
          Tied
        </div>
      </div>

      {/* How points work */}
      <div className="rounded-xl bg-gray-50 px-4 py-3">
        <div className="mb-2 text-[11px] font-bold uppercase tracking-wide text-gray-400">
          How points are earned
        </div>
        <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-[11px] text-gray-500">
          <div>🎯 Calorie target ±10% — <b className="text-gray-700">3 pts</b></div>
          <div>🥩 Protein 90%+ — <b className="text-gray-700">2 pts</b></div>
          <div>💪 Log a workout — <b className="text-gray-700">2 pts</b></div>
          <div>🥦 Fiber 90%+ — <b className="text-gray-700">1 pt</b></div>
          <div>🍽️ Log all 3 meals — <b className="text-gray-700">1 pt</b></div>
          <div>⭐ Perfect day bonus — <b className="text-gray-700">+2 pts</b></div>
        </div>
      </div>

      {/* All-time record */}
      {pastWeeks.length > 0 && (myWins > 0 || buddyWins > 0) && (
        <div className="flex items-center justify-between rounded-xl border border-gray-100 bg-white/70 px-4 py-3">
          <div className="text-xs font-semibold text-gray-500">
            Last {pastWeeks.length} week{pastWeeks.length > 1 ? "s" : ""}
          </div>
          <div className="flex items-center gap-3">
            <div className="text-center">
              <div className="text-xl font-black text-green-600">{myWins}</div>
              <div className="text-[10px] text-gray-400">{myName}</div>
            </div>
            <div className="text-sm font-light text-gray-300">vs</div>
            <div className="text-center">
              <div className="text-xl font-black text-purple-500">{buddyWins}</div>
              <div className="text-[10px] text-gray-400">{buddyName}</div>
            </div>
          </div>
          <div className="text-xs text-gray-400">Wins</div>
        </div>
      )}
    </div>
  );
}
