"use client";

import { useId } from "react";

export function Checkbox({
  label,
  checked,
  onChange,
  disabled = false,
  hideLabel = false,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  hideLabel?: boolean;
}) {
  const id = useId();
  return (
    <div className="flex items-center gap-2">
      <input
        id={id}
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="h-4 w-4 rounded border-border accent-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 disabled:opacity-50"
      />
      <label
        htmlFor={id}
        className={hideLabel ? "sr-only" : "text-sm font-medium text-gray-700"}
      >
        {label}
      </label>
    </div>
  );
}