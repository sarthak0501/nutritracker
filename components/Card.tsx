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
    <div className={clsx("rounded-2xl bg-white p-5 shadow-sm", className)}>
      {title && <div className="mb-3 text-[13px] font-bold uppercase tracking-wide text-gray-400">{title}</div>}
      {children}
    </div>
  );
}
