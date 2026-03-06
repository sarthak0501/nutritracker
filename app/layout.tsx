import "./globals.css";
import { Nav } from "@/components/Nav";

export const metadata = {
  title: "NutriTracker",
  description: "Local-first nutrition tracking"
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-zinc-950 text-zinc-50">
        <div className="mx-auto max-w-5xl px-4 py-6">
          <header className="mb-6 flex flex-col gap-3">
            <div className="flex items-baseline justify-between gap-4">
              <div>
                <div className="text-xl font-semibold tracking-tight">
                  NutriTracker
                </div>
                <div className="text-sm text-zinc-400">
                  Track meals, macros, micros, and trends (local-first)
                </div>
              </div>
            </div>
            <Nav />
          </header>
          <main>{children}</main>
          <footer className="mt-10 border-t border-zinc-800 pt-4 text-xs text-zinc-500">
            Local-only MVP. No accounts. Your data stays on this machine.
          </footer>
        </div>
      </body>
    </html>
  );
}

