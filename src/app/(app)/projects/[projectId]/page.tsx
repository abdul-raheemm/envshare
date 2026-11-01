import Link from "next/link";
import { notFound } from "next/navigation";
import { AddEnvironmentForm } from "@/components/projects/AddEnvironmentForm";
import { EnvironmentTabs } from "@/components/projects/EnvironmentTabs";
import { InviteMemberForm } from "@/components/projects/InviteMemberForm";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { PageHeader } from "@/components/ui/PageHeader";
import { VariablesPanel } from "@/components/variables/VariablesPanel";
import { getProjectAccess } from "@/lib/access";
import { listEnvironments } from "@/lib/environments";
import { listMembers } from "@/lib/projects";
import { requireUserForPage } from "@/lib/session";
import { listVariables } from "@/lib/variables";

export default async function ProjectPage({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<{ env?: string | string[] }>;
}) {
  const { projectId } = await params;
  const query = await searchParams;
  const user = await requireUserForPage();

  const access = await getProjectAccess(user.id, projectId);
  if (!access) notFound();

  const [environments, members] = await Promise.all([
    listEnvironments(user.id, projectId),
    listMembers(user.id, projectId),
  ]);

  // Only environments of THIS project can be selected; anything else falls back to the first
  const envParam = Array.isArray(query.env) ? query.env[0] : query.env;
  const activeEnv = environments.find((e) => e.id === envParam) ?? environments[0] ?? null;

  const variables = activeEnv ? await listVariables(user.id, activeEnv.id) : [];

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
        <h2 className="text-lg font-semibold text-gray-900">Environments</h2>
        {activeEnv ? (
          <>
            <EnvironmentTabs
              projectId={projectId}
              environments={environments}
              activeId={activeEnv.id}
            />
            <VariablesPanel
              key={activeEnv.id}
              environmentId={activeEnv.id}
              variables={variables}
            />
          </>
        ) : (
          <p className="text-sm text-muted">
            No environments yet. Add your first one below.
          </p>
        )}
        <AddEnvironmentForm projectId={projectId} />
      </Card>

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