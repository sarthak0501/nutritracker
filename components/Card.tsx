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
    <div className={clsx("rounded-xl border border-slate-200 bg-white p-4 shadow-sm", className)}>
      {title && <div className="mb-3 text-sm font-semibold text-slate-700">{title}</div>}
      {children}
    </div>
  );
}
