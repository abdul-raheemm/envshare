import { NextResponse } from "next/server";
import type { z } from "zod";
import { fieldErrors } from "@/lib/validation";

export class ApiError extends Error {
  status: number;
  fields?: Record<string, string>;

  constructor(status: number, message: string, fields?: Record<string, string>) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.fields = fields;
  }
}

export function isUniqueViolation(e: unknown): boolean {
  return typeof e === "object" && e !== null && "code" in e && e.code === "P2002";
}

// Logs only WHAT kind of error happened, never its message or the data involved
function safeErrorSummary(e: unknown): string {
  if (e instanceof Error) {
    const code = "code" in e && typeof e.code === "string" ? ` ${e.code}` : "";
    return `${e.name}${code}`;
  }
  return "Unknown error";
}

// Turns any thrown error into the standard { error, fields? } response
export function errorResponse(e: unknown) {
  if (e instanceof ApiError) {
    return NextResponse.json(
      { error: e.message, ...(e.fields ? { fields: e.fields } : {}) },
      { status: e.status }
    );
  }
  console.error("Unhandled API error:", safeErrorSummary(e));
  return NextResponse.json(
    { error: "Something went wrong. Please try again." },
    { status: 500 }
  );
}

// Reads the JSON body and validates it with a zod schema
export async function parseBody<S extends z.ZodType>(
  request: Request,
  schema: S
): Promise<z.infer<S>> {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("application/json")) {
    throw new ApiError(415, "Unsupported content type");
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw new ApiError(400, "Invalid request");
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new ApiError(400, "Please fix the errors below", fieldErrors(parsed.error));
  }
  return parsed.data;
}