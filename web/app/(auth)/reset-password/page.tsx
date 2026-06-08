"use client";
import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";

import { Button, Card, ErrorText, Field, Input } from "@/components/ui";
import { api } from "@/lib/api";

function ResetForm() {
  const params = useSearchParams();
  const uid = params.get("uid") ?? "";
  const token = params.get("token") ?? "";
  const [password, setPassword] = useState("");
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      await api.post("/api/auth/password/reset", { uid, token, password });
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Reset failed");
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <Card>
        <p className="text-center text-sm text-sub">Password updated. Open the RIVR app to sign in.</p>
      </Card>
    );
  }
  return (
    <Card>
      <form onSubmit={onSubmit} className="space-y-4">
        <h2 className="text-lg font-semibold">Choose a new password</h2>
        <Field label="New password">
          <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} />
        </Field>
        <ErrorText>{error}</ErrorText>
        <Button type="submit" disabled={busy || !uid || !token} className="w-full">{busy ? "Saving…" : "Update password"}</Button>
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
