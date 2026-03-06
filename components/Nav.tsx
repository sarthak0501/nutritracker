import Link from "next/link";
import { clsx } from "clsx";

const links = [
  { href: "/", label: "Today" },
  { href: "/history", label: "History" },
  { href: "/trends", label: "Trends" },
  { href: "/foods", label: "Foods" }
] as const;

export function Nav() {
  return (
    <nav className="flex flex-wrap gap-2">
      {links.map((l) => (
        <Link
          key={l.href}
          href={l.href}
          className={clsx(
            "rounded-lg border border-zinc-800 px-3 py-1.5 text-sm",
            "bg-zinc-900/40 hover:bg-zinc-900"
          )}
        >
          {l.label}
        </Link>
      ))}
    </nav>
  );
}

