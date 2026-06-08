// src/lib/aiJobs.ts
import {
  cancelJob,
  enqueueDocumentProcessing as enqueueDocumentProcessingApi,
  enqueueProfileEvaluation as enqueueProfileEvaluationApi,
  getHealthProfile as getHealthProfileApi,
  getLatestEvaluation as getLatestEvaluationApi,
  listDocuments,
  listJobs,
} from "./api/data";

export async function enqueueDocumentProcessing(documentIds: string[]): Promise<string> {
  return enqueueDocumentProcessingApi(documentIds);
}

/**
 * Enqueue a profile-only health evaluation. The worker evaluates the user's
 * manually entered profile data alongside any previously processed document
 * facts. The server reuses an existing queued/running evaluation if present.
 */
export async function enqueueProfileEvaluation(): Promise<string> {
  return enqueueProfileEvaluationApi();
}

export async function getHealthProfile(_userId?: string) {
  return getHealthProfileApi();
}

export async function getLatestEvaluation(_userId?: string) {
  return getLatestEvaluationApi();
}

// NEW: your HealthSummaryScreen needs these
export async function getLatestJob(_userId?: string) {
  const result = await listJobs("?limit=1&ordering=-created_at");
  return result.results[0] ?? null;
}

export async function getAllDocumentIds(_userId?: string): Promise<string[]> {
  const result = await listDocuments("?limit=1000&ordering=-created_at");
  return result.results.map((r: { id: string }) => String(r.id));
}

export async function requestCancelJob(jobId: string): Promise<void> {
  await cancelJob(jobId);
}

export async function startAiJob(documentIds: string[]) {
  return enqueueDocumentProcessing(documentIds);
}
