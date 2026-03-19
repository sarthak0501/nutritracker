import type { Metadata, Viewport } from "next";
import "./globals.css";
import { Nav } from "@/components/Nav";
import { getSession } from "@/lib/auth-session";
import { logoutAction } from "@/app/actions/auth";

export const metadata: Metadata = {
  title: "NutriTracker",
  description: "Track your nutrition, macros, and trends",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  const username = session?.username ?? null;

  return (
    <html lang="en">
      <body className="min-h-screen bg-slate-50 text-slate-900 antialiased">
        <header className="border-b border-slate-200 bg-white/90 backdrop-blur sticky top-0 z-10">
          <div className="mx-auto max-w-3xl px-4 py-3 flex items-center justify-between gap-2">
            <div className="font-bold text-base shrink-0">🥗 NutriTracker</div>
            <Nav />
            {username && (
              <form action={logoutAction} className="shrink-0">
                <button className="text-xs text-slate-400 hover:text-slate-700 whitespace-nowrap">
                  {username} · out
                </button>
              </form>
            )}
          </div>
        </header>
        <main className="mx-auto max-w-3xl px-4 py-4 pb-24">
          {children}
        </main>
      </body>
    </html>
  );
}
