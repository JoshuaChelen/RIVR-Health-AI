"use client";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";

import { Card } from "@/components/ui";
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
        {state === "ok" && <p className="text-sub">Your email is verified. <Link href="/dashboard" className="text-teal hover:underline">Continue</Link></p>}
        {state === "error" && <p className="text-red-600">This verification link is invalid or expired.</p>}
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
