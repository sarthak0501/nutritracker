import { type ReactNode } from "react";
import { clsx } from "clsx";

type CardVariant = "default" | "action" | "social";

export function Card({
  title,
  children,
  className,
  variant = "default",
}: {
  title?: string;
  children: ReactNode;
  className?: string;
  variant?: CardVariant;
}) {
  const variantClasses: Record<CardVariant, string> = {
    default: "bg-surface-card shadow-card hover:shadow-card-hover",
    action: "bg-gradient-to-br from-brand-50 via-white to-accent-50 shadow-card border border-brand-100",
    social: "bg-gradient-to-br from-purple-50 via-white to-pink-50 shadow-card border border-purple-100",
  };

  return (
    <div className={clsx("rounded-2xl p-5 transition-shadow duration-200", variantClasses[variant], className)}>
      {title && <div className="mb-3 text-[13px] font-bold uppercase tracking-wide text-gray-400">{title}</div>}
      {children}
    </div>
  );
}
