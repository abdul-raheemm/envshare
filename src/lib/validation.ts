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

export const createProjectSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Project name is required")
    .max(100, "Project name is too long"),
});

export const inviteMemberSchema = z.object({
  email: emailField,
});

export const createEnvironmentSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Environment name is required")
    .max(50, "Environment name is too long"),
});

const variableKey = z
  .string()
  .trim()
  .min(1, "Key is required")
  .max(128, "Key is too long")
  .regex(
    /^[A-Za-z_][A-Za-z0-9_]*$/,
    "Key must start with a letter or underscore and contain only letters, numbers and underscores"
  );

const variableValue = z.string().max(10000, "Value is too long (maximum 10,000 characters)");

export const createVariableSchema = z.object({
  key: variableKey,
  value: variableValue,
});

export const updateVariableSchema = z
  .object({
    key: variableKey.optional(),
    value: variableValue.optional(),
    version: z.number().int().min(1),
  })
  .refine((d) => d.key !== undefined || d.value !== undefined, {
    message: "Nothing to update",
  });