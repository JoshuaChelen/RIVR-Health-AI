// src/lib/aiJobs.ts
import {
  cancelJob,
  enqueueProfileEvaluation as enqueueProfileEvaluationApi,
  listJobs,
} from "./api/data";

/**
 * Enqueue a profile-only health evaluation. The worker evaluates the user's
 * manually entered profile data alongside any previously processed document
 * facts. The server reuses an existing queued/running evaluation if present.
 */
export async function enqueueProfileEvaluation(): Promise<string> {
  return enqueueProfileEvaluationApi();
}

export async function getLatestJob(_userId?: string) {
  const result = await listJobs("?limit=1&ordering=-created_at");
  return result.results[0] ?? null;
}

export async function requestCancelJob(jobId: string): Promise<void> {
  await cancelJob(jobId);
}
