import { describe, expect, it } from "vitest";
import { MASK } from "@/lib/mask";
import { toVariableDTO } from "@/lib/variableDto";

describe("toVariableDTO", () => {
  it("masks sensitive values and leaks no ciphertext fields", () => {
    const row = {
      id: "v1",
      key: "API_KEY",
      value: "CIPHERTEXT_B64",
      isSensitive: true,
      iv: "IV_B64",
      authTag: "TAG_B64",
      version: 3,
      updatedBy: { name: "Alice" },
    };
    const dto = toVariableDTO(row);
    const json = JSON.stringify(dto);
    expect(dto.value).toBe(MASK);
    expect(dto.masked).toBe(true);
    expect(json).not.toContain("CIPHERTEXT_B64");
    expect(json).not.toContain("IV_B64");
    expect(json).not.toContain("TAG_B64");
  });

  it("passes standard values through", () => {
    const row = {
      id: "v2",
      key: "PORT",
      value: "3000",
      isSensitive: false,
      version: 1,
      updatedBy: { name: "Bob" },
    };
    const dto = toVariableDTO(row);
    expect(dto.value).toBe("3000");
    expect(dto.masked).toBe(false);
  });
});