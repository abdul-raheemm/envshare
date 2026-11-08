import { prisma } from "@/lib/db";
import { decrypt } from "@/lib/crypto";
import type { ExistingVariable } from "@/lib/importDiff";

// Accepts the normal client or a transaction client.
type Db = Pick<typeof prisma, "variable">;

// Loads an environment's variables WITH Sensitive values decrypted.
// For diffing only: the result must never leave the server.
// Does NOT check access; the calling route must do that first.
export async function loadExistingForDiff(
  db: Db,
  environmentId: string
): Promise<Map<string, ExistingVariable>> {
  const rows = await db.variable.findMany({
    where: { environmentId },
    select: {
      id: true,
      key: true,
      value: true,
      isSensitive: true,
      iv: true,
      authTag: true,
      version: true,
    },
  });

  const map = new Map<string, ExistingVariable>();
  for (const row of rows) {
    // Phase 2 convention: a value is encrypted iff its iv is non-null.
    let value = row.value;
    if (row.iv !== null) {
      if (row.authTag === null) {
        throw new Error("Stored value is incomplete"); // corrupted row: fail, don't guess
      }
      value = decrypt({ value: row.value, iv: row.iv, authTag: row.authTag });
    }

    map.set(row.key, {
      id: row.id,
      key: row.key,
      value,
      isSensitive: row.isSensitive,
      version: row.version,
    });
  }
  return map;
}