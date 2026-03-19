import type { Metadata, Viewport } from "next";
import "./globals.css";
import { Nav } from "@/components/Nav";

export const metadata: Metadata = {
  title: "NutriTracker",
  description: "Track your nutrition, macros, and trends",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className="min-h-screen bg-zinc-950 text-zinc-100 antialiased">
        <header className="border-b border-zinc-800 bg-zinc-950/80 backdrop-blur sticky top-0 z-10">
          <div className="mx-auto max-w-3xl px-4 py-3 flex items-center justify-between gap-4">
            <div>
              <div className="font-bold text-base leading-tight">NutriTracker</div>
              <div className="text-xs text-zinc-400 hidden sm:block">Track meals, macros &amp; trends</div>
            </div>
            <Nav />
          </div>
        </header>
        <main className="mx-auto max-w-3xl px-4 py-4 pb-24">
          {children}
        </main>
      </body>
    </html>
  );
}
