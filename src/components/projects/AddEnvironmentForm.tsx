"use client";

import { useState } from "react";
import type { FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";

export function AddEnvironmentForm({ projectId }: { projectId: string }) {
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
      const res = await fetch(`/api/projects/${projectId}/environments`, {
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
      setName("");
      router.push(`/projects/${projectId}?env=${data.environment.id}`);
      router.refresh();
    } catch {
      setError("Could not reach the server. Check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-3 border-t border-border pt-4">
      <h3 className="text-sm font-semibold text-gray-900">Add an environment</h3>
      {error && <Alert variant="error">{error}</Alert>}
      <div className="flex items-end gap-3">
        <div className="flex-1">
          <Input
            label="Environment name"
            placeholder="e.g. QA"
            value={name}
            onChange={(e) => setName(e.target.value)}
            error={fieldError}
          />
        </div>
        <Button type="submit" loading={loading}>
          Add environment
        </Button>
      </div>
    </form>
  );
}