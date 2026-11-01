"use client";

import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";

export default function ErrorPage() {
  return (
    <main className="p-6">
      <Card className="mx-auto mt-10 max-w-md space-y-4 text-center">
        <h1 className="text-xl font-semibold text-gray-900">Something went wrong</h1>
        <p className="text-sm text-muted">
          An unexpected error occurred. Please try again.
        </p>
        <Button onClick={() => window.location.reload()}>Try again</Button>
      </Card>
    </main>
  );
}