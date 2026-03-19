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
      <body className="min-h-screen bg-gray-50 text-gray-900 antialiased">
        {username && (
          <header className="bg-white sticky top-0 z-10 shadow-sm">
            <div className="mx-auto max-w-3xl px-4 pt-3 pb-2 space-y-2">
              <div className="flex items-center justify-between">
                <div className="font-extrabold text-lg tracking-tight text-brand-600">NutriTracker</div>
                <form action={logoutAction} className="shrink-0">
                  <button className="rounded-full bg-gray-100 px-3 py-1 text-xs font-medium text-gray-500 hover:bg-gray-200 hover:text-gray-700 transition-colors">
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
