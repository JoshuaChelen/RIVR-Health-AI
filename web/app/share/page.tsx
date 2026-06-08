"use client";
import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";

import { Button, Card, Field, Input } from "@/components/ui";
import { apiBase } from "@/lib/api";

interface ResolveResult {
  items?: { title: string; signedUrl: string }[];
  pinRequired?: boolean;
  error?: string;
}

function ShareView() {
  const token = useSearchParams().get("token") ?? "";
  const [pin, setPin] = useState("");
  const [result, setResult] = useState<ResolveResult | null>(null);
  const [busy, setBusy] = useState(false);

  async function resolve() {
    setBusy(true);
    try {
      const res = await fetch(`${apiBase}/api/shares/resolve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, pin: pin || undefined }),
      });
      setResult(await res.json());
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid min-h-screen place-items-center px-4">
      <div className="w-full max-w-md">
        <h1 className="mb-6 text-center text-2xl font-bold text-teal">RIVR Health</h1>
        <Card className="space-y-4">
          <h2 className="font-semibold">Shared health record</h2>
          {result?.items ? (
            <ul className="space-y-2">
              {result.items.map((it, i) => (
                <li key={i}>
                  <a className="text-teal hover:underline" href={it.signedUrl} target="_blank" rel="noreferrer">
                    {it.title} (PDF) →
                  </a>
                </li>
              ))}
            </ul>
          ) : (
            <>
              {result?.pinRequired && (
                <Field label="PIN">
                  <Input value={pin} onChange={(e) => setPin(e.target.value)} />
                </Field>
              )}
              {result?.error && <p className="text-sm text-red-600">{result.error}</p>}
              <Button onClick={resolve} disabled={busy || !token}>{busy ? "Opening…" : "View records"}</Button>
              <p className="text-xs text-muted">These links expire quickly and have a limited number of views.</p>
            </>
          )}
        </Card>
      </div>
    </div>
  );
}

export default function PublicSharePage() {
  return (
    <Suspense fallback={<div className="grid min-h-screen place-items-center text-muted">Loading…</div>}>
      <ShareView />
    </Suspense>
  );
}
