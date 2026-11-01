import { Alert } from "@/components/ui/Alert";
import { AddVariableForm } from "@/components/variables/AddVariableForm";
import { VariableRow } from "@/components/variables/VariableRow";
import type { VariableItem } from "@/components/variables/VariableRow";

export function VariablesPanel({
  environmentId,
  variables,
}: {
  environmentId: string;
  variables: VariableItem[];
}) {
  return (
    <div className="space-y-4">
      {/* Temporary: remove this banner when encryption is added in Phase 2 */}
      <Alert variant="info">
        Values are stored as plain text for now. Do not enter real secrets yet.
      </Alert>

      {variables.length === 0 ? (
        <p className="text-sm text-muted">
          No variables in this environment yet. Add your first one below.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-border text-xs font-medium uppercase text-muted">
                <th className="pb-2 pr-4">Key</th>
                <th className="pb-2 pr-4">Value</th>
                <th className="pb-2 pr-4">Updated by</th>
                <th className="pb-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {variables.map((v) => (
                <VariableRow key={v.id} variable={v} />
              ))}
            </tbody>
          </table>
        </div>
      )}

      <AddVariableForm environmentId={environmentId} />
    </div>
  );
}