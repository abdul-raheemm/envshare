import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { decrypt, encrypt } from "@/lib/crypto";

const KEY_A = "a1".repeat(32); // 64 hex chars
const KEY_B = "b2".repeat(32);

function flipFirstByte(b64: string): string {
  const buf = Buffer.from(b64, "base64");
  buf[0] ^= 0xff;
  return buf.toString("base64");
}

describe("crypto", () => {
  beforeEach(() => {
    vi.stubEnv("ENCRYPTION_KEY", KEY_A);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("round-trips a value", () => {
    expect(decrypt(encrypt("postgres://user:pass@host/db"))).toBe(
      "postgres://user:pass@host/db",
    );
  });

  it("round-trips empty strings and unicode", () => {
    expect(decrypt(encrypt(""))).toBe("");
    expect(decrypt(encrypt("pässwörd-日本語-🔑"))).toBe("pässwörd-日本語-🔑");
  });

  it("uses a 12-byte IV and 16-byte tag", () => {
    const e = encrypt("x");
    expect(Buffer.from(e.iv, "base64").length).toBe(12);
    expect(Buffer.from(e.authTag, "base64").length).toBe(16);
  });

  it("produces different ciphertext and IV for the same plaintext", () => {
    const a = encrypt("same-value");
    const b = encrypt("same-value");
    expect(a.iv).not.toBe(b.iv);
    expect(a.value).not.toBe(b.value);
  });

  it("fails with a different key", () => {
    const e = encrypt("secret-value");
    vi.stubEnv("ENCRYPTION_KEY", KEY_B);
    expect(() => decrypt(e)).toThrow("Could not decrypt this value");
  });

  it("detects a tampered ciphertext", () => {
    const e = encrypt("secret-value");
    expect(() => decrypt({ ...e, value: flipFirstByte(e.value) })).toThrow(
      "Could not decrypt this value",
    );
  });

  it("detects a tampered auth tag", () => {
    const e = encrypt("secret-value");
    expect(() => decrypt({ ...e, authTag: flipFirstByte(e.authTag) })).toThrow(
      "Could not decrypt this value",
    );
  });

  it("detects a tampered IV", () => {
    const e = encrypt("secret-value");
    expect(() => decrypt({ ...e, iv: flipFirstByte(e.iv) })).toThrow(
      "Could not decrypt this value",
    );
  });

  it("rejects a missing key", () => {
    vi.stubEnv("ENCRYPTION_KEY", "");
    expect(() => encrypt("x")).toThrow("ENCRYPTION_KEY is missing or invalid");
  });

  it("rejects a key of the wrong length", () => {
    vi.stubEnv("ENCRYPTION_KEY", "abc123");
    expect(() => encrypt("x")).toThrow("ENCRYPTION_KEY is missing or invalid");
  });

  it("never leaks the plaintext in an error message", () => {
    const e = encrypt("super-secret-token");
    try {
      decrypt({ ...e, value: flipFirstByte(e.value) });
    } catch (err) {
      expect((err as Error).message).not.toContain("super-secret-token");
    }
  });
});