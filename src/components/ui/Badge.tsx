import type { ReactNode } from "react";

type Variant = "neutral" | "primary";

const styles: Record<Variant, string> = {
  neutral: "bg-gray-100 text-gray-700",
  primary: "bg-indigo-100 text-indigo-700",
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