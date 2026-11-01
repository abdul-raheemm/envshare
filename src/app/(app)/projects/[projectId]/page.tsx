import Link from "next/link";
import { notFound } from "next/navigation";
import { InviteMemberForm } from "@/components/projects/InviteMemberForm";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { PageHeader } from "@/components/ui/PageHeader";
import { getProjectAccess } from "@/lib/access";
import { listMembers } from "@/lib/projects";
import { requireUserForPage } from "@/lib/session";

export default async function ProjectPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const user = await requireUserForPage();

  const access = await getProjectAccess(user.id, projectId);
  if (!access) notFound();

  const members = await listMembers(user.id, projectId);
  const ownerId = access.project.ownerId;
  const ownerName = members.find((m) => m.id === ownerId)?.name ?? "the owner";

  return (
    <div className="space-y-6">
      <Link href="/dashboard" className="text-sm text-primary hover:underline">
        ← All projects
      </Link>
      <PageHeader
        title={access.project.name}
        description={access.isOwner ? "You own this project" : `Owned by ${ownerName}`}
      />
      <Card className="space-y-4">
        <h2 className="text-lg font-semibold text-gray-900">Members</h2>
        <ul className="divide-y divide-border">
          {members.map((m) => (
            <li key={m.id} className="flex items-center justify-between py-3">
              <div>
                <p className="text-sm font-medium text-gray-900">{m.name}</p>
                <p className="text-sm text-muted">{m.email}</p>
              </div>
              <Badge variant={m.id === ownerId ? "primary" : "neutral"}>
                {m.id === ownerId ? "Owner" : "Member"}
              </Badge>
            </li>
          ))}
        </ul>
        {access.isOwner && <InviteMemberForm projectId={projectId} />}
      </Card>
    </div>
  );
}