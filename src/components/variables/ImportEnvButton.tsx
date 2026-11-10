"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { ImportEnvDialog } from "./ImportEnvDialog";

export function ImportEnvButton({
  projectId,
  environmentId,
}: {
  projectId: string;
  environmentId: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
        Import .env
      </Button>
      {/* Mounted only while open, so closing it throws away all pasted text */}
      {open && (
        <ImportEnvDialog
          projectId={projectId}
          environmentId={environmentId}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}