"use client";

import { useEffect, useState } from "react";

const HEARTS_DEFAULT = ["❤️", "🩷", "💕", "💖", "💗", "💓", "🫀", "💝"];
const HEARTS_ANNIVERSARY = ["💕", "💖", "💗", "💝", "❤️", "🌹", "💐", "🥂", "💍", "🎉", "✨", "🌷"];

type Mode = "default" | "anniversary";

type Bubble = {
  id: number;
  emoji: string;
  left: number;
  size: number;
  duration: number;
  delay: number;
};

type Props = {
  mode?: Mode;
  partnerName?: string | null;
  sweetheartName?: string | null;
  yearCount?: number;
  yearOrdinal?: string;
};

export function LoveMessage({
  mode = "default",
  partnerName,
  sweetheartName,
  yearCount = 0,
  yearOrdinal,
}: Props) {
  const [visible, setVisible] = useState(false);
  const [fading, setFading] = useState(false);
  const [bubbles, setBubbles] = useState<Bubble[]>([]);

  useEffect(() => {
    let fadeTimer: ReturnType<typeof setTimeout> | null = null;
    let hideTimer: ReturnType<typeof setTimeout> | null = null;

    const show = (force: boolean) => {
      const storageKey = mode === "anniversary" ? "love-shown-anniversary" : "love-shown";
      if (!force && sessionStorage.getItem(storageKey)) return;
      sessionStorage.setItem(storageKey, "1");

      const palette = mode === "anniversary" ? HEARTS_ANNIVERSARY : HEARTS_DEFAULT;
      const count = mode === "anniversary" ? 60 : 18;

      const generated = Array.from({ length: count }, (_, i) => ({
        id: Date.now() + i,
        emoji: palette[i % palette.length],
        left: Math.random() * 92 + 4,
        size: Math.random() * (mode === "anniversary" ? 30 : 24) + 18,
        duration: Math.random() * 3 + (mode === "anniversary" ? 4 : 3),
        delay: Math.random() * (mode === "anniversary" ? 4 : 2.5),
      }));
      setBubbles(generated);
      setFading(false);
      setVisible(true);

      if (fadeTimer) clearTimeout(fadeTimer);
      if (hideTimer) clearTimeout(hideTimer);

      const fadeMs = mode === "anniversary" ? 9000 : 3500;
      const hideMs = mode === "anniversary" ? 10000 : 4500;
      fadeTimer = setTimeout(() => setFading(true), fadeMs);
      hideTimer = setTimeout(() => setVisible(false), hideMs);
    };

    show(false);
    const replay = () => show(true);
    window.addEventListener("love:replay", replay);

    return () => {
      if (fadeTimer) clearTimeout(fadeTimer);
      if (hideTimer) clearTimeout(hideTimer);
      window.removeEventListener("love:replay", replay);
    };
  }, [mode]);

  if (!visible) return null;

  const isAnniv = mode === "anniversary";
  const overlayBg = isAnniv
    ? "linear-gradient(135deg, rgba(255,228,235,0.78), rgba(255,240,245,0.78), rgba(254,226,226,0.78))"
    : "rgba(255,240,245,0.6)";
  const cardBorder = isAnniv ? "border-rose-200" : "border-pink-100";

  const defaultTitle = partnerName ? `${partnerName} Loves you` : "You are loved";
  const yearLabel = yearCount > 0 ? `${yearCount} YEAR${yearCount === 1 ? "" : "S"}` : "ANNIVERSARY";
  const happyLead = yearOrdinal ? `Happy ${yearOrdinal}` : "Happy";
  const coupleLine = partnerName && sweetheartName ? `${partnerName} ❤️ ${sweetheartName}` : null;
  const signature = partnerName ? `— ${partnerName} 💕` : null;
  const yearPhrase = yearCount === 1 ? "One year of you." : yearCount > 1 ? `${yearCount} years of you.` : "Every day with you.";

  return (
    <>
      <style>{`
        @keyframes floatUp {
          0%   { transform: translateY(0) scale(1) rotate(0deg); opacity: 1; }
          80%  { opacity: 0.85; }
          100% { transform: translateY(-110vh) scale(1.3) rotate(20deg); opacity: 0; }
        }
        @keyframes pulse-love {
          0%, 100% { transform: scale(1); }
          50%       { transform: scale(1.06); }
        }
        @keyframes shimmer {
          0%, 100% { background-position: 0% 50%; }
          50%       { background-position: 100% 50%; }
        }
        .heart-bubble { animation: floatUp var(--dur) var(--delay) ease-in forwards; }
        .love-card    { animation: pulse-love 1.8s ease-in-out infinite; }
        .anniv-badge {
          background: linear-gradient(90deg, #f43f5e, #ec4899, #f59e0b, #ec4899, #f43f5e);
          background-size: 200% 100%;
          animation: shimmer 3s ease-in-out infinite;
          -webkit-background-clip: text;
          background-clip: text;
          -webkit-text-fill-color: transparent;
        }
      `}</style>

      <div
        className={`fixed inset-0 z-50 flex items-center justify-center transition-opacity duration-1000 ${fading ? "opacity-0" : "opacity-100"}`}
        style={{ background: overlayBg, backdropFilter: "blur(8px)" }}
        onClick={() => { setFading(true); setTimeout(() => setVisible(false), 600); }}
      >
        {bubbles.map((b) => (
          <span
            key={b.id}
            className="heart-bubble pointer-events-none fixed bottom-0 select-none"
            style={{
              left: `${b.left}%`,
              fontSize: `${b.size}px`,
              "--dur": `${b.duration}s`,
              "--delay": `${b.delay}s`,
            } as React.CSSProperties}
          >
            {b.emoji}
          </span>
        ))}

        <div className={`love-card relative rounded-3xl bg-white px-8 py-8 text-center shadow-2xl border ${cardBorder} mx-6 max-w-md`}>
          {isAnniv ? (
            <>
              <div className="text-5xl mb-3">💍 ✨ 💕</div>
              <div className="anniv-badge text-sm font-extrabold tracking-[0.2em] mb-2">
                ✦ {yearLabel} ✦
              </div>
              <div className="text-3xl font-extrabold text-rose-500 tracking-tight leading-tight">
                {happyLead}<br />Anniversary
              </div>
              {coupleLine && (
                <div className="mt-3 text-base font-bold text-pink-500">{coupleLine}</div>
              )}
              <div className="mt-4 text-sm text-rose-400 font-medium leading-relaxed italic">
                {yearPhrase}<br />
                Forever still to come.
              </div>
              {signature && (
                <div className="mt-3 text-xs text-pink-400 font-semibold">{signature}</div>
              )}
            </>
          ) : (
            <>
              <div className="text-5xl mb-4">💖</div>
              <div className="text-2xl font-extrabold text-pink-500 tracking-tight">
                {defaultTitle}
              </div>
              <div className="mt-2 text-sm text-pink-300 font-medium">always & forever ❤️</div>
            </>
          )}
        </div>
      </div>
    </>
  );
}
