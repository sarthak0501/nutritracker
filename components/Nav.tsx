"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const links = [
  { href: "/", label: "Today" },
  { href: "/history", label: "History" },
  { href: "/trends", label: "Trends" },
  { href: "/profile", label: "Profile" },
];

export function Nav() {
  const pathname = usePathname();
  return (
    <nav className="flex gap-1">
      {links.map((l) => {
        const active = l.href === "/" ? pathname === "/" : pathname.startsWith(l.href);
        return (
          <Link
            key={l.href}
            href={l.href}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
              active
                ? "bg-zinc-800 text-zinc-100"
                : "text-zinc-400 hover:text-zinc-100 hover:bg-zinc-900"
            }`}
          >
            {l.label}
          </Link>
        );
      })}
    </nav>
  );
}
