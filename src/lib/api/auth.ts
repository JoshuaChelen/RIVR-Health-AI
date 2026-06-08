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
export function forgotPassword(email: string): Promise<unknown> {
  return api.post("/api/auth/password/forgot", { email });
}
export function resetPassword(uid: string, token: string, password: string): Promise<unknown> {
  return api.post("/api/auth/password/reset", { uid, token, password });
}
export function changePassword(currentPassword: string, newPassword: string): Promise<unknown> {
  return api.post("/api/auth/password/change", { current_password: currentPassword, new_password: newPassword });
}
export function deleteAccount(): Promise<unknown> {
  return api.del("/api/account");
}
