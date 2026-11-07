import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import { MASK } from "@/lib/mask";
import { listHistory, revealHistoryValue } from "@/lib/historyRead";
import { revealVariable } from "@/lib/reveal";
import { createVariableSchema, updateVariableSchema } from "@/lib/validation";
import { createVariable, deleteVariable, listVariables, updateVariable } from "@/lib/variables";
import {
  blockInserts,
  dbHits,
  flip,
  resetDb,
  seedWorld,
  statusOf,
  unblockInserts,
  type World,
} from "./helpers";

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

async function makeVar(key: string, value: string, sensitive: boolean, envId = w.dev.id) {
  const { id } = await createVariable(w.alice.id, envId, key, value, sensitive);
  return id;
}
const row = (id: string) => prisma.variable.findUniqueOrThrow({ where: { id } });
const historyOf = (envId = w.dev.id) =>
  prisma.historyEntry.findMany({ where: { environmentId: envId }, orderBy: { changedAt: "asc" } });

describe("encryption at rest", () => {
  it("stores sensitive values as ciphertext in Variable and HistoryEntry", async () => {
    const secret = "CANARY-at-rest-a1b2c3";
    const id = await makeVar("API_TOKEN", secret, true);
    const v = await row(id);
    expect(v.isSensitive).toBe(true);
    expect(v.value).not.toContain(secret);
    expect(v.iv).not.toBeNull();
    expect(v.authTag).not.toBeNull();

    const h = await historyOf();
    expect(h).toHaveLength(1);
    expect(h[0].newValue).not.toBe(secret);
    expect(h[0].newIv).not.toBeNull();
    expect(await dbHits(secret)).toEqual([]);
  });

  it("leaves no plaintext anywhere in the database after create, edit, rename, toggle and delete", async () => {
    const [s1, s2, s3, s4] = ["CANARY-one-91ac", "CANARY-two-5d62", "CANARY-three-c441", "CANARY-four-77be"];

    // Sensitive from the start
    const id1 = await makeVar("A_SECRET", s1, true);
    await updateVariable(w.alice.id, id1, { value: s2, version: 1 });
    await updateVariable(w.alice.id, id1, { key: "A_RENAMED", version: 2 });
    await deleteVariable(w.alice.id, id1);

    // Standard first, edited and renamed twice, then made Sensitive (the re-encryption trap)
    const id2 = await makeVar("LEGACY", s3, false);
    await updateVariable(w.alice.id, id2, { value: s4, version: 1 });
    await updateVariable(w.alice.id, id2, { key: "LEGACY_B", version: 2 });
    await updateVariable(w.alice.id, id2, { key: "LEGACY_C", version: 3 });
    await updateVariable(w.alice.id, id2, { isSensitive: true, version: 4 });

    for (const s of [s1, s2, s3, s4]) {
      expect(await dbHits(s), `plaintext "${s}" found in the database`).toEqual([]);
    }
  });

  it("uses a fresh IV for every encryption", async () => {
    const a = await row(await makeVar("A", "CANARY-same-value-xyz", true));
    const b = await row(await makeVar("B", "CANARY-same-value-xyz", true));
    expect(a.iv).not.toBe(b.iv);
    expect(a.value).not.toBe(b.value);
  });
});

describe("output masking", () => {
  it("listVariables never returns plaintext or ciphertext for sensitive rows", async () => {
    const secret = "CANARY-mask-list-9f8e7d";
    const id = await makeVar("MASKED", secret, true);
    const raw = await row(id);
    const json = JSON.stringify(await listVariables(w.alice.id, w.dev.id));
    expect(json).toContain(MASK);
    for (const leak of [secret, raw.value, raw.iv!, raw.authTag!]) {
      expect(json).not.toContain(leak);
    }
  });

  it("listHistory never returns plaintext or ciphertext for encrypted values", async () => {
    const id = await makeVar("H_KEY", "CANARY-hist-old-1a2b3c", true);
    await updateVariable(w.alice.id, id, { value: "CANARY-hist-new-4d5e6f", version: 1 });
    const raw = await historyOf();
    const json = JSON.stringify(await listHistory(w.alice.id, w.dev.id, {}));
    const leaks = ["CANARY-hist-old-1a2b3c", "CANARY-hist-new-4d5e6f"];
    for (const r of raw) {
      for (const f of [r.oldValue, r.oldIv, r.oldAuthTag, r.newValue, r.newIv, r.newAuthTag]) {
        if (f) leaks.push(f);
      }
    }
    for (const leak of leaks) expect(json).not.toContain(leak);
  });
});

describe("access control", () => {
  it("a non-member gets 404 from every variable and history function, and changes nothing", async () => {
    const secret = "CANARY-access-aa11bb22";
    const id = await makeVar("PRIVATE", secret, true);
    await updateVariable(w.alice.id, id, { value: "CANARY-access-cc33dd44", version: 1 });
    const entry = (await historyOf())[0];
    const before = await row(id);
    const historyCount = (await historyOf()).length;
    const m = w.mallory.id;

    expect(await statusOf(listVariables(m, w.dev.id))).toBe(404);
    expect(await statusOf(createVariable(m, w.dev.id, "X", "1"))).toBe(404);
    expect(await statusOf(updateVariable(m, id, { value: "hacked", version: before.version }))).toBe(404);
    expect(await statusOf(deleteVariable(m, id))).toBe(404);
    expect(await statusOf(revealVariable(m, id))).toBe(404);
    expect(await statusOf(listHistory(m, w.dev.id, {}))).toBe(404);
    expect(await statusOf(revealHistoryValue(m, entry.id, "new"))).toBe(404);

    const after = await row(id);
    expect(after.value).toBe(before.value);
    expect(after.version).toBe(before.version);
    expect(await prisma.variable.count()).toBe(1);
    expect((await historyOf()).length).toBe(historyCount);
    expect(await prisma.revealLog.count()).toBe(0);
  });

  it("unknown ids return 404 for members too", async () => {
    expect(await statusOf(revealVariable(w.alice.id, "does-not-exist"))).toBe(404);
    expect(await statusOf(revealHistoryValue(w.alice.id, "does-not-exist", "old"))).toBe(404);
  });

  it("any project member can list and reveal", async () => {
    const secret = "CANARY-member-ee55ff66";
    const id = await makeVar("SHARED", secret, true);
    expect((await listVariables(w.bob.id, w.dev.id)).length).toBe(1);
    expect(await revealVariable(w.bob.id, id)).toBe(secret);
  });
});

describe("reveal and audit", () => {
  it("returns the exact plaintext and writes one audit row per reveal, never the value", async () => {
    const secret = "CANARY-audit-0a1b2c3d";
    const id = await makeVar("AUDITED", secret, true);
    expect(await revealVariable(w.bob.id, id)).toBe(secret);
    expect(await revealVariable(w.alice.id, id)).toBe(secret);

    const logs = await prisma.revealLog.findMany({ orderBy: { revealedAt: "asc" } });
    expect(logs).toHaveLength(2);
    expect(logs[0]).toMatchObject({
      userId: w.bob.id,
      key: "AUDITED",
      source: "VARIABLE",
      environmentId: w.dev.id,
    });
    expect(await dbHits(secret)).toEqual([]);
  });

  it("refuses to reveal a Standard variable", async () => {
    const id = await makeVar("PLAIN", "3000", false);
    expect(await statusOf(revealVariable(w.alice.id, id))).toBe(400);
    expect(await prisma.revealLog.count()).toBe(0);
  });

  it("reveals old and new history values with their own audit rows", async () => {
    const id = await makeVar("HIST", "CANARY-rev-old-7a7a7a", true);
    await updateVariable(w.alice.id, id, { value: "CANARY-rev-new-8b8b8b", version: 1 });
    const update = (await historyOf()).find((h) => h.action === "UPDATE")!;
    expect(await revealHistoryValue(w.bob.id, update.id, "old")).toBe("CANARY-rev-old-7a7a7a");
    expect(await revealHistoryValue(w.bob.id, update.id, "new")).toBe("CANARY-rev-new-8b8b8b");
    const logs = await prisma.revealLog.findMany();
    expect(logs).toHaveLength(2);
    expect(logs.every((l) => l.source === "HISTORY")).toBe(true);
  });

  it("refuses to reveal a history value that is not encrypted", async () => {
    await makeVar("PLAIN_H", "3000", false);
    const create = (await historyOf())[0];
    expect(await statusOf(revealHistoryValue(w.alice.id, create.id, "new"))).toBe(400);
    expect(await statusOf(revealHistoryValue(w.alice.id, create.id, "old"))).toBe(400);
  });

  it("fails closed: no value is returned when the audit row cannot be written", async () => {
    const secret = "CANARY-closed-5e5e5e5e";
    const id = await makeVar("CLOSED", secret, true);
    await blockInserts("RevealLog");
    try {
      expect(await statusOf(revealVariable(w.alice.id, id))).not.toBe("ok");
    } finally {
      await unblockInserts("RevealLog");
    }
    expect(await prisma.revealLog.count()).toBe(0);
    expect(await revealVariable(w.alice.id, id)).toBe(secret); // works again once logging works
  });

  it("history reveal also fails closed", async () => {
    const id = await makeVar("CLOSED_H", "CANARY-closed-h-6f6f6f6f", true);
    await updateVariable(w.alice.id, id, { value: "CANARY-closed-h-7a7a7a7a", version: 1 });
    const update = (await historyOf()).find((h) => h.action === "UPDATE")!;
    await blockInserts("RevealLog");
    try {
      expect(await statusOf(revealHistoryValue(w.alice.id, update.id, "new"))).not.toBe("ok");
    } finally {
      await unblockInserts("RevealLog");
    }
    expect(await prisma.revealLog.count()).toBe(0);
  });
});

describe("atomicity: the change and its history succeed or fail together", () => {
  it("create writes nothing when the history insert fails", async () => {
    await blockInserts("HistoryEntry");
    try {
      expect(await statusOf(createVariable(w.alice.id, w.dev.id, "ATOMIC", "1"))).not.toBe("ok");
    } finally {
      await unblockInserts("HistoryEntry");
    }
    expect(await prisma.variable.count()).toBe(0);
  });

  it("update and type toggle change nothing when the history insert fails", async () => {
    const id = await makeVar("ATOMIC_U", "original", false);
    const before = await row(id);
    await blockInserts("HistoryEntry");
    try {
      expect(await statusOf(updateVariable(w.alice.id, id, { value: "changed", version: 1 }))).not.toBe("ok");
      expect(await statusOf(updateVariable(w.alice.id, id, { isSensitive: true, version: 1 }))).not.toBe("ok");
    } finally {
      await unblockInserts("HistoryEntry");
    }
    const after = await row(id);
    expect(after.value).toBe(before.value);
    expect(after.version).toBe(before.version);
    expect(after.isSensitive).toBe(false);
  });

  it("delete removes nothing when the history insert fails", async () => {
    const id = await makeVar("ATOMIC_D", "keep-me", false);
    await blockInserts("HistoryEntry");
    try {
      expect(await statusOf(deleteVariable(w.alice.id, id))).not.toBe("ok");
    } finally {
      await unblockInserts("HistoryEntry");
    }
    expect(await prisma.variable.count()).toBe(1);
  });
});

describe("tampering and key problems", () => {
  it("a tampered variable fails to reveal, is not audited, and does not break listing", async () => {
    const id = await makeVar("TAMPER", "CANARY-tamper-1a1a1a1a", true);
    const v = await row(id);
    await prisma.variable.update({ where: { id }, data: { value: flip(v.value) } });
    expect(await statusOf(revealVariable(w.alice.id, id))).toBe(500);
    expect(await prisma.revealLog.count()).toBe(0);
    expect((await listVariables(w.alice.id, w.dev.id)).length).toBe(1);
  });

  it("a tampered history value fails to reveal and is not audited", async () => {
    const id = await makeVar("TAMPER_H", "CANARY-tamper-h-2b2b2b2b", true);
    await updateVariable(w.alice.id, id, { value: "CANARY-tamper-h-3c3c3c3c", version: 1 });
    const update = (await historyOf()).find((h) => h.action === "UPDATE")!;
    await prisma.historyEntry.update({
      where: { id: update.id },
      data: { newValue: flip(update.newValue!) },
    });
    expect(await statusOf(revealHistoryValue(w.alice.id, update.id, "new"))).toBe(500);
    expect(await prisma.revealLog.count()).toBe(0);
    expect((await listHistory(w.alice.id, w.dev.id, {})).items.length).toBeGreaterThan(0);
  });

  it("a wrong ENCRYPTION_KEY fails safely, listing still works, and the real key recovers", async () => {
    const secret = "CANARY-wrongkey-4d4d4d4d";
    const id = await makeVar("KEYED", secret, true);
    vi.stubEnv("ENCRYPTION_KEY", "d4".repeat(32));
    expect(await statusOf(revealVariable(w.alice.id, id))).not.toBe("ok");
    expect((await listVariables(w.alice.id, w.dev.id)).length).toBe(1);
    vi.unstubAllEnvs();
    expect(await revealVariable(w.alice.id, id)).toBe(secret);
  });

  it("a missing ENCRYPTION_KEY blocks sensitive writes without leaving partial rows", async () => {
    vi.stubEnv("ENCRYPTION_KEY", "");
    expect(await statusOf(createVariable(w.alice.id, w.dev.id, "NOKEY", "CANARY-nokey-5e5e", true))).not.toBe("ok");
    expect(await prisma.variable.count()).toBe(0);
    expect(await dbHits("CANARY-nokey-5e5e")).toEqual([]);
    // Standard variables never need the key
    expect(await statusOf(createVariable(w.alice.id, w.dev.id, "PLAIN_OK", "1", false))).toBe("ok");
  });
});

describe("type toggle and history semantics", () => {
  it("logs both directions with no values, and keeps older history encrypted after downgrading", async () => {
    const secret = "CANARY-toggle-6f6f6f6f";
    const id = await makeVar("TOGGLE", secret, true);
    await updateVariable(w.alice.id, id, { isSensitive: false, version: 1 }); // value omitted: converts in place
    const v = await row(id);
    expect(v.isSensitive).toBe(false);
    expect(v.value).toBe(secret);
    expect(v.iv).toBeNull();

    await updateVariable(w.alice.id, id, { isSensitive: true, version: 2 });

    const h = await historyOf();
    const changes = h.filter((r) => r.action === "TYPE_CHANGE");
    expect(changes).toHaveLength(2);
    for (const c of changes) {
      expect(c.oldValue).toBeNull();
      expect(c.newValue).toBeNull();
    }
    expect(changes[0]).toMatchObject({ oldIsSensitive: true, newIsSensitive: false });
    expect(changes[1]).toMatchObject({ oldIsSensitive: false, newIsSensitive: true });
    // Every history row that stores a value stores it encrypted
    for (const r of h) {
      if (r.oldValue !== null) expect(r.oldIv).not.toBeNull();
      if (r.newValue !== null) expect(r.newIv).not.toBeNull();
    }
    expect(await dbHits(secret).then((x) => x.filter((p) => p.startsWith("HistoryEntry")))).toEqual([]);
  });

  it("a combined type and value change shares one batch and leaks nothing", async () => {
    const id = await makeVar("COMBO", "CANARY-combo-old-1a1a", false);
    await updateVariable(w.alice.id, id, { isSensitive: true, value: "CANARY-combo-new-2b2b", version: 1 });
    const h = (await historyOf()).filter((r) => r.action !== "CREATE");
    expect(h.map((r) => r.action).sort()).toEqual(["TYPE_CHANGE", "UPDATE"]);
    expect(new Set(h.map((r) => r.batchId)).size).toBe(1);
    expect(await dbHits("CANARY-combo-old-1a1a")).toEqual([]);
    expect(await dbHits("CANARY-combo-new-2b2b")).toEqual([]);
  });

  it("a no-op update changes no version and writes no history", async () => {
    const secret = "CANARY-noop-3c3c3c3c";
    const id = await makeVar("NOOP", secret, true);
    const count = (await historyOf()).length;
    const same = await updateVariable(w.alice.id, id, { value: secret, version: 1 });
    expect(same.version).toBe(1);
    const same2 = await updateVariable(w.alice.id, id, { isSensitive: true, version: 1 });
    expect(same2.version).toBe(1);
    expect((await historyOf()).length).toBe(count);
  });

  it("renaming a sensitive variable does not re-encrypt it and logs no values", async () => {
    const id = await makeVar("BEFORE_NAME", "CANARY-rename-4d4d4d4d", true);
    const before = await row(id);
    await updateVariable(w.alice.id, id, { key: "AFTER_NAME", version: 1 });
    const after = await row(id);
    expect(after.value).toBe(before.value);
    expect(after.iv).toBe(before.iv);
    const rename = (await historyOf()).find((r) => r.action === "UPDATE")!;
    expect(rename).toMatchObject({ key: "AFTER_NAME", oldKey: "BEFORE_NAME", oldValue: null, newValue: null });
  });

  it("a stale version returns 409 and writes no history", async () => {
    const id = await makeVar("STALE", "1", false);
    await updateVariable(w.alice.id, id, { value: "2", version: 1 });
    const count = (await historyOf()).length;
    expect(await statusOf(updateVariable(w.bob.id, id, { value: "3", version: 1 }))).toBe(409);
    expect((await historyOf()).length).toBe(count);
  });

  it("a duplicate key returns 409 and writes no history", async () => {
    await makeVar("DUP", "1", false);
    const count = (await historyOf()).length;
    expect(await statusOf(createVariable(w.alice.id, w.dev.id, "DUP", "2", true))).toBe(409);
    expect((await historyOf()).length).toBe(count);
  });

  it("history survives deletion and encrypted values stay revealable", async () => {
    const secret = "CANARY-delete-5e5e5e5e";
    const id = await makeVar("GONE", secret, true);
    await deleteVariable(w.alice.id, id);
    expect(await prisma.variable.count()).toBe(0);
    const h = await historyOf();
    const del = h.find((r) => r.action === "DELETE")!;
    expect(h.some((r) => r.action === "CREATE")).toBe(true);
    expect(del.oldIv).not.toBeNull();
    expect(await revealHistoryValue(w.bob.id, del.id, "old")).toBe(secret);
  });

  it("a cursor from another environment is rejected", async () => {
    await makeVar("IN_DEV", "1", false);
    const devEntry = (await historyOf())[0];
    expect(await statusOf(listHistory(w.alice.id, w.staging.id, { cursor: devEntry.id }))).toBe(400);
  });
});

describe("validation guards", () => {
  it("rejects the mask placeholder as a value", () => {
    expect(createVariableSchema.safeParse({ key: "A", value: MASK }).success).toBe(false);
    expect(updateVariableSchema.safeParse({ value: MASK, version: 1 }).success).toBe(false);
  });

  it("allows updating a sensitive variable without sending a value", () => {
    expect(updateVariableSchema.safeParse({ key: "RENAMED", version: 1 }).success).toBe(true);
    expect(updateVariableSchema.safeParse({ isSensitive: true, version: 1 }).success).toBe(true);
  });
});