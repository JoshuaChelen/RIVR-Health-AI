"use client";
import { useState } from "react";

import { Button, Card } from "@/components/ui";
import { api } from "@/lib/api";

const TYPES: [string, string][] = [
  ["card_3x5", "Emergency card"],
  ["full_summary", "Full summary"],
  ["pre_visit_note", "Pre-visit note"],
  ["full_timeline", "Timeline"],
];

export default function SharePage() {
  const [selected, setSelected] = useState<string[]>(["card_3x5"]);
  const [result, setResult] = useState<{ shareUrl: string; expiresAt: string } | null>(null);
  const [busy, setBusy] = useState(false);

  function toggle(t: string) {
    setSelected((s) => (s.includes(t) ? s.filter((x) => x !== t) : [...s, t]));
  }

  async function create() {
    setBusy(true);
    try {
      setResult(await api.post("/api/shares", { shareTypes: selected }));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="space-y-4">
      <h2 className="text-lg font-semibold">Create a secure share link</h2>
      <div className="flex flex-wrap gap-2">
        {TYPES.map(([t, label]) => (
          <button
            key={t}
            onClick={() => toggle(t)}
            className={`rounded-full border px-3 py-1.5 text-sm ${
              selected.includes(t) ? "border-teal bg-teal-soft text-teal" : "border-slate-200 text-sub"
            }`}
          >
            {label}
          </button>
        ))}
      </div>
      <Button onClick={create} disabled={busy || selected.length === 0}>{busy ? "Creating…" : "Create link"}</Button>
      {result && (
        <div className="rounded-lg bg-slate-50 p-3 text-sm">
          <p className="mb-1 break-all font-mono text-teal">{result.shareUrl}</p>
          <p className="text-xs text-muted">Expires {new Date(result.expiresAt).toLocaleString()} · max 2 views.</p>
        </div>
      )}
    </Card>
  );
}
