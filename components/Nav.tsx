"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const links = [
  { href: "/", label: "Today" },
  { href: "/workouts", label: "Workouts" },
  { href: "/history", label: "History" },
  { href: "/trends", label: "Trends" },
  { href: "/buddy", label: "Buddy" },
  { href: "/profile", label: "Profile" },
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
                ? "bg-gray-900 text-white shadow-sm"
                : "text-gray-400 hover:text-gray-700 hover:bg-surface-muted"
            }`}
          >
            {l.label}
          </Link>
        );
      })}
    </nav>
  );
}
