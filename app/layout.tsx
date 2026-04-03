import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { Nav } from "@/components/Nav";
import { getSession } from "@/lib/auth-session";
import { logoutAction } from "@/app/actions/auth";
import { prisma } from "@/lib/db";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });

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
  const theme = session
    ? ((await prisma.profile.findUnique({ where: { userId: session.id }, select: { theme: true } }))?.theme ?? "light")
    : "light";

  return (
    <html lang="en" className={inter.variable} data-theme={theme}>
      <body className="min-h-screen bg-surface text-gray-900 font-sans antialiased">
        {username && (
          <header className="bg-white/80 backdrop-blur-md sticky top-0 z-10 border-b border-gray-100">
            <div className="mx-auto max-w-3xl px-4 pt-3 pb-2 space-y-2">
              <div className="flex items-center justify-between">
                <div className="font-extrabold text-lg tracking-tight bg-gradient-to-r from-brand-600 to-brand-500 bg-clip-text text-transparent">NutriTracker</div>
                <form action={logoutAction} className="shrink-0">
                  <button className="rounded-full bg-surface-muted px-3 py-1 text-xs font-medium text-gray-500 hover:bg-gray-200 hover:text-gray-700 transition-colors">
                    {username}
                  </button>
                </form>
              </div>
              <Nav />
            </div>
          </header>
        )}
        {username ? (
          <main className="mx-auto max-w-3xl px-4 py-4 pb-12">{children}</main>
        ) : (
          <>{children}</>
        )}
      </body>
    </html>
  );
}
