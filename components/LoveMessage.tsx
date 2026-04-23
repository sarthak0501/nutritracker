"use client";

import { useEffect, useState } from "react";

const HEARTS_DEFAULT = ["❤️", "🩷", "💕", "💖", "💗", "💓", "🫀", "💝"];
const HEARTS_ANNIVERSARY = ["💕", "💖", "💗", "💝", "🌹", "💐", "🥂", "💍", "🎉", "✨"];

type Mode = "default" | "anniversary";

type Bubble = {
  id: number;
  emoji: string;
  left: number;
  size: number;
  duration: number;
  delay: number;
};

export function LoveMessage({ mode = "default" }: { mode?: Mode }) {
  const [visible, setVisible] = useState(false);
  const [fading, setFading] = useState(false);
  const [bubbles, setBubbles] = useState<Bubble[]>([]);

  useEffect(() => {
    const storageKey = mode === "anniversary" ? "love-shown-anniversary" : "love-shown";
    if (sessionStorage.getItem(storageKey)) return;
    sessionStorage.setItem(storageKey, "1");

    const palette = mode === "anniversary" ? HEARTS_ANNIVERSARY : HEARTS_DEFAULT;
    const count = mode === "anniversary" ? 28 : 18;

    const generated = Array.from({ length: count }, (_, i) => ({
      id: i,
      emoji: palette[i % palette.length],
      left: Math.random() * 90 + 5,
      size: Math.random() * 24 + 20,
      duration: Math.random() * 3 + 3,
      delay: Math.random() * 2.5,
    }));
    setBubbles(generated);
    setVisible(true);

    const fadeMs = mode === "anniversary" ? 5500 : 3500;
    const hideMs = mode === "anniversary" ? 6500 : 4500;
    const fadeTimer = setTimeout(() => setFading(true), fadeMs);
    const hideTimer = setTimeout(() => setVisible(false), hideMs);
    return () => { clearTimeout(fadeTimer); clearTimeout(hideTimer); };
  }, [mode]);

  if (!visible) return null;

  const isAnniv = mode === "anniversary";
  const overlayBg = isAnniv ? "rgba(255,235,240,0.7)" : "rgba(255,240,245,0.6)";
  const cardBorder = isAnniv ? "border-rose-200" : "border-pink-100";

  return (
    <>
      <style>{`
        @keyframes floatUp {
          0%   { transform: translateY(0) scale(1); opacity: 1; }
          80%  { opacity: 0.8; }
          100% { transform: translateY(-110vh) scale(1.3); opacity: 0; }
        }
        @keyframes pulse-love {
          0%, 100% { transform: scale(1); }
          50%       { transform: scale(1.08); }
        }
        .heart-bubble { animation: floatUp var(--dur) var(--delay) ease-in forwards; }
        .love-card    { animation: pulse-love 1.6s ease-in-out infinite; }
      `}</style>

      <div
        className={`fixed inset-0 z-50 flex items-center justify-center transition-opacity duration-1000 ${fading ? "opacity-0" : "opacity-100"}`}
        style={{ background: overlayBg, backdropFilter: "blur(6px)" }}
        onClick={() => { setFading(true); setTimeout(() => setVisible(false), 600); }}
      >
        {/* Floating hearts */}
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

        {/* Message card */}
        <div className={`love-card relative rounded-3xl bg-white px-10 py-8 text-center shadow-2xl border ${cardBorder} mx-6`}>
          {isAnniv ? (
            <>
              <div className="text-5xl mb-4">💍</div>
              <div className="text-2xl font-extrabold text-rose-500 tracking-tight">
                Happy Anniversary
              </div>
              <div className="mt-2 text-base font-bold text-pink-400">
                Sarthak ❤️ Kavya
              </div>
              <div className="mt-1 text-sm text-pink-300 font-medium">forever & always 💕</div>
            </>
          ) : (
            <>
              <div className="text-5xl mb-4">💖</div>
              <div className="text-2xl font-extrabold text-pink-500 tracking-tight">
                Sarthak Loves you
              </div>
              <div className="mt-2 text-sm text-pink-300 font-medium">always & forever ❤️</div>
            </>
          )}
        </div>
      </div>
    </>
  );
}
