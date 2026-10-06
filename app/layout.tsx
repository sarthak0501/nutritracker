import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { Nav } from "@/components/Nav";
import { getSession } from "@/lib/auth-session";
import { DraftPrivacyBoundary, LogoutButton } from "@/components/AccountControls";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });

export const metadata: Metadata = {
  title: "NutriTracker",
  description: "Track your nutrition, macros, and trends",
  appleWebApp: { capable: true, statusBarStyle: "default", title: "NutriTracker" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#16a34a",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  const username = session?.username ?? null;

  return (
    <html lang="en" className={inter.variable}>
      <body className="min-h-screen bg-surface text-gray-900 font-sans antialiased">
        <DraftPrivacyBoundary key={session?.id ?? "logged-out"} userId={session?.id ?? null} />
        <a href="#main-content" className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:bg-white focus:p-4">Skip to content</a>
        {username && (
          <header className="bg-white/80 backdrop-blur-md sticky top-0 z-10 border-b border-gray-100">
            <div className="mx-auto max-w-3xl px-4 pt-3 pb-2 space-y-2">
              <div className="flex items-center justify-between">
                <div className="font-extrabold text-lg tracking-tight bg-gradient-to-r from-brand-600 to-brand-500 bg-clip-text text-transparent">NutriTracker</div>
                <LogoutButton username={username} />
              </div>
              <Nav />
            </div>
          </header>
        )}
        {username ? (
          <main id="main-content" className="mx-auto max-w-3xl px-4 py-4 pb-12">{children}</main>
        ) : (
          <main id="main-content">{children}</main>
        )}
      </body>
    </html>
  );
}
