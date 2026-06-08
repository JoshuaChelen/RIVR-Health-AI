"use client";
import { useCallback, useEffect, useState } from "react";

import { Button, Card } from "@/components/ui";
import { ApiError, api } from "@/lib/api";
import type { HealthProfile } from "@/lib/types";

export default function DashboardPage() {
  const [hp, setHp] = useState<HealthProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setHp(await api.get<HealthProfile>("/api/health-profile"));
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) setHp(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function generate() {
    setGenerating(true);
    try {
      await api.post("/api/jobs/enqueue", { jobType: "profile_evaluation" });
      setTimeout(load, 2000);
    } finally {
      setGenerating(false);
    }
  }

  if (loading) return <p className="text-muted">Loading…</p>;

  if (!hp) {
    return (
      <Card className="text-center">
        <h2 className="mb-2 text-lg font-semibold">No health summary yet</h2>
        <p className="mb-4 text-sm text-muted">Generate your SHIN score and summary from your profile and documents.</p>
        <Button onClick={generate} disabled={generating}>{generating ? "Starting…" : "Generate my summary"}</Button>
      </Card>
    );
  }

  const s = hp.summary_json || {};
  return (
    <div className="space-y-5">
      <Card className="flex items-center gap-6">
        <div className="grid h-28 w-28 shrink-0 place-items-center rounded-full border-8 border-teal-soft">
          <div className="text-center">
            <div className="text-3xl font-bold text-ink">{hp.score}</div>
            <div className="text-xs font-semibold text-teal">{hp.score_label}</div>
          </div>
        </div>
        <div>
          <div className="text-xs font-semibold uppercase tracking-wide text-muted">SHIN Score</div>
          <p className="mt-1 text-sm text-sub">{s.overview}</p>
        </div>
      </Card>

      {!!s.recommendations?.length && (
        <Card>
          <h3 className="mb-3 font-semibold">Recommendations</h3>
          <ul className="space-y-3">
            {s.recommendations.map((r) => (
              <li key={r.id} className="border-l-2 border-teal pl-3">
                <div className="text-sm font-semibold text-ink">{r.title}</div>
                <div className="text-sm text-muted">{r.body}</div>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {s.full_summary_markdown && (
        <Card>
          <h3 className="mb-3 font-semibold">Full summary</h3>
          <p className="whitespace-pre-wrap text-sm leading-relaxed text-sub">{s.full_summary_markdown}</p>
          {s.disclaimer && <p className="mt-4 text-xs italic text-muted">{s.disclaimer}</p>}
        </Card>
      )}
    </div>
  );
}
