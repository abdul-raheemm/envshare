import type { DiffCounts, PreviewRow } from "@/lib/importDiff";
import type { ParseIssue } from "@/lib/parseEnv";

// Deliberately no `raw` field: it can contain the pasted secret.
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

export type ImportResult = {
  created: number;
  updated: number;
  unchanged: number;
  skipped: number;
  ignoredLines: number;
  batchId: string | null;
};