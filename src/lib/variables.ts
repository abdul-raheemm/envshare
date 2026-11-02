import { prisma } from "@/lib/db";
import { requireEnvironmentAccess, requireVariableAccess } from "@/lib/access";
import { ApiError, isUniqueViolation } from "@/lib/errors";
import { newBatchId, writeHistory, type Tx } from "@/lib/history";

const KEY_EXISTS = "This key already exists";
const CONFLICT = "This variable was changed by someone else. Reload and try again";

type Ctx = { userId: string; batchId: string };
type CurrentVariable = Awaited<ReturnType<typeof requireVariableAccess>>;

function mapWriteError(e: unknown): never {
  if (e instanceof ApiError) throw e;
  if (isUniqueViolation(e)) throw new ApiError(409, KEY_EXISTS, { key: KEY_EXISTS });
  throw e;
}

export async function listVariables(userId: string, environmentId: string) {
  await requireEnvironmentAccess(userId, environmentId);

  const rows = await prisma.variable.findMany({
    where: { environmentId },
    orderBy: { key: "asc" },
    select: {
      id: true,
      key: true,
      value: true,
      version: true,
      updatedBy: { select: { name: true } },
    },
  });

  return rows.map((r) => ({
    id: r.id,
    key: r.key,
    value: r.value,
    version: r.version,
    updatedByName: r.updatedBy.name,
  }));
}

// ---- Transaction-level helpers (Phase 3 import will reuse these with one shared batchId) ----

export async function applyCreate(
  tx: Tx,
  ctx: Ctx,
  environmentId: string,
  key: string,
  value: string
) {
  const existing = await tx.variable.findUnique({
    where: { environmentId_key: { environmentId, key } },
    select: { id: true },
  });
  if (existing) throw new ApiError(409, KEY_EXISTS, { key: KEY_EXISTS });

  const created = await tx.variable.create({
    data: { environmentId, key, value, updatedById: ctx.userId },
    select: { id: true },
  });

  await writeHistory(tx, {
    environmentId,
    batchId: ctx.batchId,
    action: "CREATE",
    key,
    new: { value, iv: null, authTag: null },
    newIsSensitive: false,
    changedById: ctx.userId,
  });

  return created;
}

export async function applyUpdate(
  tx: Tx,
  ctx: Ctx,
  current: CurrentVariable,
  input: { key?: string; value?: string; version: number }
) {
  const newKey = input.key ?? current.key;
  const newValue = input.value ?? current.value;
  const keyChanged = newKey !== current.key;
  const valueChanged = newValue !== current.value;

  // Nothing actually changed: no version bump, no history row
  if (!keyChanged && !valueChanged) {
    return { id: current.id, version: current.version };
  }

  // Atomic: only updates if the version is STILL the one the editor saw
  const result = await tx.variable.updateMany({
    where: { id: current.id, version: input.version },
    data: {
      key: newKey,
      value: newValue,
      version: { increment: 1 },
      updatedById: ctx.userId,
    },
  });
  if (result.count === 0) throw new ApiError(409, CONFLICT);

  await writeHistory(tx, {
    environmentId: current.environmentId,
    batchId: ctx.batchId,
    action: "UPDATE",
    key: newKey,
    oldKey: keyChanged ? current.key : null,
    old: valueChanged ? { value: current.value, iv: null, authTag: null } : null,
    new: valueChanged ? { value: newValue, iv: null, authTag: null } : null,
    oldIsSensitive: false,
    newIsSensitive: false,
    changedById: ctx.userId,
  });

  return { id: current.id, version: input.version + 1 };
}

export async function applyDelete(tx: Tx, ctx: Ctx, variableId: string) {
  const row = await tx.variable.findUnique({
    where: { id: variableId },
    select: { key: true, value: true, environmentId: true },
  });
  if (!row) return; // someone else already deleted it

  const result = await tx.variable.deleteMany({ where: { id: variableId } });
  if (result.count === 0) return;

  await writeHistory(tx, {
    environmentId: row.environmentId,
    batchId: ctx.batchId,
    action: "DELETE",
    key: row.key,
    old: { value: row.value, iv: null, authTag: null },
    oldIsSensitive: false,
    changedById: ctx.userId,
  });
}

// ---- Public service functions (routes call these) ----

export async function createVariable(
  userId: string,
  environmentId: string,
  key: string,
  value: string
) {
  await requireEnvironmentAccess(userId, environmentId);
  try {
    return await prisma.$transaction((tx) =>
      applyCreate(tx, { userId, batchId: newBatchId() }, environmentId, key, value)
    );
  } catch (e) {
    mapWriteError(e);
  }
}

export async function updateVariable(
  userId: string,
  variableId: string,
  input: { key?: string; value?: string; version: number }
) {
  const current = await requireVariableAccess(userId, variableId);

  // Quick check: the editor was looking at an older version
  if (current.version !== input.version) throw new ApiError(409, CONFLICT);

  try {
    return await prisma.$transaction((tx) =>
      applyUpdate(tx, { userId, batchId: newBatchId() }, current, input)
    );
  } catch (e) {
    mapWriteError(e);
  }
}

export async function deleteVariable(userId: string, variableId: string) {
  await requireVariableAccess(userId, variableId);
  await prisma.$transaction((tx) =>
    applyDelete(tx, { userId, batchId: newBatchId() }, variableId)
  );
}