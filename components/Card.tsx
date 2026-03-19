import { type ReactNode } from "react";
import { clsx } from "clsx";

export function Card({
  title,
  children,
  className,
}: {
  title?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={clsx("rounded-xl border border-zinc-800 bg-zinc-900 p-4", className)}>
      {title && <div className="mb-3 text-sm font-semibold text-zinc-200">{title}</div>}
      {children}
    </div>
  );
}
