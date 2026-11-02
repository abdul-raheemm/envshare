"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Alert } from "@/components/ui/Alert";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { Switch } from "@/components/ui/Switch";
import { Textarea } from "@/components/ui/Textarea";
import type { VariableDTO } from "@/lib/variableDto";

export type VariableItem = VariableDTO;

const NETWORK_ERROR = "Could not reach the server. Check your connection and try again.";

export function VariableRow({ variable }: { variable: VariableItem }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [draftKey, setDraftKey] = useState(variable.key);
  // Sensitive rows never receive their real value, so their draft starts blank
  const [draftValue, setDraftValue] = useState(variable.isSensitive ? "" : variable.value);
  const [draftIsSensitive, setDraftIsSensitive] = useState(variable.isSensitive);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);
  const [confirmingDowngrade, setConfirmingDowngrade] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  function startEdit() {
    setDraftKey(variable.key);
    setDraftValue(variable.isSensitive ? "" : variable.value);
    setDraftIsSensitive(variable.isSensitive);
    setError(null);
    setFields({});
    setEditing(true);
  }

  function cancelEdit() {
    setDraftValue(""); // don't keep a typed secret in memory
    setError(null);
    setFields({});
    setEditing(false);
  }

  function handleSave() {
    // Sensitive -> Standard stores the value unencrypted: ask first
    if (variable.isSensitive && !draftIsSensitive) {
      setConfirmingDowngrade(true);
      return;
    }
    void doSave();
  }

  async function doSave() {
    setSaving(true);
    setError(null);
    setFields({});
    try {
      // For a sensitive row, a blank field means "keep the current value"
      const sendValue = !variable.isSensitive || draftValue !== "";
      const res = await fetch(`/api/variables/${variable.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          key: draftKey,
          ...(sendValue ? { value: draftValue } : {}),
          isSensitive: draftIsSensitive,
          version: variable.version,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 401) {
        router.push("/login");
        return;
      }
      if (!res.ok) {
        setError(data.error ?? "Something went wrong. Please try again.");
        setFields(data.fields ?? {});
        // Someone else changed it: load the latest version in the background
        if (res.status === 409 && !data.fields) router.refresh();
        return;
      }
      setEditing(false);
      setDraftValue("");
      router.refresh();
    } catch {
      setError(NETWORK_ERROR);
    } finally {
      setSaving(false);
    }
  }

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(variable.value);
      setError(null);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setError("Could not copy. Your browser may have blocked clipboard access.");
    }
  }

  async function handleDelete() {
    setDeleting(true);
    setDeleteError(null);
    try {
      const res = await fetch(`/api/variables/${variable.id}`, { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (res.status === 401) {
        router.push("/login");
        return;
      }
      if (!res.ok) {
        setDeleteError(data.error ?? "Something went wrong. Please try again.");
        return;
      }
      setConfirmingDelete(false);
      router.refresh();
    } catch {
      setDeleteError(NETWORK_ERROR);
    } finally {
      setDeleting(false);
    }
  }

  return (
    <tr className="align-top">
      <td className="py-3 pr-4">
        {editing ? (
          <Input
            label="Key"
            hideLabel
            className="font-mono"
            value={draftKey}
            onChange={(e) => setDraftKey(e.target.value)}
            error={fields.key}
          />
        ) : (
          <span className="break-all font-mono text-sm font-medium text-gray-900">
            {variable.key}
          </span>
        )}
      </td>
      <td className="py-3 pr-4">
        {editing ? (
          <Switch
            label="Sensitive"
            checked={draftIsSensitive}
            onChange={setDraftIsSensitive}
            disabled={saving}
          />
        ) : variable.isSensitive ? (
          <Badge variant="warning">Sensitive</Badge>
        ) : (
          <Badge>Standard</Badge>
        )}
      </td>
      <td className="py-3 pr-4">
        {error && (
          <div className="mb-2">
            <Alert variant="error">{error}</Alert>
          </div>
        )}
        {editing ? (
          <Textarea
            label="Value"
            hideLabel
            rows={2}
            className="font-mono"
            placeholder={variable.isSensitive ? "Leave blank to keep the current value" : undefined}
            autoComplete="off"
            value={draftValue}
            onChange={(e) => setDraftValue(e.target.value)}
            error={fields.value}
          />
        ) : variable.masked ? (
          <span className="font-mono text-sm text-gray-500">{variable.value}</span>
        ) : variable.value === "" ? (
          <span className="text-sm italic text-muted">(empty)</span>
        ) : (
          <span className="whitespace-pre-wrap break-all font-mono text-sm text-gray-700">
            {variable.value}
          </span>
        )}
      </td>
      <td className="py-3 pr-4 text-sm text-muted">{variable.updatedByName}</td>
      <td className="py-3">
        <div className="flex justify-end gap-2">
          {editing ? (
            <>
              <Button size="sm" loading={saving} onClick={handleSave}>
                Save
              </Button>
              <Button size="sm" variant="secondary" disabled={saving} onClick={cancelEdit}>
                Cancel
              </Button>
            </>
          ) : (
            <>
              {/* Temporary: sensitive Copy arrives with the reveal endpoint in step 2.5 */}
              {!variable.masked && (
                <Button size="sm" variant="secondary" onClick={handleCopy}>
                  {copied ? "Copied!" : "Copy"}
                </Button>
              )}
              <Button size="sm" variant="secondary" onClick={startEdit}>
                Edit
              </Button>
              <Button
                size="sm"
                variant="danger"
                onClick={() => {
                  setDeleteError(null);
                  setConfirmingDelete(true);
                }}
              >
                Delete
              </Button>
            </>
          )}
        </div>

        <Modal
          open={confirmingDowngrade}
          title="Store this value unencrypted?"
          onClose={() => setConfirmingDowngrade(false)}
        >
          <p className="text-sm text-muted">
            <span className="font-mono font-medium text-gray-900">{variable.key}</span> will
            become a Standard variable. Its value will be saved as plain text and shown to
            everyone with access to this project.
          </p>
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setConfirmingDowngrade(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                setConfirmingDowngrade(false);
                void doSave();
              }}
            >
              Make standard
            </Button>
          </div>
        </Modal>

        <Modal
          open={confirmingDelete}
          title="Delete variable?"
          onClose={() => setConfirmingDelete(false)}
        >
          {deleteError && (
            <div className="mb-3">
              <Alert variant="error">{deleteError}</Alert>
            </div>
          )}
          <p className="text-sm text-muted">
            This will permanently delete{" "}
            <span className="font-mono font-medium text-gray-900">{variable.key}</span>. This
            cannot be undone.
          </p>
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setConfirmingDelete(false)}>
              Cancel
            </Button>
            <Button variant="danger" loading={deleting} onClick={handleDelete}>
              Delete
            </Button>
          </div>
        </Modal>
      </td>
    </tr>
  );
}