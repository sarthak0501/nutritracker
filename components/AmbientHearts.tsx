"use client";

import { useEffect, useState } from "react";

const HEARTS = ["❤️", "💕", "💖", "🌹", "✨", "💝", "🌷", "💗"];

type Bubble = {
  id: number;
  emoji: string;
  left: number;
  size: number;
  duration: number;
  opacity: number;
};

export function AmbientHearts() {
  const [bubbles, setBubbles] = useState<Bubble[]>([]);

  useEffect(() => {
    let nextId = 0;
    const spawn = () => {
      const b: Bubble = {
        id: nextId++,
        emoji: HEARTS[Math.floor(Math.random() * HEARTS.length)],
        left: Math.random() * 95 + 2,
        size: Math.random() * 14 + 14,
        duration: Math.random() * 8 + 14,
        opacity: Math.random() * 0.3 + 0.35,
      };
      setBubbles((prev) => [...prev.slice(-14), b]);
    };

    spawn();
    spawn();
    spawn();
    const interval = setInterval(spawn, 2200);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="fixed inset-0 pointer-events-none overflow-hidden" style={{ zIndex: 0 }}>
      <style>{`
        @keyframes ambientFloat {
          0%   { transform: translateY(0) translateX(0) rotate(0deg); opacity: 0; }
          12%  { opacity: var(--op); }
          88%  { opacity: var(--op); }
          100% { transform: translateY(-110vh) translateX(30px) rotate(20deg); opacity: 0; }
        }
        .ambient-heart { animation: ambientFloat var(--dur) linear forwards; }
      `}</style>
      {bubbles.map((b) => (
        <span
          key={b.id}
          className="ambient-heart fixed bottom-0 select-none"
          style={{
            left: `${b.left}%`,
            fontSize: `${b.size}px`,
            "--dur": `${b.duration}s`,
            "--op": b.opacity,
          } as React.CSSProperties}
        >
          {b.emoji}
        </span>
      ))}
    </div>
  );
}
