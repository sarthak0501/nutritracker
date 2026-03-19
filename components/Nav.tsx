"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const links = [
  { href: "/", label: "Today", icon: "🏠" },
  { href: "/workouts", label: "Workouts", icon: "💪" },
  { href: "/history", label: "History", icon: "📅" },
  { href: "/trends", label: "Trends", icon: "📊" },
  { href: "/buddy", label: "Buddy", icon: "👥" },
  { href: "/profile", label: "Profile", icon: "⚙️" },
];

export function Nav() {
  const pathname = usePathname();
  return (
    <nav className="fixed bottom-0 left-0 right-0 z-20 border-t border-gray-100 bg-white/95 backdrop-blur-lg safe-bottom md:static md:border-0 md:bg-transparent md:backdrop-blur-none">
      <div className="mx-auto flex max-w-3xl items-center justify-around md:justify-start md:gap-1">
        {links.map((l) => {
          const active = l.href === "/" ? pathname === "/" : pathname.startsWith(l.href);
          return (
            <Link
              key={l.href}
              href={l.href}
              className={`flex flex-col items-center gap-0.5 px-2 py-2 text-[10px] font-medium transition-colors md:flex-row md:gap-1.5 md:rounded-xl md:px-3 md:py-2 md:text-xs ${
                active
                  ? "text-brand-600 md:bg-brand-50"
                  : "text-gray-400 hover:text-gray-700 md:hover:bg-gray-50"
              }`}
            >
              <span className="text-lg md:text-sm">{l.icon}</span>
              <span>{l.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
