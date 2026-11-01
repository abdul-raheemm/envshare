"use client";

import { useId } from "react";
import type { TextareaHTMLAttributes } from "react";

type Props = TextareaHTMLAttributes<HTMLTextAreaElement> & {
  label: string;
  error?: string;
  hideLabel?: boolean;
};

export function Textarea({
  label,
  error,
  hideLabel = false,
  id,
  className = "",
  ...rest
}: Props) {
  const autoId = useId();
  const textareaId = id ?? autoId;

  return (
    <div className="space-y-1">
      <label
        htmlFor={textareaId}
        className={`${hideLabel ? "sr-only" : "block"} text-sm font-medium text-gray-700`}
      >
        {label}
      </label>
      <textarea
        {...rest}
        id={textareaId}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${textareaId}-error` : undefined}
        className={`block w-full rounded-md border px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-primary ${
          error ? "border-danger" : "border-border"
        } ${className}`}
      />
      {error && (
        <p id={`${textareaId}-error`} className="text-sm text-danger">
          {error}
        </p>
      )}
    </div>
  );
}