"use client";
import { useEffect, useState } from "react";

import { Card } from "@/components/ui";
import { api } from "@/lib/api";
import type { Paginated, TimelineEvent } from "@/lib/types";

export default function TimelinePage() {
  const [events, setEvents] = useState<TimelineEvent[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .get<Paginated<TimelineEvent>>("/api/timeline-events/?exclude_source=apple_health&limit=100")
      .then((d) => setEvents(d.results))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <p className="text-muted">Loading…</p>;
  if (events.length === 0) return <p className="text-sm text-muted">No timeline events yet.</p>;

  return (
    <div className="space-y-2">
      {events.map((e) => (
        <Card key={e.id} className="py-3">
          <div className="flex items-baseline justify-between">
            <div className="font-medium text-ink">{e.title}</div>
            <div className="text-xs text-muted">{e.occurred_at ?? "Undated"}</div>
          </div>
          {e.summary && <p className="mt-1 text-sm text-sub">{e.summary}</p>}
          {e.document_title && <p className="mt-1 text-xs text-muted">From: {e.document_title}</p>}
        </Card>
      ))}
    </div>
  );
}
