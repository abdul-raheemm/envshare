import { prisma } from "@/lib/db";
import { requireProjectAccess, requireProjectOwner } from "@/lib/access";
import { ApiError, isUniqueViolation } from "@/lib/errors";

const DEFAULT_ENVIRONMENTS = ["Development", "Staging", "Production"];

// The nested creates make the project, the owner's membership and the default
// environments in one atomic step. The createdAt offsets keep the tabs in order.
export async function createProject(userId: string, name: string) {
  const now = Date.now();
  return prisma.project.create({
    data: {
      name,
      ownerId: userId,
      members: { create: { userId } },
      environments: {
        create: DEFAULT_ENVIRONMENTS.map((envName, i) => ({
          name: envName,
          createdAt: new Date(now + i),
        })),
      },
    },
    select: { id: true, name: true },
  });
}

export async function listProjectsForUser(userId: string) {
  const memberships = await prisma.projectMember.findMany({
    where: { userId },
    orderBy: { project: { createdAt: "desc" } },
    select: {
      project: {
        select: {
          id: true,
          name: true,
          createdAt: true,
          ownerId: true,
          owner: { select: { name: true } },
          _count: { select: { members: true } },
        },
      },
    },
  });

  return memberships.map(({ project }) => ({
    id: project.id,
    name: project.name,
    createdAt: project.createdAt,
    ownerName: project.owner.name,
    isOwner: project.ownerId === userId,
    memberCount: project._count.members,
  }));
}

export async function listMembers(userId: string, projectId: string) {
  await requireProjectAccess(userId, projectId);

  const rows = await prisma.projectMember.findMany({
    where: { projectId },
    orderBy: { createdAt: "asc" },
    select: {
      createdAt: true,
      user: { select: { id: true, name: true, email: true } },
    },
  });

  return rows.map((row) => ({ ...row.user, joinedAt: row.createdAt }));
}

export async function addMemberByEmail(
  ownerId: string,
  projectId: string,
  email: string
) {
  await requireProjectOwner(ownerId, projectId);

  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true },
  });
  if (!user) {
    const message = "No registered user with this email";
    throw new ApiError(404, message, { email: message });
  }

  const alreadyMessage = "This user is already a member";
  const existing = await prisma.projectMember.findUnique({
    where: { projectId_userId: { projectId, userId: user.id } },
    select: { id: true },
  });
  if (existing) throw new ApiError(409, alreadyMessage, { email: alreadyMessage });

  try {
    await prisma.projectMember.create({ data: { projectId, userId: user.id } });
  } catch (e) {
    if (isUniqueViolation(e)) {
      throw new ApiError(409, alreadyMessage, { email: alreadyMessage });
    }
    throw e;
  }
}