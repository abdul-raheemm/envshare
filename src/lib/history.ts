import { randomUUID } from "node:crypto";
import type { Prisma } from "@/generated/prisma/client";
import { encrypt } from "@/lib/crypto";

export type Tx = Prisma.TransactionClient;

// A value exactly as it sits in the database.
// iv is non-null if and only if value is encrypted.
export type StoredValue = {
  value: string;
  iv: string | null;
  authTag: string | null;
};

export type HistoryInput = {
  environmentId: string;
  batchId: string;
  action: "CREATE" | "UPDATE" | "DELETE" | "TYPE_CHANGE";
  key: string;
  oldKey?: string | null; // only on renames
  old?: StoredValue | null; // only when the value changed or was deleted
  new?: StoredValue | null; // only when the value changed or was created
  oldIsSensitive?: boolean | null;
  newIsSensitive?: boolean | null;
  changedById: string;
};

export function newBatchId(): string {
  return randomUUID();
}

// Always call this inside the same transaction as the change it records
export async function writeHistory(tx: Tx, e: HistoryInput) {
  await tx.historyEntry.create({
    data: {
      environmentId: e.environmentId,
      batchId: e.batchId,
      action: e.action,
      key: e.key,
      oldKey: e.oldKey ?? null,
      oldValue: e.old?.value ?? null,
      oldIv: e.old?.iv ?? null,
      oldAuthTag: e.old?.authTag ?? null,
      newValue: e.new?.value ?? null,
      newIv: e.new?.iv ?? null,
      newAuthTag: e.new?.authTag ?? null,
      oldIsSensitive: e.oldIsSensitive ?? null,
      newIsSensitive: e.newIsSensitive ?? null,
      changedById: e.changedById,
    },
  });
}
// Decision 6: once a key is Sensitive, any plain-text history value for that key
// (including under earlier names, following the rename chain) gets encrypted.
// Call this inside the same transaction, AFTER the new history rows are written.
export async function encryptPlainHistoryForKey(
  tx: Tx,
  environmentId: string,
  currentKey: string
) {
  // 1. Collect every name this key has had (A renamed to B renamed to C)
  const names = new Set<string>([currentKey]);
  let grew = true;
  while (grew) {
    grew = false;
    const renames = await tx.historyEntry.findMany({
      where: { environmentId, key: { in: [...names] }, oldKey: { not: null } },
      select: { oldKey: true },
    });
    for (const r of renames) {
      if (r.oldKey && !names.has(r.oldKey)) {
        names.add(r.oldKey);
        grew = true;
      }
    }
  }

  // 2. Find rows that still hold a plain value (value present, iv missing)
  const rows = await tx.historyEntry.findMany({
    where: {
      environmentId,
      key: { in: [...names] },
      OR: [
        { oldValue: { not: null }, oldIv: null },
        { newValue: { not: null }, newIv: null },
      ],
    },
    select: { id: true, oldValue: true, oldIv: true, newValue: true, newIv: true },
  });

  // 3. Encrypt them in place, each with its own fresh IV
  for (const row of rows) {
    const data: {
      oldValue?: string;
      oldIv?: string;
      oldAuthTag?: string;
      newValue?: string;
      newIv?: string;
      newAuthTag?: string;
    } = {};
    if (row.oldValue !== null && row.oldIv === null) {
      const e = encrypt(row.oldValue);
      data.oldValue = e.value;
      data.oldIv = e.iv;
      data.oldAuthTag = e.authTag;
    }
    if (row.newValue !== null && row.newIv === null) {
      const e = encrypt(row.newValue);
      data.newValue = e.value;
      data.newIv = e.iv;
      data.newAuthTag = e.authTag;
    }
    await tx.historyEntry.update({ where: { id: row.id }, data });
  }
}