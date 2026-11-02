import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12;
const TAG_BYTES = 16;

export type EncryptedValue = {
  value: string; // base64 ciphertext
  iv: string; // base64, 12 bytes
  authTag: string; // base64, 16 bytes
};

function getKey(): Buffer {
  const hex = process.env.ENCRYPTION_KEY;
  if (!hex || !/^[0-9a-fA-F]{64}$/.test(hex)) {
    throw new Error("ENCRYPTION_KEY is missing or invalid");
  }
  return Buffer.from(hex, "hex");
}

export function encrypt(plaintext: string): EncryptedValue {
  const key = getKey();
  const iv = randomBytes(IV_BYTES); // fresh IV for every call, never reused
  const cipher = createCipheriv(ALGORITHM, key, iv, { authTagLength: TAG_BYTES });
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return {
    value: encrypted.toString("base64"),
    iv: iv.toString("base64"),
    authTag: cipher.getAuthTag().toString("base64"),
  };
}

export function decrypt({ value, iv, authTag }: EncryptedValue): string {
  const key = getKey();
  try {
    const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(iv, "base64"), {
      authTagLength: TAG_BYTES,
    });
    decipher.setAuthTag(Buffer.from(authTag, "base64"));
    const plain = Buffer.concat([
      decipher.update(Buffer.from(value, "base64")),
      decipher.final(),
    ]);
    return plain.toString("utf8");
  } catch {
    // Deliberately generic: never include ciphertext, IV, tag or key in an error
    throw new Error("Could not decrypt this value");
  }
}