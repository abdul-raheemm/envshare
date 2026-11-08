import { prisma } from "@/lib/db";
import { requireEnvironmentAccess } from "@/lib/access";
import { ApiError } from "@/lib/errors";
import { parseEnv, type ParseIssue } from "@/lib/parseEnv";
import {
  computeDiff,
  countRows,
  toPreviewRows,
  type PlanRow,
  type PreviewRow,
  type DiffCounts,
} from "@/lib/importDiff";
import { loadExistingForDiff } from "@/lib/importLoad";
import {
  MAX_IMPORT_BYTES,
  MAX_IMPORT_ENTRIES,
  MAX_ISSUES_RETURNED,
} from "@/lib/importLimits";

type Db = Pick<typeof prisma, "variable">;

// SERVER ONLY: the plan contains plaintext. Step 3.5 (apply) reuses this.
// Does NOT check access; callers must do that first.
export async function buildImportPlan(
  db: Db,
  environmentId: string,
  text: string,
  autoFlagSensitive: boolean
): Promise<{ plan: PlanRow[]; issues: ParseIssue[] }> {
  if (Buffer.byteLength(text, "utf8") > MAX_IMPORT_BYTES) {
    throw new ApiError(
      400,
      `That text is too large. The limit is ${MAX_IMPORT_BYTES / 1024} KB.`
    );
  }

  const { entries, issues } = parseEnv(text);

  if (entries.length > MAX_IMPORT_ENTRIES) {
    throw new ApiError(
      400,
      `Too many variables. The limit is ${MAX_IMPORT_ENTRIES} per import.`
    );
  }

  const existing = await loadExistingForDiff(db, environmentId);
  const plan = computeDiff(existing, entries, { autoFlagSensitive });
  return { plan, issues };
}

// What the client is allowed to see about a parse issue.
// Deliberately NO `raw` field: it can contain the pasted secret.
export type PreviewIssue = {
  line: number;
  kind: ParseIssue["kind"];
  message: string;
};

export type ImportPreview = {
  rows: PreviewRow[];
  issues: PreviewIssue[];
  issuesTruncated: boolean;
  counts: DiffCounts & { invalid: number; duplicates: number };
};

export async function previewImport(
  userId: string,
  environmentId: string,
  input: { text: string; autoFlagSensitive: boolean }
): Promise<ImportPreview> {
  await requireEnvironmentAccess(userId, environmentId); // 404 for non-members

  const { plan, issues } = await buildImportPlan(
    prisma,
    environmentId,
    input.text,
    input.autoFlagSensitive
  );

  const duplicates = issues.filter((i) => i.kind === "DUPLICATE_KEY").length;

  return {
    rows: toPreviewRows(plan),
    issues: issues.slice(0, MAX_ISSUES_RETURNED).map((i) => ({
      line: i.line,
      kind: i.kind,
      message: i.message,
    })),
    issuesTruncated: issues.length > MAX_ISSUES_RETURNED,
    counts: {
      ...countRows(plan),
      invalid: issues.length - duplicates, // skipped lines; duplicates are just warnings
      duplicates,
    },
  };
}