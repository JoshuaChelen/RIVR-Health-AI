"use client";
import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";

import { Button, Card, ErrorText, Field, Input, Logo } from "@/components/ui";
import { apiBase } from "@/lib/api";
import { validateUrlToken } from "@/lib/security";

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

  const tokenValid = validateUrlToken(token);

  async function resolve() {
    if (busy || !tokenValid) return;
    setBusy(true);
    try {
      const res = await fetch(`${apiBase}/api/shares/resolve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, pin: pin || undefined }),
      });
      // A pinRequired / wrong-PIN / rate-limit response does NOT consume the link
      // (the server enforces the real view limit atomically), so the form stays
      // usable for a retry. Only a successful resolve renders the items view.
      setResult(await res.json());
    } catch {
      // Merge (don't replace) so a transient network error during a PIN retry
      // doesn't drop the pinRequired flag and hide the PIN field.
      setResult((prev) => ({ ...prev, error: "Something went wrong. Please try again." }));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid min-h-screen place-items-center px-4">
      <div className="w-full max-w-md">
        <div className="mb-6 flex justify-center">
          <Logo size={64} />
        </div>
        <Card className="space-y-4">
          <h2 className="font-semibold">Shared health record</h2>
          {result?.items ? (
            <ul className="space-y-2">
              {result.items.map((it, i) => (
                <li key={i}>
                  <a
                    className="text-teal hover:underline"
                    href={it.signedUrl}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {it.title} (PDF) →
                  </a>
                </li>
              ))}
            </ul>
          ) : (
            <>
              {result?.pinRequired && (
                <Field label="PIN">
                  <Input
                    value={pin}
                    onChange={(e) => setPin(e.target.value)}
                    disabled={busy}
                  />
                </Field>
              )}
              <ErrorText>{result?.error}</ErrorText>
              <Button
                onClick={resolve}
                disabled={busy || !token || !tokenValid}
              >
                {busy ? "Opening…" : "View records"}
              </Button>
              <p className="text-xs text-muted">
                These links expire quickly and have a limited number of views.
              </p>
            </>
          )}
        </Card>
      </div>
    </div>
  );
}

export default function PublicSharePage() {
  return (
    <Suspense
      fallback={
        <div className="grid min-h-screen place-items-center text-muted">Loading…</div>
      }
    >
      <ShareView />
    </Suspense>
  );
}
