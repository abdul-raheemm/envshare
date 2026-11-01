import { z } from "zod";

const emailField = z
  .string()
  .trim()
  .toLowerCase()
  .email("Invalid email address");

export const signupSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(100, "Name is too long"),
  email: emailField,
  password: z
    .string()
    .min(8, "Password must be at least 8 characters")
    .refine(
      (p) => new TextEncoder().encode(p).length <= 72,
      "Password is too long (maximum 72 bytes)"
    ),
});

export const loginSchema = z.object({
  email: emailField,
  password: z.string().min(1, "Password is required"),
});

// Turns a zod error into { fieldName: "first message" } for the UI
export function fieldErrors(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? "form");
    if (!(key in out)) out[key] = issue.message;
  }
  return out;
}