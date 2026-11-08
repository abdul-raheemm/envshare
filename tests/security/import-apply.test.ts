import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import { MASK } from "@/lib/mask";
import { applyImport, previewImport } from "@/lib/importPlan";
import { applyImportSchema, type ApplyImportInput } from "@/lib/importSchemas";
import { MAX_IMPORT_ENTRIES } from "@/lib/importLimits";
import { revealVariable } from "@/lib/reveal";
import { createVariable, updateVariable, deleteVariable } from "@/lib/variables";
import { blockInserts, dbHits, resetDb, seedWorld, statusOf, unblockInserts, type World } from "./helpers";

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

async function makeVar(key: string, value: string, sensitive = false, envId = w.dev.id) {
  const { id } = await createVariable(w.alice.id, envId, key, value, sensitive);
  return id;
}

const varOf = (key: string, envId = w.dev.id) =>
  prisma.variable.findUnique({ where: { environmentId_key: { environmentId: envId, key } } });

const history = () => prisma.historyEntry.findMany({ orderBy: { changedAt: "asc" } });

const tableCounts = async () => ({
  variables: await prisma.variable.count(),
  history: await prisma.historyEntry.count(),
  reveals: await prisma.revealLog.count(),
});

// What the UI will do: preview, then send back the versions it saw
async function versionsFor(userId: string, envId: string, text: string, autoFlag = false) {
  const res = await previewImport(userId, envId, { text, autoFlagSensitive: autoFlag });
  const expectedVersions: Record<string, number> = {};
  for (const r of res.rows) if (r.version !== null) expectedVersions[r.key] = r.version;
  return expectedVersions;
}

const apply = (
  userId: string,
  envId: string,
  text: string,
  opts: Partial<ApplyImportInput> = {}
) =>
  applyImport(userId, envId, {
    text,
    autoFlagSensitive: false,
    rowOverrides: {},
    expectedVersions: {},
    ...opts,
  });

describe("import apply: happy path", () => {
  it("creates and updates in one batch, keeps types, and leaks nothing", async () => {
    const oldS = "CANARY-apply-old-1a1a1a";
    const newS = "CANARY-apply-new-2b2b2b";
    const tokenS = "CANARY-apply-token-3c3c3c";
    await makeVar("PORT", "3000");
    await makeVar("DEBUG", "true");
    await makeVar("DB_PASSWORD", oldS, true);

    const text = `PORT=4000\nDEBUG=true\nDB_PASSWORD=${newS}\nNEW_A=1\nAPI_TOKEN=${tokenS}`;
    const expectedVersions = await versionsFor(w.bob.id, w.dev.id, text, true);
    const baseline = (await history()).length;

    const result = await apply(w.bob.id, w.dev.id, text, { autoFlagSensitive: true, expectedVersions });

    expect(result).toMatchObject({ created: 2, updated: 2, unchanged: 1, skipped: 0, ignoredLines: 0 });
    expect(result.batchId).toBeTruthy();
    expect(Object.keys(result).sort()).toEqual(
      ["batchId", "created", "ignoredLines", "skipped", "unchanged", "updated"]
    );

    // Values and versions
    expect(await varOf("PORT")).toMatchObject({ value: "4000", version: 2, isSensitive: false, updatedById: w.bob.id });
    expect(await varOf("DEBUG")).toMatchObject({ version: 1 }); // unchanged: untouched
    expect(await varOf("NEW_A")).toMatchObject({ value: "1", isSensitive: false });

    // Types: existing sensitive stays sensitive, auto-flagged new key is sensitive
    const db = (await varOf("DB_PASSWORD"))!;
    expect(db.isSensitive).toBe(true);
    expect(db.value).not.toBe(newS);
    expect(await revealVariable(w.alice.id, db.id)).toBe(newS);
    const token = (await varOf("API_TOKEN"))!;
    expect(token).toMatchObject({ isSensitive: true });
    expect(token.iv).not.toBeNull();

    // Exactly one history batch for the import: 2 CREATE + 2 UPDATE
    const all = await history();
    expect(all.length).toBe(baseline + 4);
    const batch = all.filter((h) => h.batchId === result.batchId);
    expect(batch.map((h) => h.action).sort()).toEqual(["CREATE", "CREATE", "UPDATE", "UPDATE"]);
    expect(new Set(batch.map((h) => h.changedById))).toEqual(new Set([w.bob.id]));

    // Nothing in plaintext anywhere
    for (const s of [oldS, newS, tokenS]) expect(await dbHits(s)).toEqual([]);
  });

  it("never deletes keys that are missing from the paste", async () => {
    await makeVar("KEEP_ME", "1");
    await apply(w.alice.id, w.dev.id, "OTHER=2");
    expect(await varOf("KEEP_ME")).not.toBeNull();
    expect(await varOf("OTHER")).not.toBeNull();
  });

  it("duplicate keys in the paste: the last value is applied", async () => {
    await apply(w.alice.id, w.dev.id, "A=1\nA=2");
    expect((await varOf("A"))!.value).toBe("2");
    expect((await history()).filter((h) => h.key === "A")).toHaveLength(1);
  });

  it("applies valid lines and reports how many were ignored", async () => {
    const result = await apply(w.alice.id, w.dev.id, "GOOD=1\nnot valid\n1BAD=x");
    expect(result).toMatchObject({ created: 1, ignoredLines: 2 });
    expect(await varOf("GOOD")).not.toBeNull();
  });
});

describe("import apply: nothing to do", () => {
  it("only-unchanged imports write no row, no version bump, no history, no batch", async () => {
    await makeVar("PORT", "3000");
    await makeVar("TOKEN_X", "CANARY-apply-same-4d4d4d", true);
    const before = await tableCounts();
    const rowsBefore = await prisma.variable.findMany({ orderBy: { key: "asc" } });

    const text = "PORT=3000\nTOKEN_X=CANARY-apply-same-4d4d4d";
    const result = await apply(w.alice.id, w.dev.id, text, {
      expectedVersions: await versionsFor(w.alice.id, w.dev.id, text),
    });

    expect(result).toMatchObject({ created: 0, updated: 0, unchanged: 2, batchId: null });
    expect(await tableCounts()).toEqual(before);
    expect(await prisma.variable.findMany({ orderBy: { key: "asc" } })).toEqual(rowsBefore);
  });
});

describe("import apply: user choices", () => {
  it("skipped rows are not written", async () => {
    await makeVar("PORT", "3000");
    const text = "PORT=4000\nNEW_ONE=1";
    const result = await apply(w.alice.id, w.dev.id, text, {
      expectedVersions: await versionsFor(w.alice.id, w.dev.id, text),
      rowOverrides: { PORT: { skip: true }, NEW_ONE: { skip: true } },
    });
    expect(result).toMatchObject({ created: 0, updated: 0, skipped: 2, batchId: null });
    expect((await varOf("PORT"))!.value).toBe("3000");
    expect(await varOf("NEW_ONE")).toBeNull();
  });

  it("type overrides work on NEW keys but never change an existing key", async () => {
    await makeVar("PORT", "3000"); // Standard
    await makeVar("DB_PASSWORD", "old", true); // Sensitive

    const text = "PORT=4000\nDB_PASSWORD=new\nPLAIN_NEW=1\nAPI_TOKEN=x";
    const result = await apply(w.alice.id, w.dev.id, text, {
      autoFlagSensitive: true,
      expectedVersions: await versionsFor(w.alice.id, w.dev.id, text, true),
      rowOverrides: {
        PORT: { isSensitive: true }, // existing: ignored
        DB_PASSWORD: { isSensitive: false }, // existing: ignored
        PLAIN_NEW: { isSensitive: true }, // new: honoured
        API_TOKEN: { isSensitive: false }, // new, auto-flagged: user unflags
      },
    });
    expect(result).toMatchObject({ created: 2, updated: 2 });
    expect((await varOf("PORT"))!.isSensitive).toBe(false);
    expect((await varOf("DB_PASSWORD"))!.isSensitive).toBe(true);
    expect((await varOf("PLAIN_NEW"))!.isSensitive).toBe(true);
    expect((await varOf("API_TOKEN"))!.isSensitive).toBe(false);
  });

  it("forged overrides and versions for keys that are not in the text have no effect", async () => {
    await makeVar("OTHER", "keep");
    const result = await apply(w.alice.id, w.dev.id, "FRESH=1", {
      rowOverrides: { OTHER: { isSensitive: true, skip: false }, GHOST: { skip: true } },
      expectedVersions: { OTHER: 99, GHOST: 5 },
    });
    expect(result).toMatchObject({ created: 1 });
    expect(await varOf("OTHER")).toMatchObject({ value: "keep", isSensitive: false, version: 1 });
  });
});

describe("import apply: stale and forged versions", () => {
  it("fails when someone edited a variable after the preview, and writes nothing", async () => {
    const id = await makeVar("PORT", "3000");
    const text = "PORT=4000\nBRAND_NEW=1";
    const expectedVersions = await versionsFor(w.alice.id, w.dev.id, text);
    await updateVariable(w.bob.id, id, { value: "5000", version: 1 }); // concurrent edit

    const before = await tableCounts();
    expect(await statusOf(apply(w.alice.id, w.dev.id, text, { expectedVersions }))).toBe(409);
    expect(await tableCounts()).toEqual(before);
    expect(await varOf("BRAND_NEW")).toBeNull();
    expect((await varOf("PORT"))!.value).toBe("5000");
  });

  it("fails when a previewed variable was deleted before applying", async () => {
    const id = await makeVar("PORT", "3000");
    const text = "PORT=4000";
    const expectedVersions = await versionsFor(w.alice.id, w.dev.id, text);
    await deleteVariable(w.bob.id, id);
    expect(await statusOf(apply(w.alice.id, w.dev.id, text, { expectedVersions }))).toBe(409);
    expect(await varOf("PORT")).toBeNull();
  });

  it("fails when a key previewed as NEW was created before applying", async () => {
    const text = "FRESH=1";
    const expectedVersions = await versionsFor(w.alice.id, w.dev.id, text);
    await makeVar("FRESH", "someone-elses");
    expect(await statusOf(apply(w.alice.id, w.dev.id, text, { expectedVersions }))).toBe(409);
    expect((await varOf("FRESH"))!.value).toBe("someone-elses");
  });

  it("an UPDATE row without a version, or with a wrong one, is rejected", async () => {
    await makeVar("PORT", "3000");
    expect(await statusOf(apply(w.alice.id, w.dev.id, "PORT=4000"))).toBe(409);
    expect(await statusOf(apply(w.alice.id, w.dev.id, "PORT=4000", { expectedVersions: { PORT: 7 } }))).toBe(409);
    expect((await varOf("PORT"))!.value).toBe("3000");
  });

  it("a failure on a later row rolls back the earlier rows", async () => {
    await makeVar("LAST", "old");
    const before = await tableCounts();
    // First two are NEW; the third is an UPDATE with a forged version
    const result = apply(w.alice.id, w.dev.id, "A=1\nB=2\nLAST=new", { expectedVersions: { LAST: 42 } });
    expect(await statusOf(result)).toBe(409);
    expect(await varOf("A")).toBeNull();
    expect(await varOf("B")).toBeNull();
    expect(await tableCounts()).toEqual(before);
  });

    it("two simultaneous applies of the same import never duplicate anything", async () => {
    const run = () => apply(w.alice.id, w.dev.id, "RACE_A=1\nRACE_B=2");
    const settled = await Promise.allSettled([run(), run()]);

    // The loser either saw the rows as UNCHANGED (ok) or hit a conflict (409). Nothing else is acceptable.
    let created = 0;
    for (const s of settled) {
      if (s.status === "fulfilled") created += s.value.created;
      else expect((s.reason as { status?: number }).status).toBe(409);
    }
    expect(created).toBe(2); // each row was created exactly once, by exactly one apply

    expect(await prisma.variable.count({ where: { key: { in: ["RACE_A", "RACE_B"] } } })).toBe(2);
    expect((await history()).filter((h) => h.key.startsWith("RACE_"))).toHaveLength(2);
  });
});

describe("import apply: atomicity and key problems", () => {
  it("writes nothing when the history insert fails", async () => {
    await makeVar("PORT", "3000");
    const text = "PORT=4000\nNEW_ONE=1";
    const expectedVersions = await versionsFor(w.alice.id, w.dev.id, text);
    const before = await tableCounts();
    await blockInserts("HistoryEntry");
    try {
      expect(await statusOf(apply(w.alice.id, w.dev.id, text, { expectedVersions }))).not.toBe("ok");
    } finally {
      await unblockInserts("HistoryEntry");
    }
    expect(await tableCounts()).toEqual(before);
    expect((await varOf("PORT"))!.value).toBe("3000");
    expect(await varOf("NEW_ONE")).toBeNull();
  });

  it("a missing ENCRYPTION_KEY rolls back the whole import, including Standard rows", async () => {
    const before = await tableCounts();
    vi.stubEnv("ENCRYPTION_KEY", "");
    const status = await statusOf(
      apply(w.alice.id, w.dev.id, "PLAIN_ONE=1\nAPI_TOKEN=CANARY-apply-nokey-5e5e5e", { autoFlagSensitive: true })
    );
    expect(status).not.toBe("ok");
    vi.unstubAllEnvs();
    expect(await varOf("PLAIN_ONE")).toBeNull();
    expect(await tableCounts()).toEqual(before);
    expect(await dbHits("CANARY-apply-nokey-5e5e5e")).toEqual([]);
  });

  it("a wrong ENCRYPTION_KEY fails safely when Sensitive variables exist", async () => {
    await makeVar("SECRET_ONE", "CANARY-apply-wrongkey-6f6f6f", true);
    const before = await tableCounts();
    vi.stubEnv("ENCRYPTION_KEY", "d4".repeat(32));
    expect(await statusOf(apply(w.alice.id, w.dev.id, "NEW_ONE=1"))).not.toBe("ok");
    vi.unstubAllEnvs();
    expect(await tableCounts()).toEqual(before);
  });
});

describe("import apply: access control", () => {
  it("a non-member gets 404, for a real environment and for tampered ids, and writes nothing", async () => {
    const malloryEnv = await prisma.environment.findFirstOrThrow({
      where: { project: { ownerId: w.mallory.id } },
    });
    const before = await tableCounts();
    expect(await statusOf(apply(w.mallory.id, w.dev.id, "X=1"))).toBe(404);
    expect(await statusOf(apply(w.alice.id, malloryEnv.id, "X=1"))).toBe(404);
    expect(await statusOf(apply(w.alice.id, "does-not-exist", "X=1"))).toBe(404);
    expect(await tableCounts()).toEqual(before);
  });

  it("any project member can apply, and the change is attributed to them", async () => {
    await apply(w.bob.id, w.dev.id, "BY_BOB=1");
    expect(await varOf("BY_BOB")).toMatchObject({ updatedById: w.bob.id });
    expect((await history()).at(-1)).toMatchObject({ key: "BY_BOB", changedById: w.bob.id });
  });
});

describe("import apply: input guards", () => {
  it("rejects the masked placeholder in apply and in preview", async () => {
    await makeVar("TOKEN_X", "CANARY-apply-mask-7a7a7a", true);
    const before = await tableCounts();
    const text = `TOKEN_X=${MASK}`;
    expect(await statusOf(apply(w.alice.id, w.dev.id, text))).toBe(400);
    expect(await statusOf(previewImport(w.alice.id, w.dev.id, { text, autoFlagSensitive: false }))).toBe(400);
    expect(await tableCounts()).toEqual(before);
    expect(await revealVariable(w.alice.id, (await varOf("TOKEN_X"))!.id)).toBe("CANARY-apply-mask-7a7a7a");
  });

  it("enforces the same size and entry limits as preview, and writes nothing", async () => {
    const before = await tableCounts();
    const tooMany = Array.from({ length: MAX_IMPORT_ENTRIES + 1 }, (_, i) => `K${i}=1`).join("\n");
    expect(await statusOf(apply(w.alice.id, w.dev.id, tooMany))).toBe(400);
    expect(await statusOf(apply(w.alice.id, w.dev.id, "A=1\n".repeat(30000)))).toBe(400);
    expect(await tableCounts()).toEqual(before);
  });

  it("the request schema validates shapes and caps the maps", () => {
    const ok = applyImportSchema.safeParse({ text: "A=1" });
    expect(ok.success).toBe(true);
    if (ok.success) {
      expect(ok.data.rowOverrides).toEqual({});
      expect(ok.data.expectedVersions).toEqual({});
      expect(ok.data.autoFlagSensitive).toBe(false);
    }
    expect(applyImportSchema.safeParse({ text: "" }).success).toBe(false);
    expect(applyImportSchema.safeParse({ text: "A=1", expectedVersions: { A: "1" } }).success).toBe(false);
    expect(applyImportSchema.safeParse({ text: "A=1", expectedVersions: { A: 0 } }).success).toBe(false);
    expect(applyImportSchema.safeParse({ text: "A=1", rowOverrides: { A: { skip: "yes" } } }).success).toBe(false);
    const huge = Object.fromEntries(Array.from({ length: MAX_IMPORT_ENTRIES + 1 }, (_, i) => [`K${i}`, 1]));
    expect(applyImportSchema.safeParse({ text: "A=1", expectedVersions: huge }).success).toBe(false);
  });
});