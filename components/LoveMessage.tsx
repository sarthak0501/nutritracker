"use client";

import { useEffect, useState } from "react";

const HEARTS = ["❤️", "🩷", "💕", "💖", "💗", "💓", "🫀", "💝"];

type Bubble = {
  id: number;
  emoji: string;
  left: number;
  size: number;
  duration: number;
  delay: number;
};

export function LoveMessage() {
  const [visible, setVisible] = useState(false);
  const [fading, setFading] = useState(false);
  const [bubbles, setBubbles] = useState<Bubble[]>([]);

  useEffect(() => {
    if (sessionStorage.getItem("love-shown")) return;
    sessionStorage.setItem("love-shown", "1");

    const generated = Array.from({ length: 18 }, (_, i) => ({
      id: i,
      emoji: HEARTS[i % HEARTS.length],
      left: Math.random() * 90 + 5,
      size: Math.random() * 24 + 20,
      duration: Math.random() * 3 + 3,
      delay: Math.random() * 2.5,
    }));
    setBubbles(generated);
    setVisible(true);

    const fadeTimer = setTimeout(() => setFading(true), 3500);
    const hideTimer = setTimeout(() => setVisible(false), 4500);
    return () => { clearTimeout(fadeTimer); clearTimeout(hideTimer); };
  }, []);

  if (!visible) return null;

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
        style={{ background: "rgba(255,240,245,0.6)", backdropFilter: "blur(6px)" }}
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
        <div className="love-card relative rounded-3xl bg-white px-10 py-8 text-center shadow-2xl border border-pink-100 mx-6">
          <div className="text-5xl mb-4">💖</div>
          <div className="text-2xl font-extrabold text-pink-500 tracking-tight">
            Sarthak Loves you
          </div>
          <div className="mt-2 text-sm text-pink-300 font-medium">always & forever ❤️</div>
        </div>
      </div>
    </>
  );
}
