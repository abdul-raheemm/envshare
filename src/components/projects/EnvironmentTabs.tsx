import Link from "next/link";

type Props = {
  projectId: string;
  environments: { id: string; name: string }[];
  activeId?: string;
};

export function EnvironmentTabs({ projectId, environments, activeId }: Props) {
  return (
    <nav className="flex flex-wrap gap-2 border-b border-border" aria-label="Environments">
      {environments.map((env) => {
        const active = env.id === activeId;
        return (
          <Link
            key={env.id}
            href={`/projects/${projectId}?env=${env.id}`}
            aria-current={active ? "page" : undefined}
            className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium ${
              active
                ? "border-primary text-primary"
                : "border-transparent text-muted hover:text-gray-900"
            }`}
          >
            {env.name}
          </Link>
        );
      })}
    </nav>
  );
}