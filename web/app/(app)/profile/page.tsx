"use client";
import { useEffect, useState } from "react";

import { Button, Card, Field, Input } from "@/components/ui";
import { api } from "@/lib/api";

const FIELDS: [string, string][] = [
  ["first_name", "First name"],
  ["last_name", "Last name"],
  ["date_of_birth", "Date of birth (YYYY-MM-DD)"],
  ["sex_or_gender", "Sex / gender"],
  ["mobile_phone", "Mobile phone"],
  ["emergency_contact_name", "Emergency contact name"],
  ["emergency_contact_phone", "Emergency contact phone"],
];

export default function ProfilePage() {
  const [form, setForm] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.get("/api/profile").then((d) => {
      const next: Record<string, string> = {};
      for (const [k] of FIELDS) next[k] = d[k] ?? "";
      setForm(next);
      setLoading(false);
    });
  }, []);

  async function onSave(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setSaved(false);
    try {
      const payload = { ...form };
      if (!payload.date_of_birth) delete (payload as any).date_of_birth;
      await api.patch("/api/profile", payload);
      setSaved(true);
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <p className="text-muted">Loading…</p>;

  return (
    <Card>
      <form onSubmit={onSave} className="space-y-4">
        <h2 className="text-lg font-semibold">Your profile</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          {FIELDS.map(([key, label]) => (
            <Field key={key} label={label}>
              <Input value={form[key] ?? ""} onChange={(e) => setForm({ ...form, [key]: e.target.value })} />
            </Field>
          ))}
        </div>
        <div className="flex items-center gap-3">
          <Button type="submit" disabled={busy}>{busy ? "Saving…" : "Save"}</Button>
          {saved && <span className="text-sm text-emerald-600">Saved</span>}
        </div>
      </form>
    </Card>
  );
}
