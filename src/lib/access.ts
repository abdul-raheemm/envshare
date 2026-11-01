import { prisma } from "@/lib/db";
import { ApiError } from "@/lib/errors";

// Returns the project and the user's role, or null if the user is not a member
export async function getProjectAccess(userId: string, projectId: string) {
  const membership = await prisma.projectMember.findUnique({
    where: { projectId_userId: { projectId, userId } },
    select: {
      project: { select: { id: true, name: true, ownerId: true, createdAt: true } },
    },
  });
  if (!membership) return null;
  return {
    project: membership.project,
    isOwner: membership.project.ownerId === userId,
  };
}

// Same, but throws a 404 for non-members (used by API routes)
export async function requireProjectAccess(userId: string, projectId: string) {
  const access = await getProjectAccess(userId, projectId);
  if (!access) throw new ApiError(404, "Project not found");
  return access;
}

export async function requireProjectOwner(userId: string, projectId: string) {
  const access = await requireProjectAccess(userId, projectId);
  if (!access.isOwner) {
    throw new ApiError(403, "Only the project owner can do this");
  }
  return access;
}

export async function requireEnvironmentAccess(userId: string, environmentId: string) {
  const environment = await prisma.environment.findUnique({
    where: { id: environmentId },
    select: { id: true, name: true, projectId: true },
  });
  if (!environment) throw new ApiError(404, "Environment not found");

  const access = await getProjectAccess(userId, environment.projectId);
  if (!access) throw new ApiError(404, "Environment not found");

  return environment;
}

export async function requireVariableAccess(userId: string, variableId: string) {
  const variable = await prisma.variable.findUnique({
    where: { id: variableId },
    select: {
      id: true,
      key: true,
      value: true,
      version: true,
      environmentId: true,
      environment: { select: { projectId: true } },
    },
  });
  if (!variable) throw new ApiError(404, "Variable not found");

  const access = await getProjectAccess(userId, variable.environment.projectId);
  if (!access) throw new ApiError(404, "Variable not found");

  return variable;
}