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
      <Alert variant="info">
        Standard values are stored as plain text. Turn on Sensitive for passwords and tokens:
        they are encrypted and masked.
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
                <th className="pb-2 pr-4">Type</th>
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