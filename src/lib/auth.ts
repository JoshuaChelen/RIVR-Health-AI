import { me } from "./api/auth";

// Cached id, kept in sync by SessionProvider so non-React data helpers can read
// the current user without a round-trip. Falls back to /me when not yet known.
let cachedUserId: string | null = null;

export function setCurrentUserId(id: string | null): void {
  cachedUserId = id;
}

/** Returns the current user or null if not signed in. */
export async function getCurrentUser(): Promise<{ id: string; email?: string } | null> {
  try {
    const u = await me();
    cachedUserId = u.id;
    return { id: u.id, email: u.email };
  } catch {
    return null;
  }
}

/** Returns the current user's ID or throws "Not authenticated." */
export async function getCurrentUserId(): Promise<string> {
  if (cachedUserId) return cachedUserId;
  const u = await me();
  cachedUserId = u.id;
  return u.id;
}
