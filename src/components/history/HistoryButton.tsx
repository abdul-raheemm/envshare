"use client";

import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";

export function HistoryButton({ href }: { href: string }) {
  const router = useRouter();
  return (
    <Button size="sm" variant="secondary" onClick={() => router.push(href)}>
      View history
    </Button>
  );
}