import { MASK } from "@/lib/mask";

export type HistoryValueDTO = { masked: boolean; value: string };

export type HistoryItemDTO = {
  id: string;
  batchId: string;
  action: "CREATE" | "UPDATE" | "DELETE" | "TYPE_CHANGE";
  key: string;
  oldKey: string | null;
  oldIsSensitive: boolean | null;
  newIsSensitive: boolean | null;
  changedAt: string; // ISO date
  changedByName: string;
  old: HistoryValueDTO | null;
  new: HistoryValueDTO | null;
};

type HistoryRow = {
  id: string;
  batchId: string;
  action: "CREATE" | "UPDATE" | "DELETE" | "TYPE_CHANGE";
  key: string;
  oldKey: string | null;
  oldValue: string | null;
  oldIv: string | null;
  newValue: string | null;
  newIv: string | null;
  oldIsSensitive: boolean | null;
  newIsSensitive: boolean | null;
  changedAt: Date;
  changedBy: { name: string };
};

// A value is encrypted if and only if its iv is non-null
function toValue(value: string | null, iv: string | null): HistoryValueDTO | null {
  if (value === null) return null;
  return iv !== null ? { masked: true, value: MASK } : { masked: false, value };
}

// Picks fields explicitly, so ciphertext, iv and authTag can never slip through
export function toHistoryItemDTO(row: HistoryRow): HistoryItemDTO {
  return {
    id: row.id,
    batchId: row.batchId,
    action: row.action,
    key: row.key,
    oldKey: row.oldKey,
    oldIsSensitive: row.oldIsSensitive,
    newIsSensitive: row.newIsSensitive,
    changedAt: row.changedAt.toISOString(),
    changedByName: row.changedBy.name,
    old: toValue(row.oldValue, row.oldIv),
    new: toValue(row.newValue, row.newIv),
  };
}