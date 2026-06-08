"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";

import { useAuth } from "@/lib/auth";

const NAV: [string, string][] = [
  ["/dashboard", "Dashboard"],
  ["/documents", "Documents"],
  ["/timeline", "Timeline"],
  ["/qa", "Ask"],
  ["/sharing", "Share"],
  ["/profile", "Profile"],
];

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { user, loading, logout } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (!loading && !user) router.replace("/login");
  }, [user, loading, router]);

  if (loading || !user) {
    return <div className="grid min-h-screen place-items-center text-muted">Loading…</div>;
  }

  return (
    <div className="min-h-screen">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-4 py-3">
          <Link href="/dashboard" className="text-lg font-bold text-teal">RIVR</Link>
          <nav className="flex flex-wrap gap-1">
            {NAV.map(([href, label]) => (
              <Link
                key={href}
                href={href}
                className={`rounded-md px-3 py-1.5 text-sm ${
                  pathname === href ? "bg-teal-soft font-semibold text-teal" : "text-sub hover:bg-slate-100"
                }`}
              >
                {label}
              </Link>
            ))}
          </nav>
          <button
            onClick={async () => {
              await logout();
              router.replace("/login");
            }}
            className="whitespace-nowrap text-sm text-muted hover:text-teal"
          >
            Sign out
          </button>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-6">{children}</main>
    </div>
  );
}
