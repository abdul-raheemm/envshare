import Link from "next/link";
import { Card } from "@/components/ui/Card";

export function NotFoundCard() {
  return (
    <Card className="mx-auto mt-10 max-w-md space-y-3 text-center">
      <h1 className="text-xl font-semibold text-gray-900">Page not found</h1>
      <p className="text-sm text-muted">
        This page does not exist, or you do not have access to it.
      </p>
      <Link
        href="/dashboard"
        className="inline-block text-sm font-medium text-primary hover:underline"
      >
        Back to your projects
      </Link>
    </Card>
  );
}