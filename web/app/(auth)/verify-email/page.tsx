"use client";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";

import { Card, CtaLink, ErrorText } from "@/components/ui";
import { api } from "@/lib/api";

function Verify() {
  const token = useSearchParams().get("token") ?? "";
  const [state, setState] = useState<"working" | "ok" | "error">("working");
  useEffect(() => {
    if (!token) {
      setState("error");
      return;
    }
    api.post("/api/auth/verify-email", { token }).then(() => setState("ok")).catch(() => setState("error"));
  }, [token]);
  return (
    <Card>
      <div className="space-y-3 text-center text-sm">
        {state === "working" && <p className="text-muted">Verifying your email…</p>}
        {state === "ok" && (
          <div className="space-y-3">
            <p className="text-sub">Your email is verified.</p>
            <CtaLink href="rivrhealth://auth/confirmed">Open RIVR Health</CtaLink>
          </div>
        )}
        {state === "error" && <ErrorText>This verification link is invalid or expired.</ErrorText>}
      </div>
    </Card>
  );
}

export default function VerifyEmailPage() {
  return (
    <Suspense fallback={<Card>Loading…</Card>}>
      <Verify />
    </Suspense>
  );
}
