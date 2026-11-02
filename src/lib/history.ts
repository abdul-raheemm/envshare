import { randomUUID } from "node:crypto";
import type { Prisma } from "@/generated/prisma/client";

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
