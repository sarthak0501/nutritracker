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
    <nav className="flex gap-1 overflow-x-auto no-scrollbar">
      {links.map((l) => {
        const active = l.href === "/" ? pathname === "/" : pathname.startsWith(l.href);
        return (
          <Link
            key={l.href}
            href={l.href}
            className={`rounded-lg px-3 py-1.5 text-xs font-semibold whitespace-nowrap transition-all duration-150 ${
              active
                ? "bg-brand-600 text-white shadow-sm"
                : "text-gray-400 hover:text-gray-700 hover:bg-surface-muted"
            }`}
          >
            <span className="mr-1">{l.icon}</span>{l.label}
          </Link>
        );
      })}
    </nav>
  );
}
