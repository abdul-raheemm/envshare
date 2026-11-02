"use client";

import { useState } from "react";
import type { FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Switch } from "@/components/ui/Switch";
import { Textarea } from "@/components/ui/Textarea";

export function AddVariableForm({ environmentId }: { environmentId: string }) {
  const router = useRouter();
  const [key, setKey] = useState("");
  const [value, setValue] = useState("");
  const [isSensitive, setIsSensitive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setFields({});
    try {
      const res = await fetch(`/api/environments/${environmentId}/variables`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key, value, isSensitive }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 401) {
        router.push("/login");
        return;
      }
      if (!res.ok) {
        setError(data.error ?? "Something went wrong. Please try again.");
        setFields(data.fields ?? {});
        return;
      }
      setKey("");
      setValue("");
      setIsSensitive(false);
      router.refresh();
    } catch {
      setError("Could not reach the server. Check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-3 border-t border-border pt-4">
      <h3 className="text-sm font-semibold text-gray-900">Add a variable</h3>
      {error && <Alert variant="error">{error}</Alert>}
      <div className="grid items-start gap-3 sm:grid-cols-[1fr_2fr_auto]">
        <Input
          label="Key"
          placeholder="e.g. DATABASE_URL"
          autoComplete="off"
          className="font-mono"
          value={key}
          onChange={(e) => setKey(e.target.value)}
          error={fields.key}
        />
        <Textarea
          label="Value"
          placeholder="e.g. postgres://localhost:5432/app"
          rows={2}
          autoComplete="off"
          className="font-mono"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          error={fields.value}
        />
        <div className="sm:mt-6">
          <Button type="submit" loading={loading}>
            Add variable
          </Button>
        </div>
      </div>
      <div className="space-y-1">
        <Switch label="Sensitive" checked={isSensitive} onChange={setIsSensitive} />
        <p className="text-sm text-muted">
          {isSensitive
            ? "Encrypted before saving, and masked after you add it."
            : "Stored as plain text. Turn this on for passwords and tokens."}
        </p>
      </div>
    </form>
  );
}