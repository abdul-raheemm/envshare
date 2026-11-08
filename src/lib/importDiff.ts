import { MASK } from "./mask";
import type { ParsedEntry } from "./parseEnv";

export type ExistingVariable = {
  id: string;
  key: string;
  value: string; // PLAINTEXT (already decrypted). Server-side use only.
  isSensitive: boolean;
  version: number;
};

export type DiffStatus = "NEW" | "UPDATE" | "UNCHANGED";

// SERVER ONLY: contains plaintext. Never return this from a route.
export type PlanRow = {
  key: string;
  status: DiffStatus;
  newValue: string;
  oldValue?: string;
  existingId?: string;
  existingVersion?: number;
  isSensitive: boolean; // existing type for UPDATE/UNCHANGED, planned type for NEW
  line: number;
};

// Safe to send to the browser.
export type PreviewRow = {
  key: string;
  status: DiffStatus;
  isSensitive: boolean;
  oldValue: string | null; // MASK when Sensitive
  newValue: string; // MASK when Sensitive
  version: number | null; // needed so apply can detect stale edits
  line: number;
};

export type DiffCounts = { new: number; update: number; unchanged: number };

const SENSITIVE_NAME_RE = /SECRET|KEY|TOKEN|PASSWORD/i;

export function looksSensitive(key: string): boolean {
  return SENSITIVE_NAME_RE.test(key);
}

export function computeDiff(
  existing: Map<string, ExistingVariable>,
  entries: ParsedEntry[],
  options: { autoFlagSensitive: boolean }
): PlanRow[] {
  return entries.map((entry): PlanRow => {
    const current = existing.get(entry.key); // exact, case-sensitive match

    if (!current) {
      return {
        key: entry.key,
        status: "NEW",
        newValue: entry.value,
        isSensitive: options.autoFlagSensitive && looksSensitive(entry.key),
        line: entry.line,
      };
    }

    const same = current.value === entry.value;
    return {
      key: entry.key,
      status: same ? "UNCHANGED" : "UPDATE",
      newValue: entry.value,
      oldValue: current.value,
      existingId: current.id,
      existingVersion: current.version,
      isSensitive: current.isSensitive, // existing keys keep their type
      line: entry.line,
    };
  });
}

export function countRows(rows: PlanRow[]): DiffCounts {
  const counts: DiffCounts = { new: 0, update: 0, unchanged: 0 };
  for (const r of rows) {
    if (r.status === "NEW") counts.new++;
    else if (r.status === "UPDATE") counts.update++;
    else counts.unchanged++;
  }
  return counts;
}

// The ONLY place plaintext is converted into something the client may see.
export function toPreviewRows(rows: PlanRow[]): PreviewRow[] {
  return rows.map((r) => ({
    key: r.key,
    status: r.status,
    isSensitive: r.isSensitive,
    oldValue:
      r.oldValue === undefined ? null : r.isSensitive ? MASK : r.oldValue,
    newValue: r.isSensitive ? MASK : r.newValue,
    version: r.existingVersion ?? null,
    line: r.line,
  }));
}