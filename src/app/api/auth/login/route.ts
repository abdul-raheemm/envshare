import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { ApiError, errorResponse, parseBody } from "@/lib/errors";
import { DUMMY_HASH, verifyPassword } from "@/lib/password";
import { clearFailures, getLockStatus, recordFailure } from "@/lib/rateLimit";
import { createSession } from "@/lib/session";
import { loginSchema } from "@/lib/validation";

export async function POST(request: Request) {
  try {
    const { email, password } = await parseBody(request, loginSchema);

    const limitKey = `login:${email}`;
    const lock = getLockStatus(limitKey);
    if (lock.locked) {
      const minutes = Math.max(1, Math.ceil(lock.retryAfterSeconds / 60));
      throw new ApiError(
        429,
        `Too many failed attempts. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`
      );
    }

    const user = await prisma.user.findUnique({ where: { email } });
    const passwordOk = await verifyPassword(password, user?.passwordHash ?? DUMMY_HASH);

    if (!user || !passwordOk) {
      recordFailure(limitKey); // counted for unknown emails too, so lockouts reveal nothing
      throw new ApiError(401, "Invalid email or password");
    }

    clearFailures(limitKey);
    await createSession(user.id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}