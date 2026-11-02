import { prisma } from "@/lib/db";
import { requireEnvironmentAccess, requireVariableAccess } from "@/lib/access";
import { decrypt, encrypt } from "@/lib/crypto";
import { ApiError, isUniqueViolation } from "@/lib/errors";
import {
  encryptPlainHistoryForKey,
  newBatchId,
  writeHistory,
  type StoredValue,
  type Tx,
} from "@/lib/history";
import { toVariableDTO } from "@/lib/variableDto";

const KEY_EXISTS = "This key already exists";
const CONFLICT = "This variable was changed by someone else. Reload and try again";

type Ctx = { userId: string; batchId: string };
type CurrentVariable = Awaited<ReturnType<typeof requireVariableAccess>>;

function mapWriteError(e: unknown): never {
  if (e instanceof ApiError) throw e;
  if (isUniqueViolation(e)) throw new ApiError(409, KEY_EXISTS, { key: KEY_EXISTS });
  throw e;
}

function decryptStored(s: StoredValue): string {
  if (s.iv === null || s.authTag === null) throw new Error("Could not decrypt this value");
  return decrypt({ value: s.value, iv: s.iv, authTag: s.authTag });
}

// The ONLY list function. Everything leaves the server through toVariableDTO.
export async function listVariables(userId: string, environmentId: string) {
  await requireEnvironmentAccess(userId, environmentId);

  const rows = await prisma.variable.findMany({
    where: { environmentId },
    orderBy: { key: "asc" },
    select: {
      id: true,
      key: true,
      value: true,
      isSensitive: true,
      version: true,
      updatedBy: { select: { name: true } },
    },
  });

  return rows.map(toVariableDTO);
}

// ---- Transaction-level helpers (Phase 3 import will reuse these with one shared batchId) ----

export async function applyCreate(
  tx: Tx,
  ctx: Ctx,
  environmentId: string,
  key: string,
  value: string,
  isSensitive: boolean
) {
  const existing = await tx.variable.findUnique({
    where: { environmentId_key: { environmentId, key } },
    select: { id: true },
  });
  if (existing) throw new ApiError(409, KEY_EXISTS, { key: KEY_EXISTS });

  const stored: StoredValue = isSensitive
    ? encrypt(value)
    : { value, iv: null, authTag: null };

  const created = await tx.variable.create({
    data: {
      environmentId,
      key,
      value: stored.value,
      iv: stored.iv,
      authTag: stored.authTag,
      isSensitive,
      updatedById: ctx.userId,
    },
    select: { id: true },
  });

  await writeHistory(tx, {
    environmentId,
    batchId: ctx.batchId,
    action: "CREATE",
    key,
    new: stored,
    newIsSensitive: isSensitive,
    changedById: ctx.userId,
  });

  // A new sensitive variable may reuse a key name that has plain history
  if (isSensitive) await encryptPlainHistoryForKey(tx, environmentId, key);

  return created;
}

export async function applyUpdate(
  tx: Tx,
  ctx: Ctx,
  current: CurrentVariable,
  input: { key?: string; value?: string; isSensitive?: boolean; version: number }
) {
  const oldSensitive = current.isSensitive;
  const newSensitive = input.isSensitive ?? oldSensitive;
  const typeChanged = newSensitive !== oldSensitive;
  const newKey = input.key ?? current.key;
  const keyChanged = newKey !== current.key;

  const before: StoredValue = {
    value: current.value,
    iv: current.iv,
    authTag: current.authTag,
  };

  // Decrypt only when the plaintext is really needed (to compare or to convert)
  const needsPlain = input.value !== undefined || typeChanged;
  const currentPlain: string | null = !oldSensitive
    ? current.value
    : needsPlain
      ? decryptStored(before)
      : null;

  const plainAfter = input.value !== undefined ? input.value : currentPlain;
  const valueChanged = input.value !== undefined && input.value !== currentPlain;

  // Nothing actually changed: no version bump, no history row
  if (!keyChanged && !valueChanged && !typeChanged) {
    return { id: current.id, version: current.version };
  }

  // What gets stored. plainAfter is non-null whenever we reach an encrypt/plain branch:
  // a changed value or a type change always loads the plaintext above.
  let after: StoredValue;
  if (newSensitive) {
    after = valueChanged || typeChanged ? encrypt(plainAfter as string) : before;
  } else {
    after = { value: plainAfter as string, iv: null, authTag: null };
  }

  // Atomic: only updates if the version is STILL the one the editor saw
  const result = await tx.variable.updateMany({
    where: { id: current.id, version: input.version },
    data: {
      key: newKey,
      value: after.value,
      iv: after.iv,
      authTag: after.authTag,
      isSensitive: newSensitive,
      version: { increment: 1 },
      updatedById: ctx.userId,
    },
  });
  if (result.count === 0) throw new ApiError(409, CONFLICT);

  if (keyChanged || valueChanged) {
    await writeHistory(tx, {
      environmentId: current.environmentId,
      batchId: ctx.batchId,
      action: "UPDATE",
      key: newKey,
      oldKey: keyChanged ? current.key : null,
      old: valueChanged ? before : null,
      new: valueChanged ? after : null,
      oldIsSensitive: oldSensitive,
      newIsSensitive: newSensitive,
      changedById: ctx.userId,
    });
  }

  if (typeChanged) {
    await writeHistory(tx, {
      environmentId: current.environmentId,
      batchId: ctx.batchId,
      action: "TYPE_CHANGE", // no values stored, only the old and new type
      key: newKey,
      oldIsSensitive: oldSensitive,
      newIsSensitive: newSensitive,
      changedById: ctx.userId,
    });
  }

  // Decision 6: Standard -> Sensitive protects the key's earlier plain history
  if (typeChanged && newSensitive) {
    await encryptPlainHistoryForKey(tx, current.environmentId, newKey);
  }

  return { id: current.id, version: input.version + 1 };
}

export async function applyDelete(tx: Tx, ctx: Ctx, variableId: string) {
  const row = await tx.variable.findUnique({
    where: { id: variableId },
    select: {
      key: true,
      value: true,
      iv: true,
      authTag: true,
      isSensitive: true,
      environmentId: true,
    },
  });
  if (!row) return; // someone else already deleted it

  const result = await tx.variable.deleteMany({ where: { id: variableId } });
  if (result.count === 0) return;

  await writeHistory(tx, {
    environmentId: row.environmentId,
    batchId: ctx.batchId,
    action: "DELETE",
    key: row.key,
    old: { value: row.value, iv: row.iv, authTag: row.authTag },
    oldIsSensitive: row.isSensitive,
    changedById: ctx.userId,
  });
}

// ---- Public service functions (routes call these) ----

export async function createVariable(
  userId: string,
  environmentId: string,
  key: string,
  value: string,
  isSensitive = false
) {
  await requireEnvironmentAccess(userId, environmentId);
  try {
    return await prisma.$transaction((tx) =>
      applyCreate(tx, { userId, batchId: newBatchId() }, environmentId, key, value, isSensitive)
    );
  } catch (e) {
    mapWriteError(e);
  }
}

export async function updateVariable(
  userId: string,
  variableId: string,
  input: { key?: string; value?: string; isSensitive?: boolean; version: number }
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