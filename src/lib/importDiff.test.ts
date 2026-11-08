import { describe, it, expect } from "vitest";
import { computeDiff, countRows, toPreviewRows, looksSensitive, type ExistingVariable } from "./importDiff";
import { MASK } from "./mask";
import type { ParsedEntry } from "./parseEnv";

const entry = (key: string, value: string, line = 1): ParsedEntry => ({
  key, value, line, hadExport: false,
});

const existing = (...vars: Partial<ExistingVariable>[]) =>
  new Map(
    vars.map((v, i) => [
      v.key!,
      { id: `id${i}`, value: "", isSensitive: false, version: 1, ...v } as ExistingVariable,
    ])
  );

describe("computeDiff", () => {
  const map = existing(
    { key: "PORT", value: "3000" },
    { key: "DEBUG", value: "true", version: 4 },
    { key: "DB_PASSWORD", value: "old-secret", isSensitive: true, version: 2 }
  );

  it("classifies NEW / UPDATE / UNCHANGED", () => {
    const rows = computeDiff(
      map,
      [entry("PORT", "3000"), entry("DEBUG", "false"), entry("NEW_ONE", "x")],
      { autoFlagSensitive: false }
    );
    expect(rows.map((r) => [r.key, r.status])).toEqual([
      ["PORT", "UNCHANGED"],
      ["DEBUG", "UPDATE"],
      ["NEW_ONE", "NEW"],
    ]);
    expect(rows[1]).toMatchObject({ oldValue: "true", newValue: "false", existingVersion: 4 });
    expect(countRows(rows)).toEqual({ new: 1, update: 1, unchanged: 1 });
  });

  it("is case-sensitive and whitespace-sensitive", () => {
    const rows = computeDiff(map, [entry("port", "3000"), entry("PORT", "3000 ")], {
      autoFlagSensitive: false,
    });
    expect(rows.map((r) => r.status)).toEqual(["NEW", "UPDATE"]);
  });

  it("existing keys keep their type, even if the name looks different", () => {
    const rows = computeDiff(map, [entry("DB_PASSWORD", "new-secret"), entry("PORT", "1")], {
      autoFlagSensitive: true,
    });
    expect(rows[0]).toMatchObject({ status: "UPDATE", isSensitive: true });
    expect(rows[1]).toMatchObject({ status: "UPDATE", isSensitive: false });
  });

  it("detects an unchanged Sensitive value by comparing plaintext", () => {
    const rows = computeDiff(map, [entry("DB_PASSWORD", "old-secret")], { autoFlagSensitive: false });
    expect(rows[0].status).toBe("UNCHANGED");
  });

  it("auto-flags NEW keys only when enabled", () => {
    const on = computeDiff(map, [entry("API_TOKEN", "t"), entry("HOST", "h")], { autoFlagSensitive: true });
    const off = computeDiff(map, [entry("API_TOKEN", "t")], { autoFlagSensitive: false });
    expect(on.map((r) => r.isSensitive)).toEqual([true, false]);
    expect(off[0].isSensitive).toBe(false);
  });

  it("looksSensitive matches the documented words (case-insensitive)", () => {
    for (const k of ["SECRET_X", "api_key", "AUTH_TOKEN", "DB_PASSWORD"]) {
      expect(looksSensitive(k)).toBe(true);
    }
    expect(looksSensitive("PORT")).toBe(false);
  });
});

describe("toPreviewRows (what the client may see)", () => {
  it("masks every value of Sensitive rows and never leaks plaintext", () => {
    const map = existing({ key: "DB_PASSWORD", value: "old-secret", isSensitive: true, version: 2 });
    const rows = computeDiff(
      map,
      [entry("DB_PASSWORD", "new-secret"), entry("STRIPE_KEY", "sk_live_abc")],
      { autoFlagSensitive: true }
    );
    const preview = toPreviewRows(rows);
    const json = JSON.stringify(preview);

    expect(json).not.toContain("old-secret");
    expect(json).not.toContain("new-secret");
    expect(json).not.toContain("sk_live_abc");
    expect(preview[0]).toMatchObject({ oldValue: MASK, newValue: MASK, version: 2 });
    expect(preview[1]).toMatchObject({ status: "NEW", oldValue: null, newValue: MASK });
  });

  it("shows real old and new values for Standard rows", () => {
    const map = existing({ key: "DEBUG", value: "true" });
    const preview = toPreviewRows(computeDiff(map, [entry("DEBUG", "false")], { autoFlagSensitive: false }));
    expect(preview[0]).toMatchObject({ oldValue: "true", newValue: "false" });
  });
});