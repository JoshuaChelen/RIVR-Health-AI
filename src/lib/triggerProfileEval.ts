import { enqueueProfileEvaluation } from "./aiJobs";

/**
 * Trigger a profile evaluation after a save (story answer, profile edit, etc.).
 * Returns true if the job was successfully enqueued, false otherwise.
 */
export async function triggerProfileEvalAfterSave(): Promise<boolean> {
  try {
    await enqueueProfileEvaluation();
    return true;
  } catch {
    return false;
  }
}
