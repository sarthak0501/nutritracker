"use client";

type Props = { theme: string };

export function ThemeDecor({ theme }: Props) {
  if (theme === "light") return null;

  if (theme === "puppy") {
    return (
      <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
        {/* Paw prints scattered in header */}
        {[
          { top: "8px",  right: "60px",  size: 22, rotate: -15, opacity: 0.18 },
          { top: "18px", right: "32px",  size: 16, rotate: 10,  opacity: 0.12 },
          { top: "4px",  right: "90px",  size: 12, rotate: 30,  opacity: 0.10 },
          { top: "26px", right: "72px",  size: 10, rotate: -5,  opacity: 0.09 },
        ].map((p, i) => (
          <svg
            key={i}
            width={p.size} height={p.size}
            viewBox="0 0 40 40"
            style={{ position: "absolute", top: p.top, right: p.right, opacity: p.opacity, transform: `rotate(${p.rotate}deg)` }}
            fill="#d97706"
          >
            {/* Main pad */}
            <ellipse cx="20" cy="27" rx="9" ry="8" />
            {/* Toe pads */}
            <circle cx="10" cy="16" r="4" />
            <circle cx="18" cy="12" r="4" />
            <circle cx="26" cy="12" r="4" />
            <circle cx="30" cy="17" r="3.5" />
          </svg>
        ))}
      </div>
    );
  }

  if (theme === "love") {
    return (
      <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
        {[
          { top: "6px",  right: "50px",  size: 20, rotate: -10, opacity: 0.20 },
          { top: "20px", right: "24px",  size: 14, rotate: 15,  opacity: 0.15 },
          { top: "2px",  right: "84px",  size: 11, rotate: -20, opacity: 0.12 },
          { top: "28px", right: "60px",  size: 9,  rotate: 5,   opacity: 0.10 },
          { top: "12px", right: "108px", size: 8,  rotate: -8,  opacity: 0.09 },
        ].map((p, i) => (
          <svg
            key={i}
            width={p.size} height={p.size}
            viewBox="0 0 32 30"
            style={{ position: "absolute", top: p.top, right: p.right, opacity: p.opacity, transform: `rotate(${p.rotate}deg)` }}
            fill="#db2777"
          >
            <path d="M16 28 C16 28 1 18 1 9 C1 4.5 4.5 1 9 1 C12 1 15 3 16 5 C17 3 20 1 23 1 C27.5 1 31 4.5 31 9 C31 18 16 28 16 28Z" />
          </svg>
        ))}
      </div>
    );
  }

  if (theme === "motivation") {
    return (
      <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
        {[
          { top: "4px",  right: "44px",  size: 26, rotate: 0,   opacity: 0.18 },
          { top: "18px", right: "20px",  size: 18, rotate: 10,  opacity: 0.12 },
          { top: "8px",  right: "78px",  size: 12, rotate: -8,  opacity: 0.10 },
          /* Diamond shapes */
          { top: "24px", right: "64px",  size: 8,  rotate: 45,  opacity: 0.10, diamond: true },
          { top: "6px",  right: "106px", size: 6,  rotate: 45,  opacity: 0.08, diamond: true },
        ].map((p, i) =>
          (p as { diamond?: boolean }).diamond ? (
            <div
              key={i}
              style={{
                position: "absolute", top: p.top, right: p.right,
                width: p.size, height: p.size,
                backgroundColor: "#7c3aed",
                opacity: p.opacity,
                transform: `rotate(${p.rotate}deg)`,
              }}
            />
          ) : (
            <svg
              key={i}
              width={p.size} height={p.size}
              viewBox="0 0 24 36"
              style={{ position: "absolute", top: p.top, right: p.right, opacity: p.opacity, transform: `rotate(${p.rotate}deg)` }}
              fill="#7c3aed"
            >
              <path d="M14 0 L2 20 L10 20 L10 36 L22 16 L14 16 Z" />
            </svg>
          )
        )}
      </div>
    );
  }

  return null;
}
