import { prisma } from "@/lib/db";
import { requireEnvironmentAccess, requireHistoryEntryAccess } from "@/lib/access";
import { decrypt } from "@/lib/crypto";
import { ApiError } from "@/lib/errors";
import { toHistoryItemDTO, type HistoryItemDTO } from "@/lib/historyDto";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;

export async function listHistory(
  userId: string,
  environmentId: string,
  opts: { cursor?: string; limit?: number }
): Promise<{ items: HistoryItemDTO[]; nextCursor: string | null }> {
  await requireEnvironmentAccess(userId, environmentId);

  const limit = Math.min(Math.max(Math.trunc(opts.limit ?? DEFAULT_LIMIT) || DEFAULT_LIMIT, 1), MAX_LIMIT);

  // The cursor must belong to this environment
  if (opts.cursor) {
    const exists = await prisma.historyEntry.findFirst({
      where: { id: opts.cursor, environmentId },
      select: { id: true },
    });
    if (!exists) throw new ApiError(400, "Invalid cursor");
  }

  const rows = await prisma.historyEntry.findMany({
    where: { environmentId },
    orderBy: [{ changedAt: "desc" }, { id: "desc" }],
    take: limit + 1,
    ...(opts.cursor ? { cursor: { id: opts.cursor }, skip: 1 } : {}),
    // authTag columns are deliberately never loaded for listing
    select: {
      id: true,
      batchId: true,
      action: true,
      key: true,
      oldKey: true,
      oldValue: true,
      oldIv: true,
      newValue: true,
      newIv: true,
      oldIsSensitive: true,
      newIsSensitive: true,
      changedAt: true,
      changedBy: { select: { name: true } },
    },
  });

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  return {
    items: page.map(toHistoryItemDTO),
    nextCursor: hasMore ? page[page.length - 1].id : null,
  };
}

export async function revealHistoryValue(
  userId: string,
  entryId: string,
  which: "old" | "new"
): Promise<string> {
  // 404 for non-members
  const entry = await requireHistoryEntryAccess(userId, entryId);

  const stored =
    which === "old"
      ? { value: entry.oldValue, iv: entry.oldIv, authTag: entry.oldAuthTag }
      : { value: entry.newValue, iv: entry.newIv, authTag: entry.newAuthTag };

  if (stored.value === null || stored.iv === null || stored.authTag === null) {
    throw new ApiError(400, "This value is not encrypted");
  }

  let plain: string;
  try {
    plain = decrypt({ value: stored.value, iv: stored.iv, authTag: stored.authTag });
  } catch {
    throw new ApiError(500, "Could not decrypt this value");
  }

  // Fail closed: if this insert throws, the value is never returned
  await prisma.revealLog.create({
    data: {
      environmentId: entry.environmentId,
      key: entry.key, // the name only, never the value
      source: "HISTORY",
      userId,
    },
  });

  return plain;
}