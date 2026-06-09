import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";

import { clearTokens, getAccessToken, setUnauthorizedHandler } from "../lib/api/client";
import * as apiAuth from "../lib/api/auth";
import type { ApiUser } from "../lib/api/auth";
import { setCurrentUserId } from "../lib/auth";
import { setUser as setSentryUser } from "../lib/sentry";

interface SessionValue {
  user: ApiUser | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<ApiUser>;
  signUp: (email: string, password: string) => Promise<ApiUser>;
  signOut: () => Promise<void>;
}

const SessionContext = createContext<SessionValue | undefined>(undefined);

function applyUser(user: ApiUser | null): void {
  setCurrentUserId(user?.id ?? null);
  setSentryUser(user ? { id: user.id, email: user.email } : null);
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<ApiUser | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (await getAccessToken()) {
      try {
        const me = await apiAuth.me();
        setUser(me);
        applyUser(me);
      } catch {
        await clearTokens();
        setUser(null);
        applyUser(null);
      }
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // When any request is unauthorized and can't be refreshed, drop the user so
  // the app shows Login instead of leaving the user on a screen showing an error.
  useEffect(() => {
    setUnauthorizedHandler(() => {
      setUser(null);
      applyUser(null);
    });
    return () => setUnauthorizedHandler(null);
  }, []);

  const signIn = useCallback(async (email: string, password: string) => {
    const u = await apiAuth.login(email, password);
    setUser(u);
    applyUser(u);
    return u;
  }, []);

  const signUp = useCallback(async (email: string, password: string) => {
    const u = await apiAuth.register(email, password);
    setUser(u);
    applyUser(u);
    return u;
  }, []);

  const signOut = useCallback(async () => {
    await apiAuth.logout();
    setUser(null);
    applyUser(null);
  }, []);

  return (
    <SessionContext.Provider value={{ user, loading, signIn, signUp, signOut }}>
      {children}
    </SessionContext.Provider>
  );
}

export function useSession(): SessionValue {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error("useSession must be used within a SessionProvider");
  return ctx;
}
