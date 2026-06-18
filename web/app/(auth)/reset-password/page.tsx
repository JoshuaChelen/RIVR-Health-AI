"use client";
import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";

import { Button, Card, CtaLink, ErrorText, Field, Input } from "@/components/ui";
import { api } from "@/lib/api";
import { validateUrlToken, validateUrlUid } from "@/lib/security";

function ResetForm() {
  const params = useSearchParams();
  const uid = params.get("uid") ?? "";
  const token = params.get("token") ?? "";
  const [password, setPassword] = useState("");
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const tokensValid = validateUrlUid(uid) && validateUrlToken(token);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submitted) return; // prevent double-submit / link reuse
    if (!tokensValid) {
      setError("Invalid or expired reset link.");
      return;
    }
    setError("");
    setBusy(true);
    setSubmitted(true);
    try {
      await api.post("/api/auth/password/reset", { uid, token, password });
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Reset failed");
      setSubmitted(false); // allow retry on network error
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <Card className="space-y-3 text-center">
        <p className="text-sm text-sub">Password updated.</p>
        <CtaLink href="rivrhealth://auth/confirmed">Open RIVR Health</CtaLink>
      </Card>
    );
  }

  if (!tokensValid) {
    return (
      <Card className="space-y-3 text-center">
        <p className="text-sm text-sub">Invalid or expired reset link.</p>
        <CtaLink href="/">Return home</CtaLink>
      </Card>
    );
  }

  return (
    <Card>
      <form onSubmit={onSubmit} className="space-y-4">
        <h2 className="text-lg font-semibold">Choose a new password</h2>
        <Field label="New password">
          <Input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={8}
            disabled={submitted}
          />
        </Field>
        <ErrorText>{error}</ErrorText>
        <Button
          type="submit"
          disabled={busy || !uid || !token || submitted}
          className="w-full"
        >
          {busy ? "Saving…" : submitted ? "Link used" : "Update password"}
        </Button>
      </form>
    </Card>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={<Card>Loading…</Card>}>
      <ResetForm />
    </Suspense>
  );
}
