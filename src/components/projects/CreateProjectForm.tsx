"use client";

import { useState } from "react";
import type { FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";

export function CreateProjectForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<string | undefined>();
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setFieldError(undefined);
    try {
      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 401) {
        router.push("/login");
        return;
      }
      if (!res.ok) {
        setError(data.error ?? "Something went wrong. Please try again.");
        setFieldError(data.fields?.name);
        return;
      }
      router.push(`/projects/${data.project.id}`);
    } catch {
      setError("Could not reach the server. Check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card>
      <form onSubmit={handleSubmit} noValidate className="space-y-4">
        <h2 className="text-lg font-semibold text-gray-900">Create a project</h2>
        {error && <Alert variant="error">{error}</Alert>}
        <div className="flex items-end gap-3">
          <div className="flex-1">
            <Input
              label="Project name"
              placeholder="e.g. Company Mobile App"
              value={name}
              onChange={(e) => setName(e.target.value)}
              error={fieldError}
            />
          </div>
          <Button type="submit" loading={loading}>
            Create project
          </Button>
        </div>
      </form>
    </Card>
  );
}