import { prisma } from "@/lib/db";
import { requireVariableAccess } from "@/lib/access";
import { decrypt } from "@/lib/crypto";
import { ApiError } from "@/lib/errors";

export async function revealVariable(userId: string, variableId: string): Promise<string> {
  // 404 for non-members, same as every other variable route
  const v = await requireVariableAccess(userId, variableId);

  if (!v.isSensitive || v.iv === null || v.authTag === null) {
    throw new ApiError(400, "This variable is not sensitive");
  }

  let plain: string;
  try {
    plain = decrypt({ value: v.value, iv: v.iv, authTag: v.authTag });
  } catch {
    throw new ApiError(500, "Could not decrypt this value");
  }

  // Fail closed: if this insert throws, the value is never returned
  await prisma.revealLog.create({
    data: {
      environmentId: v.environmentId,
      key: v.key, // the name only, never the value
      source: "VARIABLE",
      userId,
    },
  });

  return plain;
}