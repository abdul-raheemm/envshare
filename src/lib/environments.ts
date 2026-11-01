import { prisma } from "@/lib/db";
import { requireProjectAccess } from "@/lib/access";
import { ApiError, isUniqueViolation } from "@/lib/errors";

export async function listEnvironments(userId: string, projectId: string) {
  await requireProjectAccess(userId, projectId);
  return prisma.environment.findMany({
    where: { projectId },
    orderBy: { createdAt: "asc" },
    select: { id: true, name: true },
  });
}

export async function createEnvironment(
  userId: string,
  projectId: string,
  name: string
) {
  await requireProjectAccess(userId, projectId);

  const message = "This environment already exists";

  // Case-insensitive check, so "QA" and "qa" count as the same name
  const existing = await prisma.environment.findFirst({
    where: { projectId, name: { equals: name, mode: "insensitive" } },
    select: { id: true },
  });
  if (existing) throw new ApiError(409, message, { name: message });

  try {
    return await prisma.environment.create({
      data: { projectId, name },
      select: { id: true, name: true },
    });
  } catch (e) {
    // the database's unique rule is the backstop if two requests race
    if (isUniqueViolation(e)) throw new ApiError(409, message, { name: message });
    throw e;
  }
}