import Link from "next/link";
import { notFound } from "next/navigation";
import { HistoryTimeline } from "@/components/history/HistoryTimeline";
import { PageHeader } from "@/components/ui/PageHeader";
import { getProjectAccess } from "@/lib/access";
import { listEnvironments } from "@/lib/environments";
import { listHistory } from "@/lib/historyRead";
import { requireUserForPage } from "@/lib/session";

export default async function HistoryPage({
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

  const environments = await listEnvironments(user.id, projectId);
  const envParam = Array.isArray(query.env) ? query.env[0] : query.env;
  const env = environments.find((e) => e.id === envParam) ?? environments[0] ?? null;
  if (!env) notFound();

  const { items, nextCursor } = await listHistory(user.id, env.id, {});

  return (
    <div className="space-y-6">
      <Link
        href={`/projects/${projectId}?env=${env.id}`}
        className="text-sm text-primary hover:underline"
      >
        ← Back to {access.project.name}
      </Link>
      <PageHeader title="History" description={`${access.project.name} · ${env.name}`} />
      <HistoryTimeline
        key={env.id}
        environmentId={env.id}
        initialItems={items}
        initialCursor={nextCursor}
      />
    </div>
  );
}