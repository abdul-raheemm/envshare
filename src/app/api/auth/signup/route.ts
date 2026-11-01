import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { ApiError, errorResponse, isUniqueViolation, parseBody } from "@/lib/errors";
import { hashPassword } from "@/lib/password";
import { createSession } from "@/lib/session";
import { signupSchema } from "@/lib/validation";

const DUPLICATE_MESSAGE = "An account with this email already exists";

async function createUser(name: string, email: string, password: string) {
  try {
    return await prisma.user.create({
      data: { name, email, passwordHash: await hashPassword(password) },
      select: { id: true },
    });
  } catch (e) {
    // two signups with the same email at the same instant
    if (isUniqueViolation(e)) {
      throw new ApiError(409, DUPLICATE_MESSAGE, { email: DUPLICATE_MESSAGE });
    }
    throw e;
  }
}

export async function POST(request: Request) {
  try {
    const { name, email, password } = await parseBody(request, signupSchema);

    const existing = await prisma.user.findUnique({
      where: { email },
      select: { id: true },
    });
    if (existing) {
      throw new ApiError(409, DUPLICATE_MESSAGE, { email: DUPLICATE_MESSAGE });
    }

    const user = await createUser(name, email, password);
    await createSession(user.id);
    return NextResponse.json({ ok: true }, { status: 201 });
  } catch (e) {
    return errorResponse(e);
  }
}