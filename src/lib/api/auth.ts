import { api, clearTokens, getRefreshToken, setTokens } from "./client";

export interface ApiUser {
  id: string;
  email: string;
  is_email_verified: boolean;
  date_joined: string;
}

export async function register(email: string, password: string): Promise<ApiUser> {
  const data = await api.post<{ user: ApiUser; access: string; refresh: string }>(
    "/api/auth/register",
    { email, password },
  );
  await setTokens(data.access, data.refresh);
  return data.user;
}

export async function login(email: string, password: string): Promise<ApiUser> {
  const data = await api.post<{ user: ApiUser; access: string; refresh: string }>(
    "/api/auth/login",
    { email, password },
  );
  await setTokens(data.access, data.refresh);
  return data.user;
}

export async function logout(): Promise<void> {
  const refresh = await getRefreshToken();
  try {
    if (refresh) await api.post("/api/auth/logout", { refresh });
  } finally {
    await clearTokens();
  }
}

export function me(): Promise<ApiUser> {
  return api.get<ApiUser>("/api/auth/me");
}
