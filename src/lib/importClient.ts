import type { ImportPreview } from "@/lib/importTypes";

export type RowChoice = { include: boolean; isSensitive: boolean };
// A Map, not a plain object: a key named "__proto__" is a valid env name
export type Choices = Map<string, RowChoice>;

export function initialChoices(preview: ImportPreview): Choices {
  return new Map(
    preview.rows.map((r) => [r.key, { include: true, isSensitive: r.isSensitive }])
  );
}

export function countSelectedChanges(preview: ImportPreview, choices: Choices): number {
  return preview.rows.filter(
    (r) => r.status !== "UNCHANGED" && choices.get(r.key)?.include
  ).length;
}

// The apply request carries only the text, the user's choices and the versions they saw.
// It never carries values from the preview: the server re-diffs everything.
export function buildApplyRequest(
  preview: ImportPreview,
  choices: Choices,
  text: string,
  autoFlagSensitive: boolean
) {
  const rowOverrides = Object.fromEntries(
    preview.rows
      .filter((r) => r.status !== "UNCHANGED")
      .map((r) => {
        const c = choices.get(r.key) ?? { include: true, isSensitive: r.isSensitive };
        return [
          r.key,
          {
            skip: !c.include,
            // The server ignores type overrides for existing keys; only NEW rows send one
            ...(r.status === "NEW" ? { isSensitive: c.isSensitive } : {}),
          },
        ] as const;
      })
  );

  const expectedVersions = Object.fromEntries(
    preview.rows.flatMap((r) => (r.version === null ? [] : [[r.key, r.version] as const]))
  );

  return { text, autoFlagSensitive, rowOverrides, expectedVersions };
}