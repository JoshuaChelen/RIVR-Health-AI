import { supabase } from "./supabase";

/** Returns the current user or null if not signed in. */
export async function getCurrentUser(): Promise<{ id: string; email?: string } | null> {
  const { data: { user } } = await supabase.auth.getUser();
  return user ?? null;
}

/** Returns the current user's ID or throws "Not authenticated." */
export async function getCurrentUserId(): Promise<string> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated.");
  return user.id;
}
