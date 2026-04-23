"use client";

export function LoveLetterButton() {
  return (
    <>
      <style>{`
        @keyframes love-button-pulse {
          0%, 100% { transform: scale(1); box-shadow: 0 10px 25px -5px rgba(244, 63, 94, 0.45); }
          50%       { transform: scale(1.08); box-shadow: 0 15px 35px -5px rgba(244, 63, 94, 0.6); }
        }
        .love-letter-btn { animation: love-button-pulse 2s ease-in-out infinite; }
      `}</style>
      <button
        type="button"
        onClick={() => window.dispatchEvent(new Event("love:replay"))}
        className="love-letter-btn fixed bottom-6 right-6 z-40 rounded-full bg-gradient-to-br from-rose-400 via-pink-500 to-rose-500 p-4 shadow-xl transition-transform active:scale-95"
        aria-label="Replay love message"
      >
        <span className="block text-2xl leading-none">💌</span>
      </button>
    </>
  );
}
