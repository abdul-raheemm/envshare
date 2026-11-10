"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { HistoryButton } from "@/components/history/HistoryButton";
import { Alert } from "@/components/ui/Alert";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Switch } from "@/components/ui/Switch";
import { Textarea } from "@/components/ui/Textarea";
import {
  buildApplyRequest,
  countSelectedChanges,
  initialChoices,
  type Choices,
  type RowChoice,
} from "@/lib/importClient";
import { MAX_IMPORT_BYTES } from "@/lib/importLimits";
import type { ImportPreview, ImportResult } from "@/lib/importTypes";
import { ImportPreviewTable } from "./ImportPreviewTable";

type Stage = "paste" | "review" | "done";

type ApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; status: number; error: string; fields: Record<string, string> };

async function postJson<T>(url: string, body: unknown): Promise<ApiResult<T>> {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok) return { ok: true, data: data as T };
    return {
      ok: false,
      status: res.status,
      error: data.error ?? "Something went wrong. Please try again.",
      fields: data.fields ?? {},
    };
  } catch {
    return {
      ok: false,
      status: 0,
      error: "Could not reach the server. Check your connection and try again.",
      fields: {},
    };
  }
}

const TITLES: Record<Stage, string> = {
  paste: "Import .env",
  review: "Review import",
  done: "Import complete",
};

export function ImportEnvDialog({
  projectId,
  environmentId,
  onClose,
}: {
  projectId: string;
  environmentId: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const [stage, setStage] = useState<Stage>("paste");
  const [text, setText] = useState("");
  const [autoFlag, setAutoFlag] = useState(false);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [choices, setChoices] = useState<Choices>(new Map());
  const [result, setResult] = useState<ImportResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [conflict, setConflict] = useState(false);

  const base = `/api/environments/${environmentId}/import`;

  function handleClose() {
    if (!loading) onClose(); // the dialog unmounts, which clears every pasted value from state
  }

  async function review() {
    setError(null);
    setFields({});
    setConflict(false);
    if (text.trim() === "") {
      setFields({ text: "Paste some .env text first" });
      return;
    }
    if (new TextEncoder().encode(text).length > MAX_IMPORT_BYTES) {
      setError(`That text is too large. The limit is ${MAX_IMPORT_BYTES / 1024} KB.`);
      return;
    }
    setLoading(true);
    const res = await postJson<ImportPreview>(`${base}/preview`, {
      text,
      autoFlagSensitive: autoFlag,
    });
    setLoading(false);
    if (!res.ok) {
      if (res.status === 401) {
        router.push("/login");
        return;
      }
      setError(res.error);
      setFields(res.fields);
      return;
    }
    setPreview(res.data);
    setChoices(initialChoices(res.data));
    setStage("review");
  }

  async function apply() {
    if (!preview) return;
    setLoading(true);
    setError(null);
    setConflict(false);
    const res = await postJson<ImportResult>(
      `${base}/apply`,
      buildApplyRequest(preview, choices, text, autoFlag)
    );
    setLoading(false);
    if (!res.ok) {
      if (res.status === 401) {
        router.push("/login");
        return;
      }
      setConflict(res.status === 409);
      setError(res.error);
      return;
    }
    // Done: drop the pasted secrets from memory right away
    setResult(res.data);
    setText("");
    setPreview(null);
    setChoices(new Map());
    setStage("done");
    router.refresh();
  }

  function changeChoice(key: string, patch: Partial<RowChoice>) {
    setChoices((prev) => {
      const next = new Map(prev);
      const current = next.get(key) ?? { include: true, isSensitive: false };
      next.set(key, { ...current, ...patch });
      return next;
    });
  }

  const selected = preview ? countSelectedChanges(preview, choices) : 0;

  return (
    <Modal
      open
      title={TITLES[stage]}
      onClose={handleClose}
      size={stage === "review" ? "xl" : "md"}
      closeOnBackdrop={false}
    >
      {stage === "paste" && (
        <div className="space-y-4">
          {error && <Alert variant="error">{error}</Alert>}
          <Textarea
            label=".env text"
            placeholder={"# Paste your .env here\nDATABASE_URL=postgres://localhost:5432/app\nPORT=3000"}
            rows={12}
            autoComplete="off"
            spellCheck={false}
            className="font-mono"
            value={text}
            onChange={(e) => setText(e.target.value)}
            error={fields.text}
          />
          <p className="text-sm text-muted">
            Blank lines and lines starting with # are ignored. Variables you don&apos;t paste are
            never deleted.
          </p>
          <div className="space-y-1">
            <Switch
              label="Mark names containing KEY, TOKEN, SECRET or PASSWORD as Sensitive"
              checked={autoFlag}
              onChange={setAutoFlag}
            />
            <p className="text-sm text-muted">
              Applies to new variables only. You can change each one on the next screen.
            </p>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={handleClose} disabled={loading}>
              Cancel
            </Button>
            <Button onClick={review} loading={loading}>
              Review
            </Button>
          </div>
        </div>
      )}

      {stage === "review" && preview && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="success">🟢 {preview.counts.new} new</Badge>
            <Badge variant="warning">🟡 {preview.counts.update} to update</Badge>
            <Badge variant="neutral">⚪ {preview.counts.unchanged} unchanged</Badge>
            {preview.counts.invalid > 0 && (
              <Badge variant="danger">{preview.counts.invalid} lines skipped</Badge>
            )}
            {preview.counts.duplicates > 0 && (
              <Badge variant="neutral">{preview.counts.duplicates} duplicate keys (last value used)</Badge>
            )}
          </div>

          {preview.issues.length > 0 && (
            <Alert variant="info">
              <ul className="space-y-1">
                {preview.issues.map((i, n) => (
                  <li key={n}>
                    Line {i.line}: {i.message}
                  </li>
                ))}
              </ul>
              {preview.issuesTruncated && <p className="mt-1">More lines had problems than are shown here.</p>}
            </Alert>
          )}

          {error && (
            <Alert variant="error">
              <p>{error}</p>
              {conflict && (
                <div className="mt-2">
                  <Button size="sm" variant="secondary" onClick={review} loading={loading}>
                    Review again
                  </Button>
                </div>
              )}
            </Alert>
          )}

          {preview.rows.length === 0 ? (
            <Alert variant="info">No variables were found in that text.</Alert>
          ) : (
            <ImportPreviewTable rows={preview.rows} choices={choices} onChoice={changeChoice} />
          )}

          <p className="text-sm text-muted">
            Existing variables keep their current type. Variables that aren&apos;t in your paste are
            never deleted. Values of Sensitive variables stay masked.
          </p>

          {preview.rows.length > 0 && selected === 0 && (
            <Alert variant="info">Nothing to import: every selected variable already matches.</Alert>
          )}

          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setStage("paste")} disabled={loading}>
              Back
            </Button>
            <Button onClick={apply} loading={loading} disabled={selected === 0}>
              {selected === 1 ? "Apply 1 change" : `Apply ${selected} changes`}
            </Button>
          </div>
        </div>
      )}

      {stage === "done" && result && (
        <div className="space-y-4">
          {result.batchId ? (
            <Alert variant="success">
              Import finished: {result.created} created, {result.updated} updated,{" "}
              {result.unchanged} unchanged, {result.skipped} skipped
              {result.ignoredLines > 0 ? `, ${result.ignoredLines} lines ignored` : ""}.
            </Alert>
          ) : (
            <Alert variant="info">Nothing was imported. Everything already matched.</Alert>
          )}
          <div className="flex items-center justify-end gap-2">
            {result.batchId && (
              <HistoryButton href={`/projects/${projectId}/history?env=${environmentId}`} />
            )}
            <Button onClick={handleClose}>Close</Button>
          </div>
        </div>
      )}
    </Modal>
  );
}