"use client";

import { useState } from "react";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { PageHeader } from "@/components/ui/PageHeader";

export default function Home() {
  const [open, setOpen] = useState(false);

  return (
    <main className="mx-auto max-w-2xl space-y-6 p-8">
      <PageHeader
        title="UI check"
        description="Temporary page to preview the shared components"
        actions={<Button>Action</Button>}
      />
      <Card className="space-y-4">
        <Input label="Email" placeholder="you@example.com" />
        <Input label="Password" type="password" error="Password must be at least 8 characters" />
        <div className="flex flex-wrap gap-2">
          <Button>Primary</Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="danger" onClick={() => setOpen(true)}>
            Open modal
          </Button>
          <Button loading>Loading</Button>
        </div>
        <Alert variant="error">Something went wrong</Alert>
        <Alert variant="success">Saved successfully</Alert>
        <Alert variant="info">Just so you know</Alert>
      </Card>
      <Modal open={open} title="Delete variable?" onClose={() => setOpen(false)}>
        <p className="text-sm text-muted">This action cannot be undone.</p>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button variant="danger">Delete</Button>
        </div>
      </Modal>
    </main>
  );
}