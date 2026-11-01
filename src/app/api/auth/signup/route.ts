import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { hashPassword } from "@/lib/password";
import { createSession } from "@/lib/session";
import { fieldErrors, signupSchema } from "@/lib/validation";

const DUPLICATE_MESSAGE = "An account with this email already exists";

function isUniqueViolation(e: unknown): boolean {
  return typeof e === "object" && e !== null && "code" in e && e.code === "P2002";
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const parsed = signupSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Please fix the errors below", fields: fieldErrors(parsed.error) },
      { status: 400 }
    );
  }
  const { name, email, password } = parsed.data;

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    return NextResponse.json(
      { error: DUPLICATE_MESSAGE, fields: { email: DUPLICATE_MESSAGE } },
      { status: 409 }
    );
  }

  try {
    const user = await prisma.user.create({
      data: { name, email, passwordHash: await hashPassword(password) },
      select: { id: true },
    });
    await createSession(user.id);
    return NextResponse.json({ ok: true }, { status: 201 });
  } catch (e) {
    if (isUniqueViolation(e)) {
      // two signups with the same email at the same instant
      return NextResponse.json(
        { error: DUPLICATE_MESSAGE, fields: { email: DUPLICATE_MESSAGE } },
        { status: 409 }
      );
    }
    console.error("Signup failed", e);
    return NextResponse.json({ error: "Something went wrong. Please try again." }, { status: 500 });
  }
}