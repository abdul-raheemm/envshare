import { describe, expect, it } from "vitest";
import { toHistoryItemDTO } from "@/lib/historyDto";
import { MASK } from "@/lib/mask";

const base = {
  id: "h1",
  batchId: "b1",
  action: "UPDATE" as const,
  key: "API_KEY",
  oldKey: null,
  oldIsSensitive: true,
  newIsSensitive: true,
  changedAt: new Date("2026-11-02T10:00:00Z"),
  changedBy: { name: "Alice" },
};

describe("toHistoryItemDTO", () => {
  it("masks encrypted values and leaks no ciphertext fields", () => {
    const row = {
      ...base,
      oldValue: "OLD_CIPHERTEXT",
      oldIv: "OLD_IV",
      oldAuthTag: "OLD_TAG",
      newValue: "NEW_CIPHERTEXT",
      newIv: "NEW_IV",
      newAuthTag: "NEW_TAG",
    };
    const dto = toHistoryItemDTO(row);
    const json = JSON.stringify(dto);
    expect(dto.old).toEqual({ masked: true, value: MASK });
    expect(dto.new).toEqual({ masked: true, value: MASK });
    for (const secret of ["OLD_CIPHERTEXT", "OLD_IV", "OLD_TAG", "NEW_CIPHERTEXT", "NEW_IV", "NEW_TAG"]) {
      expect(json).not.toContain(secret);
    }
  });

  it("passes plain values through, including empty strings", () => {
    const dto = toHistoryItemDTO({
      ...base,
      oldIsSensitive: false,
      newIsSensitive: false,
      oldValue: "3000",
      oldIv: null,
      newValue: "",
      newIv: null,
    });
    expect(dto.old).toEqual({ masked: false, value: "3000" });
    expect(dto.new).toEqual({ masked: false, value: "" });
  });

  it("returns null for rows without values (renames, type changes)", () => {
    const dto = toHistoryItemDTO({
      ...base,
      action: "TYPE_CHANGE",
      oldValue: null,
      oldIv: null,
      newValue: null,
      newIv: null,
    });
    expect(dto.old).toBeNull();
    expect(dto.new).toBeNull();
  });

  it("serializes the date as an ISO string", () => {
    const dto = toHistoryItemDTO({
      ...base,
      oldValue: null,
      oldIv: null,
      newValue: null,
      newIv: null,
    });
    expect(dto.changedAt).toBe("2026-11-02T10:00:00.000Z");
  });
});