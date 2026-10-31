import type { ReactNode } from "react";

type Variant = "error" | "success" | "info";

const styles: Record<Variant, string> = {
  error: "border-red-200 bg-red-50 text-red-800",
  success: "border-green-200 bg-green-50 text-green-800",
  info: "border-blue-200 bg-blue-50 text-blue-800",
};

export function Alert({
  variant = "info",
  children,
}: {
  variant?: Variant;
  children: ReactNode;
}) {
  return (
    <div
      role={variant === "error" ? "alert" : "status"}
      className={`rounded-md border px-4 py-3 text-sm ${styles[variant]}`}
    >
      {children}
    </div>
  );
}