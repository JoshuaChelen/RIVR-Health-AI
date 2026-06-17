import { api, ApiError } from "./client";

// --- profile -----------------------------------------------------------------
export function getProfile(): Promise<any> {
  return api.get("/api/profile");
}
export function updateProfile(patch: Record<string, unknown>): Promise<any> {
  return api.patch("/api/profile", patch);
}
export function linkHealth(): Promise<any> {
  return api.post("/api/profile/link-health");
}
export function unlinkHealth(): Promise<any> {
  return api.post("/api/profile/unlink-health");
}
export function getAvatar(): Promise<{ avatar_path: string; url: string | null }> {
  return api.get("/api/profile/avatar");
}
export function uploadAvatar(image: unknown): Promise<{ avatar_path: string; url: string | null }> {
  const form = new FormData();
  form.append("image", image as Blob);
  return api.upload("/api/profile/avatar", form);
}
// Remove the avatar via DELETE so the stored object is reclaimed; a PATCH that
// just blanks avatar_path leaves the file orphaned in object storage.
export function deleteAvatar(): Promise<void> {
  return api.del<void>("/api/profile/avatar");
}
// Permanently delete the current user (DELETE /api/account → 204). Routed
// through the api client so the JWT auth header + token refresh are applied.
export function deleteAccount(): Promise<void> {
  return api.del<void>("/api/account");
}
export function confirmAiItem(itemId: string): Promise<any> {
  return api.post(`/api/profile/ai-items/${itemId}/confirm`);
}
export function rejectAiItem(itemId: string): Promise<any> {
  return api.post(`/api/profile/ai-items/${itemId}/reject`);
}
export function editAiItem(itemId: string, patch: Record<string, unknown>): Promise<any> {
  return api.patch(`/api/profile/ai-items/${itemId}`, patch);
}
export function getAiItemSources(itemId: string): Promise<{ sources: { document_id: string; title: string }[] }> {
  return api.get(`/api/profile/ai-items/${itemId}/sources`);
}
export function unrejectAiItem(field: string, key: string): Promise<{ field: string; key: string; restored: boolean }> {
  return api.post("/api/profile/ai-items/unreject", { field, key });
}

// --- health ------------------------------------------------------------------
export async function getHealthProfile(): Promise<any | null> {
  try {
    return await api.get("/api/health-profile");
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) return null;
    throw e;
  }
}
export async function getLatestEvaluation(): Promise<any | null> {
  const data = await api.get<{ results: any[] }>("/api/health-evaluations/?limit=1");
  return data.results[0] ?? null;
}

// --- documents ---------------------------------------------------------------
export function listDocuments(query = ""): Promise<{ count: number; results: any[] }> {
  return api.get(`/api/documents/${query}`);
}
export function uploadDocument(file: unknown, sourceType: string, title?: string): Promise<any> {
  const form = new FormData();
  form.append("file", file as Blob);
  form.append("source_type", sourceType);
  if (title) form.append("title", title);
  return api.upload("/api/documents/upload/", form);
}
export function deleteDocument(id: string): Promise<unknown> {
  return api.del(`/api/documents/${id}/`);
}
export function getDocumentAnalysis(id: string): Promise<any> {
  return api.get(`/api/documents/${id}/analysis/`);
}
export function getDocumentFile(id: string): Promise<{ url: string | null }> {
  return api.get(`/api/documents/${id}/file/`);
}
export function detachDocument(id: string): Promise<{ removed: Record<string, number>; kept_shared: Record<string, number> }> {
  return api.post(`/api/documents/${id}/detach/`);
}
export function reprocessDocument(id: string): Promise<{ jobId: string; reused: boolean }> {
  return api.post(`/api/documents/${id}/reprocess/`);
}
export function confirmAllDocument(id: string): Promise<{ confirmed: number }> {
  return api.post(`/api/documents/${id}/confirm-all/`);
}

// --- jobs --------------------------------------------------------------------
export async function enqueueDocumentProcessing(documentIds: string[]): Promise<string> {
  const data = await api.post<{ jobId: string }>("/api/jobs/enqueue", { documentIds });
  return data.jobId;
}
export async function enqueueProfileEvaluation(): Promise<string> {
  const data = await api.post<{ jobId: string }>("/api/jobs/enqueue", { jobType: "profile_evaluation" });
  return data.jobId;
}
export function listJobs(query = ""): Promise<{ count: number; results: any[] }> {
  return api.get(`/api/ai-jobs/${query}`);
}
export function cancelJob(id: string): Promise<any> {
  return api.post(`/api/ai-jobs/${id}/cancel/`);
}

// --- timeline ----------------------------------------------------------------
export function listTimeline(query = ""): Promise<{ count: number; results: any[] }> {
  return api.get(`/api/timeline-events/${query}`);
}
export function getTimelineEvent(id: string): Promise<any> {
  return api.get(`/api/timeline-events/${id}/`);
}
export function updateTimelineEvent(id: string, patch: Record<string, unknown>): Promise<any> {
  return api.patch(`/api/timeline-events/${id}/`, patch);
}
export function createTimelineEvents(events: unknown[]): Promise<any> {
  return api.post("/api/timeline-events/", events);
}
export function deleteTimelineEvent(id: string): Promise<unknown> {
  return api.del(`/api/timeline-events/${id}/`);
}

// --- shares / qa -------------------------------------------------------------
export function createShare(shareTypes: string[], pin?: string): Promise<{ shareUrl: string; expiresAt: string }> {
  return api.post("/api/shares", { shareTypes, pin });
}
export type QaTurn = { role: "user" | "assistant"; content: string };
export function askHealthQuestion(
  question: string,
  history: QaTurn[] = [],
): Promise<{ answer: string; sources: any[] }> {
  return api.post("/api/qa", { question, history });
}
