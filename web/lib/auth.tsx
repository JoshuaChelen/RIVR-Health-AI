"use client";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

import { api, clearTokens, getAccess, getRefresh, setTokens } from "./api";
import type { User } from "./types";

interface AuthValue {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      if (getAccess()) {
        try {
          setUser(await api.get<User>("/api/auth/me"));
        } catch {
          clearTokens();
        }
      }
      setLoading(false);
    })();
  }, []);

  async function login(email: string, password: string) {
    const data = await api.post("/api/auth/login", { email, password });
    setTokens(data.access, data.refresh);
    setUser(data.user);
  }
  async function register(email: string, password: string) {
    const data = await api.post("/api/auth/register", { email, password });
    setTokens(data.access, data.refresh);
    setUser(data.user);
  }
  async function logout() {
    try {
      await api.post("/api/auth/logout", { refresh: getRefresh() });
    } catch {
      /* ignore */
    }
    clearTokens();
    setUser(null);
  }
  async function refreshUser() {
    setUser(await api.get<User>("/api/auth/me"));
  }

  return (
    <AuthContext.Provider value={{ user, loading, login, register, logout, refreshUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
