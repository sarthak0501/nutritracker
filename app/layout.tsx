import type { Metadata, Viewport } from "next";
import "./globals.css";
import { Nav } from "@/components/Nav";
import { auth } from "@/auth";
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
  const session = await auth();
  const username = session?.user?.name ?? null;

  return (
    <html lang="en" className="dark">
      <body className="min-h-screen bg-zinc-950 text-zinc-100 antialiased">
        <header className="border-b border-zinc-800 bg-zinc-950/80 backdrop-blur sticky top-0 z-10">
          <div className="mx-auto max-w-3xl px-4 py-3 flex items-center justify-between gap-2">
            <div className="font-bold text-base shrink-0">🥗 NutriTracker</div>
            <Nav />
            {username && (
              <form action={logoutAction} className="shrink-0">
                <button className="text-xs text-zinc-500 hover:text-zinc-300 whitespace-nowrap">
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
