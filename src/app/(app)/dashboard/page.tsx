import Link from "next/link";
import { CreateProjectForm } from "@/components/projects/CreateProjectForm";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { PageHeader } from "@/components/ui/PageHeader";
import { listProjectsForUser } from "@/lib/projects";
import { requireUserForPage } from "@/lib/session";

export default async function DashboardPage() {
  const user = await requireUserForPage();
  const projects = await listProjectsForUser(user.id);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Projects"
        description="Projects you own or have been invited to"
      />
      <CreateProjectForm />
      {projects.length === 0 ? (
        <Card>
          <p className="text-sm text-muted">
            No projects yet. Create your first one above.
          </p>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {projects.map((p) => (
            <Link key={p.id} href={`/projects/${p.id}`} className="block">
              <Card className="h-full transition-shadow hover:shadow-md">
                <div className="flex items-start justify-between gap-2">
                  <h2 className="text-lg font-semibold text-gray-900">{p.name}</h2>
                  <Badge variant={p.isOwner ? "primary" : "neutral"}>
                    {p.isOwner ? "Owner" : "Member"}
                  </Badge>
                </div>
                <p className="mt-2 text-sm text-muted">
                  {p.isOwner ? "Created by you" : `Owned by ${p.ownerName}`} ·{" "}
                  {p.memberCount} {p.memberCount === 1 ? "member" : "members"}
                </p>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}