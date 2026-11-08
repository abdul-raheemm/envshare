import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import { MASK } from "@/lib/mask";
import { previewImport } from "@/lib/importPlan";
import { MAX_IMPORT_ENTRIES, MAX_ISSUES_RETURNED } from "@/lib/importLimits";
import { previewImportSchema } from "@/lib/importSchemas";
import { createVariable } from "@/lib/variables";
import { dbHits, flip, resetDb, seedWorld, statusOf, type World } from "./helpers";

let w: World;

beforeEach(async () => {
  await resetDb();
  w = await seedWorld();
});
afterEach(() => {
  vi.unstubAllEnvs();
});
afterAll(async () => {
  await prisma.$disconnect();
});

const preview = (userId: string, envId: string, text: string, autoFlagSensitive = false) =>
  previewImport(userId, envId, { text, autoFlagSensitive });

async function makeVar(key: string, value: string, sensitive: boolean, envId = w.dev.id) {
  const { id } = await createVariable(w.alice.id, envId, key, value, sensitive);
  return id;
}

// Returns the error message, or null if the call succeeded
async function errorOf(p: Promise<unknown>): Promise<string | null> {
  try {
    await p;
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}

const tableCounts = async () => ({
  variables: await prisma.variable.count(),
  history: await prisma.historyEntry.count(),
  reveals: await prisma.revealLog.count(),
});

type Result = Awaited<ReturnType<typeof previewImport>>;
const rowOf = (res: Result, key: string) => res.rows.find((r) => r.key === key)!;

describe("import preview: access control", () => {
  it("a non-member gets 404, for a real environment and for tampered ids", async () => {
    await makeVar("PRIVATE", "CANARY-imp-access-1a1a", true);
    const malloryEnv = await prisma.environment.findFirstOrThrow({
      where: { project: { ownerId: w.mallory.id } },
    });
    const before = await tableCounts();

    expect(await statusOf(preview(w.mallory.id, w.dev.id, "A=1"))).toBe(404);
    expect(await statusOf(preview(w.alice.id, malloryEnv.id, "A=1"))).toBe(404); // alice is not in Mallory's project
    expect(await statusOf(preview(w.alice.id, "does-not-exist", "A=1"))).toBe(404);

    expect(await tableCounts()).toEqual(before);
  });

  it("any project member can preview", async () => {
    await makeVar("PORT", "3000", false);
    const res = await preview(w.bob.id, w.dev.id, "PORT=3000");
    expect(rowOf(res, "PORT").status).toBe("UNCHANGED");
  });
});

describe("import preview: no plaintext in the response", () => {
  it("masks old and new values of Sensitive rows and leaks no ciphertext", async () => {
    const oldS = "CANARY-prev-old-1a2b3c";
    const newS = "CANARY-prev-new-4d5e6f";
    const freshS = "CANARY-prev-fresh-7a8b9c";
    await makeVar("DB_PASSWORD", oldS, true);
    const raw = await prisma.variable.findFirstOrThrow({ where: { key: "DB_PASSWORD" } });

    const res = await preview(
      w.alice.id,
      w.dev.id,
      `DB_PASSWORD=${newS}\nSTRIPE_KEY=${freshS}\nPORT=3000`,
      true
    );
    const json = JSON.stringify(res);

    for (const leak of [oldS, newS, freshS, raw.value, raw.iv!, raw.authTag!]) {
      expect(json).not.toContain(leak);
    }
    expect(json).toContain(MASK);

    expect(rowOf(res, "DB_PASSWORD")).toMatchObject({
      status: "UPDATE",
      isSensitive: true,
      oldValue: MASK,
      newValue: MASK,
      version: raw.version,
    });
    expect(rowOf(res, "STRIPE_KEY")).toMatchObject({
      status: "NEW",
      isSensitive: true,
      oldValue: null,
      newValue: MASK,
    });
    // Standard values are shown as-is
    expect(rowOf(res, "PORT")).toMatchObject({ status: "NEW", isSensitive: false, newValue: "3000" });
  });

  it("an unchanged Sensitive value is detected by plaintext comparison and still masked", async () => {
    const secret = "CANARY-prev-same-2b2b2b";
    await makeVar("API_TOKEN", secret, true);
    const res = await preview(w.alice.id, w.dev.id, `API_TOKEN=${secret}`);
    expect(rowOf(res, "API_TOKEN").status).toBe("UNCHANGED");
    expect(JSON.stringify(res)).not.toContain(secret);
  });

  it("issues carry no raw line and no pasted value", async () => {
    const text = [
      'LEAKY="CANARY-unterminated-aa11bb22', // unterminated quote
      "CANARY-novalue-cc33dd44", // no "="
      "1BAD=CANARY-badkey-ee55ff66", // invalid key
      "DUP=CANARY-dup-first-0a0a",
      "DUP=CANARY-dup-last-1b1b",
    ].join("\n");
    const res = await preview(w.alice.id, w.dev.id, text);

    expect(res.issues.length).toBeGreaterThanOrEqual(4);
    for (const issue of res.issues) {
      expect(Object.keys(issue).sort()).toEqual(["kind", "line", "message"]);
    }
    const issuesJson = JSON.stringify(res.issues);
    for (const c of ["CANARY-unterminated", "CANARY-novalue", "CANARY-badkey", "CANARY-dup"]) {
      expect(issuesJson).not.toContain(c);
    }
    // Skipped lines never appear anywhere in the response (the DUP value is a real row, so it may)
    const whole = JSON.stringify(res);
    for (const c of ["CANARY-unterminated", "CANARY-novalue", "CANARY-badkey"]) {
      expect(whole).not.toContain(c);
    }
  });
});

describe("import preview: read-only", () => {
  it("writes nothing and changes no existing row", async () => {
    await makeVar("KEEP", "1", false);
    await makeVar("SECRET_KEEP", "CANARY-readonly-3c3c3c", true);
    const snapshot = () => prisma.variable.findMany({ orderBy: { key: "asc" } });
    const rowsBefore = await snapshot();
    const countsBefore = await tableCounts();

    await preview(
      w.alice.id,
      w.dev.id,
      "KEEP=2\nSECRET_KEEP=CANARY-readonly-new-4d4d4d\nBRAND_NEW=CANARY-readonly-fresh-5e5e5e",
      true
    );

    expect(await tableCounts()).toEqual(countsBefore);
    expect(await snapshot()).toEqual(rowsBefore); // same values, versions and updatedAt
    expect(await dbHits("CANARY-readonly-new-4d4d4d")).toEqual([]);
    expect(await dbHits("CANARY-readonly-fresh-5e5e5e")).toEqual([]);
  });
});

describe("import preview: limits", () => {
  it("rejects text over the byte limit", async () => {
    const big = "A=1\n".repeat(30000); // 120,000 bytes
    expect(await statusOf(preview(w.alice.id, w.dev.id, big))).toBe(400);
    expect(await errorOf(preview(w.alice.id, w.dev.id, big))).toMatch(/too large/i);
  });

  it("measures bytes, not characters", async () => {
    const multibyte = "A=" + "é".repeat(60000); // 60,002 characters but about 120,000 bytes
    expect(await statusOf(preview(w.alice.id, w.dev.id, multibyte))).toBe(400);
  });

  it("rejects more than the entry limit but accepts exactly the limit", async () => {
    const lines = (n: number) => Array.from({ length: n }, (_, i) => `K${i}=1`).join("\n");
    expect(await statusOf(preview(w.alice.id, w.dev.id, lines(MAX_IMPORT_ENTRIES + 1)))).toBe(400);
    expect(await errorOf(preview(w.alice.id, w.dev.id, lines(MAX_IMPORT_ENTRIES + 1)))).toMatch(/too many/i);
    const ok = await preview(w.alice.id, w.dev.id, lines(MAX_IMPORT_ENTRIES));
    expect(ok.rows).toHaveLength(MAX_IMPORT_ENTRIES);
  });

  it("caps the issues list but reports the true count", async () => {
    const text = Array.from({ length: 150 }, (_, i) => `bad line ${i}`).join("\n");
    const res = await preview(w.alice.id, w.dev.id, text);
    expect(res.issues).toHaveLength(MAX_ISSUES_RETURNED);
    expect(res.issuesTruncated).toBe(true);
    expect(res.counts.invalid).toBe(150);
  });

  it("counts invalid lines and duplicates separately", async () => {
    const res = await preview(w.alice.id, w.dev.id, "A=1\nnot valid\nA=2\n1BAD=x");
    expect(res.counts).toMatchObject({ new: 1, invalid: 2, duplicates: 1 });
  });
});

describe("import preview: matching rules against real rows", () => {
  it("keys are case-sensitive", async () => {
    await makeVar("PORT", "3000", false);
    const res = await preview(w.alice.id, w.dev.id, "Port=3000\nPORT=3000");
    expect(rowOf(res, "Port").status).toBe("NEW");
    expect(rowOf(res, "PORT").status).toBe("UNCHANGED");
  });

  it("values are compared exactly: quoted whitespace counts, unquoted is trimmed", async () => {
    await makeVar("PORT", "3000", false);
    expect(rowOf(await preview(w.alice.id, w.dev.id, 'PORT="3000 "'), "PORT").status).toBe("UPDATE");
    expect(rowOf(await preview(w.alice.id, w.dev.id, "PORT=3000   "), "PORT").status).toBe("UNCHANGED");
  });

  it("only looks at the requested environment", async () => {
    await makeVar("ONLY_IN_STAGING", "1", false, w.staging.id);
    const res = await preview(w.alice.id, w.dev.id, "ONLY_IN_STAGING=1");
    expect(rowOf(res, "ONLY_IN_STAGING").status).toBe("NEW");
  });

  it("an existing key keeps its type even when auto-flag is on", async () => {
    await makeVar("DB_PASSWORD", "old", false); // Standard, though the name looks secret
    const res = await preview(w.alice.id, w.dev.id, "DB_PASSWORD=new", true);
    expect(rowOf(res, "DB_PASSWORD")).toMatchObject({ status: "UPDATE", isSensitive: false, newValue: "new" });
  });
});

describe("import preview: key and data problems", () => {
  it("a wrong ENCRYPTION_KEY fails safely, leaks nothing, and the real key recovers", async () => {
    const secret = "CANARY-imp-wrongkey-6f6f6f";
    await makeVar("KEYED", secret, true);
    const raw = await prisma.variable.findFirstOrThrow({ where: { key: "KEYED" } });

    vi.stubEnv("ENCRYPTION_KEY", "d4".repeat(32));
    const msg = await errorOf(preview(w.alice.id, w.dev.id, "KEYED=x"));
    expect(msg).not.toBeNull();
    for (const leak of [secret, raw.value, raw.iv!, raw.authTag!, "d4".repeat(32)]) {
      expect(msg!).not.toContain(leak);
    }

    vi.unstubAllEnvs();
    expect(rowOf(await preview(w.alice.id, w.dev.id, `KEYED=${secret}`), "KEYED").status).toBe("UNCHANGED");
  });

  it("a missing key blocks previews only when Sensitive variables exist", async () => {
    await makeVar("PLAIN", "1", false);
    vi.stubEnv("ENCRYPTION_KEY", "");
    expect(await statusOf(preview(w.alice.id, w.dev.id, "PLAIN=1"))).toBe("ok");
    vi.unstubAllEnvs();

    await makeVar("SECRET_ONE", "CANARY-imp-nokey-7a7a7a", true);
    vi.stubEnv("ENCRYPTION_KEY", "");
    expect(await statusOf(preview(w.alice.id, w.dev.id, "PLAIN=1"))).not.toBe("ok");
  });

  it("a tampered stored value fails safely without leaking", async () => {
    const id = await makeVar("TAMPER", "CANARY-imp-tamper-8b8b8b", true);
    const v = await prisma.variable.findUniqueOrThrow({ where: { id } });
    await prisma.variable.update({ where: { id }, data: { value: flip(v.value) } });
    const msg = await errorOf(preview(w.alice.id, w.dev.id, "TAMPER=x"));
    expect(msg).not.toBeNull();
    expect(msg!).not.toContain("CANARY-imp-tamper-8b8b8b");
  });

  it("a corrupted row (iv without authTag) fails instead of guessing", async () => {
    const id = await makeVar("BROKEN", "CANARY-imp-broken-9c9c9c", true);
    await prisma.variable.update({ where: { id }, data: { authTag: null } });
    expect(await statusOf(preview(w.alice.id, w.dev.id, "BROKEN=x"))).not.toBe("ok");
  });
});

describe("import preview: request schema", () => {
  it("requires non-empty text and a boolean flag", () => {
    expect(previewImportSchema.safeParse({ text: "" }).success).toBe(false);
    expect(previewImportSchema.safeParse({}).success).toBe(false);
    expect(previewImportSchema.safeParse({ text: 123 }).success).toBe(false);
    expect(previewImportSchema.safeParse({ text: "A=1", autoFlagSensitive: "yes" }).success).toBe(false);
  });

  it("defaults autoFlagSensitive to false", () => {
    const parsed = previewImportSchema.parse({ text: "A=1" });
    expect(parsed.autoFlagSensitive).toBe(false);
  });
});