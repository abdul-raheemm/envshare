"use client";

import { Badge } from "@/components/ui/Badge";
import { Checkbox } from "@/components/ui/Checkbox";
import { Switch } from "@/components/ui/Switch";
import type { Choices, RowChoice } from "@/lib/importClient";
import type { PreviewRow } from "@/lib/importDiff";

// Text labels as well as colours: status is never conveyed by colour alone
const STATUS = {
  NEW: { variant: "success", label: "🟢 New" },
  UPDATE: { variant: "warning", label: "🟡 Update" },
  UNCHANGED: { variant: "neutral", label: "⚪ Unchanged" },
} as const;

function Val({ v }: { v: string }) {
  if (v === "") return <span className="text-xs italic text-muted">(empty)</span>;
  return (
    <code className="block max-h-24 overflow-auto whitespace-pre-wrap break-all font-mono text-xs text-gray-900">
      {v}
    </code>
  );
}

function ValueCell({ row }: { row: PreviewRow }) {
  if (row.status === "UPDATE") {
    if (row.isSensitive) {
      return (
        <div className="space-y-1">
          <Val v={row.newValue} />
          <p className="text-xs text-muted">Value will be replaced</p>
        </div>
      );
    }
    return (
      <div className="space-y-1">
        <div>
          <span className="text-xs font-medium text-muted">Old </span>
          <Val v={row.oldValue ?? ""} />
        </div>
        <div>
          <span className="text-xs font-medium text-muted">New </span>
          <Val v={row.newValue} />
        </div>
      </div>
    );
  }
  return <Val v={row.newValue} />;
}

export function ImportPreviewTable({
  rows,
  choices,
  onChoice,
}: {
  rows: PreviewRow[];
  choices: Choices;
  onChoice: (key: string, patch: Partial<RowChoice>) => void;
}) {
  return (
    <div className="overflow-x-auto rounded-md border border-border">
      <table className="w-full min-w-[40rem] text-left text-sm">
        <thead className="bg-gray-50 text-xs uppercase text-muted">
          <tr>
            <th className="px-3 py-2 font-medium">Import</th>
            <th className="px-3 py-2 font-medium">Status</th>
            <th className="px-3 py-2 font-medium">Key</th>
            <th className="px-3 py-2 font-medium">Value</th>
            <th className="px-3 py-2 font-medium">Type</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map((r) => {
            const choice = choices.get(r.key) ?? { include: true, isSensitive: r.isSensitive };
            const changes = r.status !== "UNCHANGED";
            const dim = changes && !choice.include;
            const status = STATUS[r.status];
            return (
              <tr key={r.key} className={`align-top ${dim ? "opacity-50" : ""}`}>
                <td className="px-3 py-2">
                  {changes ? (
                    <Checkbox
                      label={`Import ${r.key}`}
                      hideLabel
                      checked={choice.include}
                      onChange={(include) => onChoice(r.key, { include })}
                    />
                  ) : (
                    <span className="text-muted">-</span>
                  )}
                </td>
                <td className="px-3 py-2">
                  <Badge variant={status.variant}>{status.label}</Badge>
                </td>
                <td className="px-3 py-2 font-mono text-xs text-gray-900 break-all">{r.key}</td>
                <td className="px-3 py-2">
                  <ValueCell row={r} />
                </td>
                <td className="px-3 py-2">
                  {r.status === "NEW" ? (
                    <Switch
                      label="Sensitive"
                      checked={choice.isSensitive}
                      disabled={!choice.include}
                      onChange={(isSensitive) => onChoice(r.key, { isSensitive })}
                    />
                  ) : (
                    <Badge variant={r.isSensitive ? "primary" : "neutral"}>
                      {r.isSensitive ? "Sensitive" : "Standard"}
                    </Badge>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}