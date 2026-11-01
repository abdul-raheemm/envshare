import { prisma } from "@/lib/db";
import { requireEnvironmentAccess, requireVariableAccess } from "@/lib/access";
import { ApiError, isUniqueViolation } from "@/lib/errors";

const KEY_EXISTS = "This key already exists";
const CONFLICT = "This variable was changed by someone else. Reload and try again";

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

export async function createVariable(
  userId: string,
  environmentId: string,
  key: string,
  value: string
) {
  await requireEnvironmentAccess(userId, environmentId);

  const existing = await prisma.variable.findUnique({
    where: { environmentId_key: { environmentId, key } },
    select: { id: true },
  });
  if (existing) throw new ApiError(409, KEY_EXISTS, { key: KEY_EXISTS });

  try {
    return await prisma.variable.create({
      data: { environmentId, key, value, updatedById: userId },
      select: { id: true },
    });
  } catch (e) {
    if (isUniqueViolation(e)) throw new ApiError(409, KEY_EXISTS, { key: KEY_EXISTS });
    throw e;
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

  const newKey = input.key ?? current.key;
  const newValue = input.value ?? current.value;

  // Nothing actually changed, so don't bump the version
  if (newKey === current.key && newValue === current.value) {
    return { id: current.id, version: current.version };
  }

  try {
    // Atomic: only updates if the version is STILL the one the editor saw
    const result = await prisma.variable.updateMany({
      where: { id: variableId, version: input.version },
      data: {
        key: newKey,
        value: newValue,
        version: { increment: 1 },
        updatedById: userId,
      },
    });
    if (result.count === 0) throw new ApiError(409, CONFLICT);
  } catch (e) {
    if (e instanceof ApiError) throw e;
    if (isUniqueViolation(e)) throw new ApiError(409, KEY_EXISTS, { key: KEY_EXISTS });
    throw e;
  }

  return { id: variableId, version: input.version + 1 };
}

export async function deleteVariable(userId: string, variableId: string) {
  await requireVariableAccess(userId, variableId);
  await prisma.variable.deleteMany({ where: { id: variableId } });
}