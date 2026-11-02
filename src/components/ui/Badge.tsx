import type { ReactNode } from "react";

type Variant = "neutral" | "primary" | "warning" | "success" | "danger";

const styles: Record<Variant, string> = {
  neutral: "bg-gray-100 text-gray-700",
  primary: "bg-indigo-100 text-indigo-700",
  warning: "bg-amber-100 text-amber-800",
  success: "bg-green-100 text-green-800",
  danger: "bg-red-100 text-red-700",
};

export function Badge({
  variant = "neutral",
  children,
}: {
  variant?: Variant;
  children: ReactNode;
}) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${styles[variant]}`}
    >
      {children}
    </span>
  );
}