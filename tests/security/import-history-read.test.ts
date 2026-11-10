import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { MASK } from "@/lib/mask";
import { listHistory, revealHistoryValue } from "@/lib/historyRead";
import { applyImport, previewImport } from "@/lib/importPlan";
import { createVariable } from "@/lib/variables";
import { resetDb, seedWorld, statusOf, type World } from "./helpers";

const OLD_S = "CANARY-hr-old-1a1a1a";
const NEW_S = "CANARY-hr-new-2b2b2b";
const TOKEN_S = "CANARY-hr-token-3c3c3c";

let w: World;

beforeEach(async () => {
  await resetDb();
  w = await seedWorld();
});
afterAll(async () => {
  await prisma.$disconnect();
});

// Bob imports into an environment that already has a Standard and a Sensitive variable
async function setup() {
  await createVariable(w.alice.id, w.dev.id, "PORT", "3000", false);
  await createVariable(w.alice.id, w.dev.id, "DB_PASSWORD", OLD_S, true);

  const text = `PORT=4000\nDB_PASSWORD=${NEW_S}\nAPI_TOKEN=${TOKEN_S}\nNEW_PLAIN=hello`;
  const preview = await previewImport(w.bob.id, w.dev.id, { text, autoFlagSensitive: true });
  const expectedVersions = Object.fromEntries(
    preview.rows.flatMap((r) => (r.version === null ? [] : [[r.key, r.version] as const]))
  );
  const result = await applyImport(w.bob.id, w.dev.id, {
    text,
    autoFlagSensitive: true,
    rowOverrides: {},
    expectedVersions,
  });

  const { items } = await listHistory(w.alice.id, w.dev.id, { limit: 100 });
  const batch = items.filter((i) => i.batchId === result.batchId);
  const by = (key: string) => batch.find((i) => i.key === key)!;
  return { result, items, batch, by };
}

describe("import history: what the history page receives", () => {
  it("shows an import as one contiguous batch by one author", async () => {
    const { result, items, batch } = await setup();
    expect(result.batchId).toBeTruthy();
    expect(batch).toHaveLength(4);

    // The timeline groups consecutive rows with the same batchId, so the batch must be contiguous
    const positions = items.map((i, n) => (i.batchId === result.batchId ? n : -1)).filter((n) => n >= 0);
    expect(positions[positions.length - 1] - positions[0] + 1).toBe(4);

    expect(new Set(batch.map((i) => i.changedByName))).toEqual(new Set(["bob"]));
    expect(batch.map((i) => i.action).sort()).toEqual(["CREATE", "CREATE", "UPDATE", "UPDATE"]);
  });

  it("masks Sensitive values, shows Standard ones, and leaks no plaintext or ciphertext", async () => {
    const { items, by } = await setup();

    expect(by("API_TOKEN").new).toMatchObject({ masked: true, value: MASK });
    expect(by("DB_PASSWORD").old).toMatchObject({ masked: true, value: MASK });
    expect(by("DB_PASSWORD").new).toMatchObject({ masked: true, value: MASK });
    expect(by("PORT").old).toMatchObject({ masked: false, value: "3000" });
    expect(by("PORT").new).toMatchObject({ masked: false, value: "4000" });
    expect(by("NEW_PLAIN").new).toMatchObject({ masked: false, value: "hello" });

    const raw = await prisma.historyEntry.findMany();
    const json = JSON.stringify(items);
    for (const secret of [OLD_S, NEW_S, TOKEN_S]) expect(json).not.toContain(secret);
    for (const r of raw) {
      for (const stored of [r.oldValue, r.newValue, r.oldIv, r.newIv, r.oldAuthTag, r.newAuthTag]) {
        if (stored && (r.oldIv || r.newIv)) expect(json).not.toContain(stored);
      }
    }
  });
});

describe("import history: revealing imported values", () => {
  it("reveals the exact old and new values and writes one audit row per reveal, never the value", async () => {
    const { by } = await setup();
    const before = await prisma.revealLog.count();

    expect(await revealHistoryValue(w.alice.id, by("API_TOKEN").id, "new")).toBe(TOKEN_S);
    expect(await revealHistoryValue(w.alice.id, by("DB_PASSWORD").id, "old")).toBe(OLD_S);
    expect(await revealHistoryValue(w.alice.id, by("DB_PASSWORD").id, "new")).toBe(NEW_S);

    expect(await prisma.revealLog.count()).toBe(before + 3);
    const logs = await prisma.revealLog.findMany({ where: { source: "HISTORY" } });
    expect(logs.map((l) => l.key).sort()).toEqual(["API_TOKEN", "DB_PASSWORD", "DB_PASSWORD"]);
    const logJson = JSON.stringify(logs);
    for (const secret of [OLD_S, NEW_S, TOKEN_S]) expect(logJson).not.toContain(secret);
  });

  it("refuses to reveal Standard values and missing sides, without auditing", async () => {
    const { by } = await setup();
    const before = await prisma.revealLog.count();

    expect(await statusOf(revealHistoryValue(w.alice.id, by("PORT").id, "new"))).toBe(400);
    expect(await statusOf(revealHistoryValue(w.alice.id, by("API_TOKEN").id, "old"))).toBe(400); // CREATE has no old value

    expect(await prisma.revealLog.count()).toBe(before);
  });

  it("a non-member can neither list nor reveal an import batch", async () => {
    const { by } = await setup();
    const before = await prisma.revealLog.count();

    expect(await statusOf(listHistory(w.mallory.id, w.dev.id, {}))).toBe(404);
    expect(await statusOf(revealHistoryValue(w.mallory.id, by("API_TOKEN").id, "new"))).toBe(404);

    expect(await prisma.revealLog.count()).toBe(before);
  });
});