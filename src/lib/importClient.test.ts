import { describe, expect, it } from "vitest";
import { buildApplyRequest, countSelectedChanges, initialChoices } from "./importClient";
import type { ImportPreview } from "./importTypes";

const preview = (rows: ImportPreview["rows"]): ImportPreview => ({
  rows,
  issues: [],
  issuesTruncated: false,
  counts: { new: 0, update: 0, unchanged: 0, invalid: 0, duplicates: 0 },
});

const row = (over: Partial<ImportPreview["rows"][number]>): ImportPreview["rows"][number] => ({
  key: "K",
  status: "NEW",
  isSensitive: false,
  oldValue: null,
  newValue: "v",
  version: null,
  line: 1,
  ...over,
});

const sample = preview([
  row({ key: "NEW_A", status: "NEW", newValue: "CANARY-client-new-1a1a" }),
  row({ key: "API_TOKEN", status: "NEW", isSensitive: true }),
  row({ key: "PORT", status: "UPDATE", oldValue: "CANARY-client-old-2b2b", newValue: "4000", version: 3 }),
  row({ key: "DEBUG", status: "UNCHANGED", oldValue: "true", newValue: "true", version: 5 }),
]);

describe("importClient", () => {
  it("starts with every row included and the previewed type", () => {
    const c = initialChoices(sample);
    expect(c.get("NEW_A")).toEqual({ include: true, isSensitive: false });
    expect(c.get("API_TOKEN")).toEqual({ include: true, isSensitive: true });
  });

  it("counts only included rows that actually change something", () => {
    const c = initialChoices(sample);
    expect(countSelectedChanges(sample, c)).toBe(3); // UNCHANGED never counts
    c.set("PORT", { include: false, isSensitive: false });
    expect(countSelectedChanges(sample, c)).toBe(2);
  });

  it("sends skips, NEW-only type overrides, and the versions the user saw", () => {
    const c = initialChoices(sample);
    c.set("NEW_A", { include: false, isSensitive: true });
    c.set("API_TOKEN", { include: true, isSensitive: false }); // user unflagged it
    const req = buildApplyRequest(sample, c, "RAW TEXT", true);

    expect(req.text).toBe("RAW TEXT");
    expect(req.autoFlagSensitive).toBe(true);
    expect(req.rowOverrides).toEqual({
      NEW_A: { skip: true, isSensitive: true },
      API_TOKEN: { skip: false, isSensitive: false },
      PORT: { skip: false }, // existing key: no type override
    });
    expect("DEBUG" in req.rowOverrides).toBe(false); // UNCHANGED rows are omitted
    expect(req.expectedVersions).toEqual({ PORT: 3, DEBUG: 5 }); // NEW rows have no version
  });

  it("never sends preview values back to the server", () => {
    const req = buildApplyRequest(sample, initialChoices(sample), "A=1", false);
    const json = JSON.stringify(req);
    expect(json).not.toContain("CANARY-client-new-1a1a");
    expect(json).not.toContain("CANARY-client-old-2b2b");
  });

  it('handles a key named "__proto__" without touching prototypes', () => {
    const p = preview([row({ key: "__proto__", status: "NEW" })]);
    const req = buildApplyRequest(p, initialChoices(p), "x", false);
    expect(Object.keys(req.rowOverrides)).toEqual(["__proto__"]);
    expect(Object.getPrototypeOf(req.rowOverrides)).toBe(Object.prototype);
  });
});