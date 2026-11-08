import { prisma } from "@/lib/db";
import { requireEnvironmentAccess } from "@/lib/access";
import { ApiError, isUniqueViolation } from "@/lib/errors";
import { newBatchId } from "@/lib/history";
import { MASK } from "@/lib/mask";
import { parseEnv, type ParseIssue } from "@/lib/parseEnv";
import {
  computeDiff,
  countRows,
  toPreviewRows,
  type PlanRow,
  type PreviewRow,
  type DiffCounts,
} from "@/lib/importDiff";
import type { ApplyImportInput } from "@/lib/importSchemas";
import { loadExistingForDiff } from "@/lib/importLoad";
import {
  MAX_IMPORT_BYTES,
  MAX_IMPORT_ENTRIES,
  MAX_ISSUES_RETURNED,
} from "@/lib/importLimits";
import { applyCreate, applyUpdate } from "@/lib/variables";

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
    // Someone pasting a masked copy would overwrite real secrets with bullets
  if (entries.some((e) => e.value === MASK)) {
    throw new ApiError(
      400,
      "One of the values is the masked placeholder. Replace it with the real value or remove that line."
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

const STALE = "Variables changed since you reviewed this import. Review it again.";

export type ImportResult = {
  created: number;
  updated: number;
  unchanged: number;
  skipped: number;
  ignoredLines: number; // invalid lines that were skipped
  batchId: string | null; // null when nothing was written
};

export async function applyImport(
  userId: string,
  environmentId: string,
  input: ApplyImportInput
): Promise<ImportResult> {
  await requireEnvironmentAccess(userId, environmentId); // 404 for non-members

  // Maps built from own entries only: keys like "__proto__" can't do anything odd
  const overrides = new Map(Object.entries(input.rowOverrides));
  const expected = new Map(Object.entries(input.expectedVersions));

  try {
    return await prisma.$transaction(
      async (tx) => {
        // Re-parse and re-diff here. Nothing from the preview is trusted.
        const { plan, issues } = await buildImportPlan(
          tx,
          environmentId,
          input.text,
          input.autoFlagSensitive
        );

        const ctx = { userId, batchId: newBatchId() };
        const result: ImportResult = {
          created: 0,
          updated: 0,
          unchanged: 0,
          skipped: 0,
          ignoredLines: issues.filter((i) => i.kind !== "DUPLICATE_KEY").length,
          batchId: null,
        };

        for (const row of plan) {
          if (row.status === "UNCHANGED") {
            result.unchanged++;
            continue;
          }

          const override = overrides.get(row.key);
          if (override?.skip) {
            result.skipped++;
            continue;
          }

          const seen = expected.get(row.key);

          if (row.status === "NEW") {
            // Preview saw an existing variable, but the key is gone (or the client forged a version)
            if (seen !== undefined) throw new ApiError(409, STALE);
            const isSensitive = override?.isSensitive ?? row.isSensitive;
            await applyCreate(tx, ctx, environmentId, row.key, row.newValue, isSensitive);
            result.created++;
            continue;
          }

          // UPDATE: the user must have reviewed exactly this version
          if (seen === undefined || seen !== row.existingVersion) {
            throw new ApiError(409, STALE);
          }
          const current = await tx.variable.findUnique({
            where: { id: row.existingId! },
            select: {
              id: true,
              key: true,
              value: true,
              isSensitive: true,
              iv: true,
              authTag: true,
              version: true,
              environmentId: true,
              environment: { select: { projectId: true } },
            },
          });
          if (!current) throw new ApiError(409, STALE);
          // Type never changes on import: no isSensitive passed
          await applyUpdate(tx, ctx, current, { value: row.newValue, version: seen });
          result.updated++;
        }

        if (result.created + result.updated > 0) result.batchId = ctx.batchId;
        return result;
      },
      { timeout: 30_000, maxWait: 5_000 } // default is 5s; 500 rows need more
    );
  } catch (e) {
    // A race on the same key (unique violation) or any conflict means "review again"
    if (isUniqueViolation(e) || (e instanceof ApiError && e.status === 409)) {
      throw new ApiError(409, STALE);
    }
    throw e;
  }
}