"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";

export function Navbar({ userName }: { userName: string }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleLogout() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/logout", { method: "POST" });
      if (!res.ok) throw new Error("Logout failed");
      router.replace("/login");
      router.refresh();
    } catch {
      setError("Could not log out. Please try again.");
      setLoading(false);
    }
  }

  return (
    <header className="border-b border-border bg-surface">
      <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-3">
        <Link href="/dashboard" className="text-lg font-semibold text-primary">
          EnvShare
        </Link>
        <div className="flex items-center gap-4">
          {error && <span className="text-sm text-danger">{error}</span>}
          <span className="text-sm text-muted">{userName}</span>
          <Button variant="secondary" loading={loading} onClick={handleLogout}>
            Log out
          </Button>
        </div>
      </div>
    </header>
  );
}