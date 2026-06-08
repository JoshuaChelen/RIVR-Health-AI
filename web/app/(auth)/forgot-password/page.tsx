"use client";
import { useState } from "react";

import { Button, Card, Field, Input } from "@/components/ui";
import { api } from "@/lib/api";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await api.post("/api/auth/password/forgot", { email });
      setSent(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      {sent ? (
        <div className="space-y-3 text-center">
          <p className="text-sm text-sub">If that email is registered, a reset link is on its way.</p>
          <p className="text-sm text-muted">You can close this tab and open the RIVR app.</p>
        </div>
      ) : (
        <form onSubmit={onSubmit} className="space-y-4">
          <h2 className="text-lg font-semibold">Reset your password</h2>
          <Field label="Email">
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </Field>
          <Button type="submit" disabled={busy} className="w-full">{busy ? "Sending…" : "Send reset link"}</Button>
        </form>
      )}
    </Card>
  );
}
