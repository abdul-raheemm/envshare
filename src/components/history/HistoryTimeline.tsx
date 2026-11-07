"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import type { HistoryItemDTO, HistoryValueDTO } from "@/lib/historyDto";

const REVEAL_MS = 15000;
const NETWORK_ERROR = "Could not reach the server. Check your connection and try again.";

const ACTION: Record<
  HistoryItemDTO["action"],
  { label: string; variant: "success" | "primary" | "danger" | "warning" }
> = {
  CREATE: { label: "Created", variant: "success" },
  UPDATE: { label: "Updated", variant: "primary" },
  DELETE: { label: "Deleted", variant: "danger" },
  TYPE_CHANGE: { label: "Type changed", variant: "warning" },
};

function typeLabel(sensitive: boolean | null) {
  if (sensitive === null) return "Unknown";
  return sensitive ? "Sensitive" : "Standard";
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

function groupByBatch(items: HistoryItemDTO[]) {
  const groups: { batchId: string; items: HistoryItemDTO[] }[] = [];
  for (const item of items) {
    const last = groups[groups.length - 1];
    if (last && last.batchId === item.batchId) last.items.push(item);
    else groups.push({ batchId: item.batchId, items: [item] });
  }
  return groups;
}

function HistoryValue({
  entryId,
  which,
  value,
}: {
  entryId: string;
  which: "old" | "new";
  value: HistoryValueDTO;
}) {
  const router = useRouter();
  const [revealed, setRevealed] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (hideTimer.current) clearTimeout(hideTimer.current);
    };
  }, []);

  function hide() {
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = null;
    setRevealed(null);
  }

  async function toggle() {
    if (revealed !== null) {
      hide();
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/history/${entryId}/reveal`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ which }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 401) {
        router.push("/login");
        return;
      }
      if (!res.ok || typeof data.value !== "string") {
        setError(data.error ?? "Could not reveal this value.");
        return;
      }
      setRevealed(data.value);
      hideTimer.current = setTimeout(hide, REVEAL_MS);
    } catch {
      setError(NETWORK_ERROR);
    } finally {
      setLoading(false);
    }
  }

  const text = value.masked ? (revealed ?? value.value) : value.value;

  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <span className="whitespace-pre-wrap break-all font-mono text-sm text-gray-700">
        {text === "" ? "(empty)" : text}
      </span>
      {value.masked && (
        <Button size="sm" variant="secondary" loading={loading} onClick={toggle}>
          {revealed !== null ? "Hide" : "Reveal"}
        </Button>
      )}
      {error && <span className="text-sm text-danger">{error}</span>}
    </span>
  );
}

function HistoryRow({ item }: { item: HistoryItemDTO }) {
  const action = ACTION[item.action];
  return (
    <li className="space-y-1 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={action.variant}>{action.label}</Badge>
        <span className="break-all font-mono text-sm font-medium text-gray-900">{item.key}</span>
        {item.oldKey !== null && (
          <span className="text-sm text-muted">
            renamed from <span className="font-mono">{item.oldKey}</span>
          </span>
        )}
      </div>
      {item.action === "TYPE_CHANGE" && (
        <p className="text-sm text-muted">
          {typeLabel(item.oldIsSensitive)} → {typeLabel(item.newIsSensitive)}
        </p>
      )}
      {item.old && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="w-10 text-muted">Old</span>
          <HistoryValue entryId={item.id} which="old" value={item.old} />
        </div>
      )}
      {item.new && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="w-10 text-muted">New</span>
          <HistoryValue entryId={item.id} which="new" value={item.new} />
        </div>
      )}
    </li>
  );
}

export function HistoryTimeline({
  environmentId,
  initialItems,
  initialCursor,
}: {
  environmentId: string;
  initialItems: HistoryItemDTO[];
  initialCursor: string | null;
}) {
  const router = useRouter();
  const [items, setItems] = useState(initialItems);
  const [cursor, setCursor] = useState(initialCursor);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function loadMore() {
    if (!cursor) return;
    setLoadingMore(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/environments/${environmentId}/history?cursor=${encodeURIComponent(cursor)}`
      );
      const data = await res.json().catch(() => ({}));
      if (res.status === 401) {
        router.push("/login");
        return;
      }
      if (!res.ok) {
        setError(data.error ?? "Could not load more history.");
        return;
      }
      setItems((prev) => [...prev, ...data.items]);
      setCursor(data.nextCursor ?? null);
    } catch {
      setError(NETWORK_ERROR);
    } finally {
      setLoadingMore(false);
    }
  }

  if (items.length === 0) {
    return (
      <p className="text-sm text-muted">
        No changes yet. Adding, editing or deleting a variable will show up here.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      {groupByBatch(items).map((group) => (
        <Card key={group.batchId} className="space-y-1">
          <div className="flex flex-wrap items-center gap-x-2 text-sm">
            <span className="font-medium text-gray-900">{group.items[0].changedByName}</span>
            <span className="text-muted">
              ·{" "}
              <time dateTime={group.items[0].changedAt} suppressHydrationWarning>
                {formatDate(group.items[0].changedAt)}
              </time>{" "}
              · {group.items.length} {group.items.length === 1 ? "change" : "changes"}
            </span>
          </div>
          <ul className="divide-y divide-border">
            {group.items.map((item) => (
              <HistoryRow key={item.id} item={item} />
            ))}
          </ul>
        </Card>
      ))}

      {error && <p className="text-sm text-danger">{error}</p>}
      {cursor && (
        <div className="flex justify-center">
          <Button variant="secondary" loading={loadingMore} onClick={loadMore}>
            Load more
          </Button>
        </div>
      )}
    </div>
  );
}