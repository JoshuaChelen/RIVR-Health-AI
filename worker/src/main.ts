// worker/src/main.ts
import "dotenv/config";
import os from "os";
import pLimit from "p-limit";
import { supabaseAdmin } from "./supabaseAdmin";
import { extractPdfText, capText } from "./pdfText";
import { extractDocumentFacts, evaluateUserHealth, transcribeAudioBuffer } from "./ai";
import { getAppleHealthSnapshot } from "./appleHealth";
import { renderPdfToPngPages } from "./pdfOcr";
import { ocrPngPagesToText } from "./ai";
import {
  buildManualProfileContext,
  buildAiBackfilledContext,
  getManuallyEnteredFields,
  type ManualProfileContext,
  type AiBackfilledContext,
  type UserProfileRow,
} from "./profileContext";
import {
  extractBackfillCandidates,
  computeBackfillPatch,
  computeSuppressedKeys,
  filterDocFactsBySuppression,
  type AiBackfillMeta,
  type SuppressedKeys,
} from "./profileBackfill";
import type { HealthEvaluation } from "./schemas";

const BUCKET = process.env.SUPABASE_STORAGE_BUCKET || "documents";
const POLL_MS = Number(process.env.WORKER_POLL_MS || 1500);
const MAX_DOCS_PER_JOB = Number(process.env.MAX_DOCS_PER_JOB || 10);
const DOC_TIMELINE_SOURCE = "document_ai";

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
function nowIso() {
  return new Date().toISOString();
}

// ─── Cancellation ─────────────────────────────────────────────────────────────

class CancellationError extends Error {
  constructor() {
    super("Job cancelled by user");
    this.name = "CancellationError";
  }
}

async function checkCancelled(jobId: string, ac: AbortController): Promise<void> {
  const { data } = await supabaseAdmin
    .from("ai_jobs")
    .select("cancel_requested, status")
    .eq("id", jobId)
    .single();

  if (data?.cancel_requested || data?.status === "cancelled") {
    ac.abort();
    throw new CancellationError();
  }
}

// ─── Stale job recovery ──────────────────────────────────────────────────────

const STALE_THRESHOLD_MS = 30 * 60 * 1000; // 30 minutes

async function recoverStaleJobs(): Promise<void> {
  const cutoff = new Date(Date.now() - STALE_THRESHOLD_MS).toISOString();

  const { data: staleJobs, error } = await supabaseAdmin
    .from("ai_jobs")
    .select("id, user_id, document_ids")
    .eq("status", "processing")
    .lt("updated_at", cutoff);

  if (error) {
    console.error("[worker] recoverStaleJobs query failed", error.message);
    return;
  }

  if (!staleJobs || staleJobs.length === 0) return;

  for (const job of staleJobs) {
    console.warn("[worker] Recovered stale job:", job.id);

    await supabaseAdmin
      .from("ai_jobs")
      .update({
        status: "failed",
        error: "Job timed out — worker may have crashed. You can retry.",
        updated_at: nowIso(),
        locked_at: null,
        locked_by: null,
      })
      .eq("id", job.id);

    // Reset any documents stuck in 'processing' back to 'uploaded'
    const docIds = Array.isArray(job.document_ids) ? job.document_ids : [];
    if (docIds.length > 0) {
      await supabaseAdmin
        .from("documents")
        .update({ status: "uploaded", processing_error: null, updated_at: nowIso() })
        .eq("user_id", job.user_id)
        .in("id", docIds)
        .eq("status", "processing");
    }
  }

  console.log(`[worker] Recovered ${staleJobs.length} stale job(s)`);
}

// ─── Job helpers ──────────────────────────────────────────────────────────────

async function claimJob() {
  const workerId = `${os.hostname()}:${process.pid}`;
  try {
    const { data, error } = await supabaseAdmin.rpc("claim_ai_job", { p_worker_id: workerId });
    if (error) throw error;
    if (!data || data.length === 0) return null;
    return data[0];
  } catch (e: any) {
    console.error("[worker] claimJob failed", e?.message || e);
    throw e;
  }
}

async function logEvent(jobId: string, level: "debug" | "info" | "warn" | "error", message: string, data?: any) {
  await supabaseAdmin.from("ai_job_events").insert({
    job_id: jobId,
    level,
    message,
    data: data ?? null,
  });
}

async function setStage(jobId: string, stage: string, progress?: any) {
  await markJob(jobId, {
    stage,
    heartbeat_at: nowIso(),
    progress: progress ?? undefined,
    updated_at: nowIso(),
  });
}

async function markJob(jobId: string, patch: any) {
  try {
    const { error } = await supabaseAdmin.from("ai_jobs").update(patch).eq("id", jobId);
    if (error) throw error;
  } catch (e: any) {
    console.error("[worker] markJob failed", { jobId, patch, error: e?.message || e });
    throw e;
  }
}

async function uploadJson(path: string, obj: any) {
  const json = JSON.stringify(obj, null, 2);
  const blob = new Blob([json], { type: "application/json" });

  const { error } = await supabaseAdmin.storage
    .from(BUCKET)
    .upload(path, blob, { upsert: true, contentType: "application/json" });

  if (error) throw error;
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) {
    throw new CancellationError();
  }
}

async function downloadFile(storagePath: string): Promise<Buffer> {
  try {
    const { data, error } = await supabaseAdmin.storage.from(BUCKET).download(storagePath);
    if (error || !data) throw error || new Error("download failed");
    const ab = await data.arrayBuffer();
    return Buffer.from(ab);
  } catch (e: any) {
    console.error("[worker] downloadFile failed", { storagePath, error: e?.message || e });
    throw e;
  }
}

async function updateDocument(docId: string, userId: string, patch: any) {
  const { error } = await supabaseAdmin
    .from("documents")
    .update(patch)
    .eq("id", docId)
    .eq("user_id", userId);
  if (error) throw error;
}

function normalizeDate(ev: any): { occurred_at: string; date_precision: "day" | "month" | "year" } | null {
  const dp = ev?.date_precision;
  const raw = String(ev?.occurred_at ?? "").trim();

  // Accept YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return { occurred_at: raw, date_precision: (dp ?? "day") };

  // Accept YYYY-MM
  if (/^\d{4}-\d{2}$/.test(raw)) return { occurred_at: `${raw}-01`, date_precision: "month" };

  // Accept YYYY
  if (/^\d{4}$/.test(raw)) return { occurred_at: `${raw}-01-01`, date_precision: "year" };

  return null;
}

async function replaceDocTimelineEvents(
  userId: string,
  docId: string,
  events: any[],
) {
  await supabaseAdmin
    .from("timeline_events")
    .delete()
    .eq("user_id", userId)
    .eq("document_id", docId)
    .eq("source", DOC_TIMELINE_SOURCE);

  const safeEvents = (events || [])
    .map((ev) => {
      // If no date can be inferred, persist null. The Timeline UI surfaces
      // these as "Unknown date" and lets the user fill them in.
      const normalized = normalizeDate(ev);

      const occurred_at = normalized?.occurred_at ?? null;
      const date_precision = normalized?.date_precision ?? null;

      // turn data_kv into an object for jsonb
      const kv = Array.isArray(ev?.data_kv) ? ev.data_kv : [];
      const dataObj = Object.fromEntries(
        kv
          .filter((p: any) => p && typeof p.key === "string")
          .map((p: any) => [String(p.key), String(p.value ?? "")])
      );

      return {
        user_id: userId,
        document_id: docId,
        occurred_at,
        date_precision,
        title: String(ev?.title || "Medical event"),

        // DB requires NOT NULL
        event_type: String(ev?.event_type || "other"),
        category: String(ev?.category || "general"),
        source: String(ev?.source || DOC_TIMELINE_SOURCE),

        summary: String(ev?.summary || ""),

        // DB tags is NOT NULL array
        tags: Array.isArray(ev?.tags) ? ev.tags.map(String) : [],

        // DB data is NOT NULL jsonb
        data: dataObj,

        // keep your behavior
        included_in_previsit: false,
      };
    })
    .filter(Boolean);

  if (!safeEvents.length) return;

  const { error } = await supabaseAdmin.from("timeline_events").insert(safeEvents);
  if (error) throw error;
}

// ─── Profile helpers ───────────────────────────────────────────────────────────

/**
 * Fetch the user's profile row from user_profiles.
 * Returns null if the row does not exist or if there is a DB error (non-fatal).
 */
type RawProfileRow = UserProfileRow & {
  emergency_contact_name?: string | null;
  emergency_contact_phone?: string | null;
  ai_backfill_meta?: AiBackfillMeta | null;
};

async function fetchUserProfile(userId: string): Promise<RawProfileRow | null> {
  const { data, error } = await supabaseAdmin
    .from("user_profiles")
    .select(
      "first_name, last_name, date_of_birth, sex_or_gender," +
      "occupation, marital_status, number_of_children," +
      "smoking_status, alcohol_use, exercise_level," +
      "current_symptoms," +
      "allergies, medications, medical_history," +
      "surgical_history, family_history, hospitalizations, social_history," +
      "story_answers," +
      "emergency_contact_name, emergency_contact_phone," +
      "ai_backfill_meta"
    )
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    console.warn("[worker] fetchUserProfile error:", error.message);
    return null;
  }
  return data as RawProfileRow | null;
}

/**
 * Merge manually entered profile values into the AI-generated card.
 *
 * Manual values always win for allergies, medications, and emergency contact
 * because those come directly from the patient and are more reliable than
 * AI extraction from scanned documents.
 */
function mergeCardWithProfile(
  aiCard: HealthEvaluation["three_by_five_card"],
  manualCtx: ManualProfileContext,
  rawProfile: {
    emergency_contact_name?: string | null;
    emergency_contact_phone?: string | null;
    // Used to detect explicit field-clearing: if the user has a profile row and
    // raw array is empty, they deleted all items — clear the card field too.
    allergies?: unknown[] | null;
    medications?: unknown[] | null;
  } | null
): HealthEvaluation["three_by_five_card"] {
  const merged = { ...aiCard };

  // Allergies: user profile is the authoritative source.
  // - If the user has manual entries, write those into the card.
  // - If the user has a profile row and the raw array is truly empty (they
  //   deleted everything), actively clear the card field.
  // - If the raw array contains only AI-backfilled items (id starts with
  //   "ai_") but no manual entries, the user never deleted anything — keep
  //   the AI card's value so document-extracted data is preserved.
  // - If there is no profile row at all, leave the AI card's value untouched.
  if (manualCtx.allergies && manualCtx.allergies.length > 0) {
    merged.allergies = manualCtx.allergies.map((a) => {
      const parts = [a.allergen];
      if (a.reaction) parts.push(a.reaction);
      if (a.severity) parts.push(a.severity);
      return parts.join(" — ");
    });
  } else if (rawProfile !== null) {
    const rawAllergies = Array.isArray(rawProfile.allergies) ? rawProfile.allergies : [];
    const hasOnlyAiItems = rawAllergies.length > 0 && rawAllergies.every(
      (a: any) => typeof a.id === "string" && a.id.startsWith("ai_")
    );
    // Only clear when the user genuinely has zero entries (deliberate deletion).
    // If there are AI-backfilled items but no manual ones, the user didn't
    // delete anything — preserve the AI card's extracted values.
    if (!hasOnlyAiItems) {
      merged.allergies = [];
    }
  }

  // Medications: same authoritative-source rule as allergies above.
  if (manualCtx.medications && manualCtx.medications.length > 0) {
    merged.current_meds = manualCtx.medications.map((m) => {
      const detail = [m.dose, m.frequency].filter(Boolean).join(", ");
      return detail ? `${m.name} (${detail})` : m.name;
    });
  } else if (rawProfile !== null) {
    const rawMeds = Array.isArray(rawProfile.medications) ? rawProfile.medications : [];
    const hasOnlyAiMeds = rawMeds.length > 0 && rawMeds.every(
      (m: any) => typeof m.id === "string" && m.id.startsWith("ai_")
    );
    if (!hasOnlyAiMeds) {
      merged.current_meds = [];
    }
  }

  // Emergency contact: use profile if present (not in ManualProfileContext
  // by design, so we read it from the raw row directly)
  const ecName = rawProfile?.emergency_contact_name?.trim();
  const ecPhone = rawProfile?.emergency_contact_phone?.trim();
  if (ecName) {
    merged.emergency_contact = {
      name: ecName,
      phone: ecPhone || merged.emergency_contact?.phone || null,
    };
  }

  return merged;
}

/**
 * Returns true when there is enough data to warrant an OpenAI evaluation call.
 * Prevents wasting API credits when the user has truly nothing to evaluate yet.
 */
function hasAnyEvaluatableData(
  docFacts: any[],
  appleHealth: { steps_avg_7d: number | null; sleep_avg_min_7d: number | null; resting_hr_recent: number | null },
  manualCtx: ManualProfileContext,
  backfilledCtx: AiBackfilledContext | null
): boolean {
  if (docFacts.length > 0) return true;
  if (
    appleHealth.steps_avg_7d != null ||
    appleHealth.sleep_avg_min_7d != null ||
    appleHealth.resting_hr_recent != null
  ) return true;
  if (manualCtx._has_clinical_data) return true;
  if (manualCtx.lifestyle) return true;
  if (manualCtx.story_context && manualCtx.story_context.length > 0) return true;
  if (backfilledCtx) return true;
  // A profile with at least age or sex/gender is sufficient — the evaluation can
  // produce a meaningful stub and ask the user to fill in more data.
  if (
    manualCtx.demographics.age_years != null ||
    manualCtx.demographics.sex_or_gender
  ) return true;
  return false;
}

// ─── Main job processor ────────────────────────────────────────────────────────

async function processJob(job: any) {
  const jobId = job.id as string;
  const userId = job.user_id as string;
  const jobType: string = job.job_type ?? "process_documents";
  const isProfileOnly = jobType === "profile_evaluation";

  // For profile_evaluation jobs triggered by the user clicking "Process" on
  // their Manual Health Profile card, document_ids contains the manual doc row
  // IDs. These are used for logging, marking docs processed on success, and
  // reverting them on cancellation. Background evals (from basic-profile saves)
  // have document_ids = [] and skip all per-document operations.
  const manualDocIds: string[] = isProfileOnly && Array.isArray(job.document_ids)
    ? (job.document_ids as string[]).filter(Boolean)
    : [];

  // One AbortController per job — shared across all concurrent document tasks
  const abortController = new AbortController();
  const { signal } = abortController;

  const cancelTimer = setInterval(async () => {
    try {
      const { data } = await supabaseAdmin
        .from("ai_jobs")
        .select("cancel_requested, status")
        .eq("id", jobId)
        .single();

      if (data?.cancel_requested || data?.status === "cancelled") {
        abortController.abort();
      }
    } catch {}
  }, 1000);

  try {
    await markJob(jobId, {
      status: "running",
      stage: "started",
      heartbeat_at: nowIso(),
      updated_at: nowIso(),
    });
    await logEvent(jobId, "info", "Job started", { userId, jobType });

    // [1] First cancellation check — before any document work begins
    await checkCancelled(jobId, abortController);

    // ── Document extraction (process_documents jobs only) ──────────────────────
    // profile_evaluation jobs skip this entire block.

    let docFacts: any[] = [];
    let limitedDocIds: string[] = [];

    if (!isProfileOnly) {
      const docIds: string[] = Array.isArray(job.document_ids) ? job.document_ids : [];
      limitedDocIds = docIds.slice(0, MAX_DOCS_PER_JOB);

      await setStage(jobId, "fetching_documents", { total: limitedDocIds.length, done: 0 });
      await logEvent(jobId, "info", "fetching_documents", { userId });
      if (limitedDocIds.length === 0) {
        await markJob(jobId, {
          status: "failed",
          error: "No document_ids on job.",
          updated_at: nowIso(),
          locked_at: null,
          locked_by: null,
        });
        return;
      }

      const { data: docs, error: docsErr } = await supabaseAdmin
        .from("documents")
        .select("id,user_id,title,pdf_path,mime_type,status,source_type,created_at")
        .eq("user_id", userId)
        .in("id", limitedDocIds);

      if (docsErr || !docs) throw docsErr || new Error("Failed to fetch documents");

      // Guard: manual_input docs must never be processed as file documents.
      // They should always be routed to profile_evaluation by the edge function.
      // If one ends up here (e.g. via old deployed edge function), revert it to
      // 'uploaded' and exclude it from this job so it can be re-queued correctly.
      const manualInputDocs = docs.filter((d) => d.source_type === "manual_input");
      const fileDocs = docs.filter((d) => d.source_type !== "manual_input");

      if (manualInputDocs.length > 0) {
        await logEvent(jobId, "warn", "manual_input docs found in process_documents job — reverting to uploaded (re-queue via profile_evaluation)", {
          ids: manualInputDocs.map((d) => d.id),
        });
        await Promise.all(
          manualInputDocs.map((d) =>
            updateDocument(d.id, userId, {
              status: "uploaded",
              processing_error: "Routed incorrectly to process_documents. Re-queue via Process button.",
              updated_at: nowIso(),
            })
          )
        );
      }

      if (fileDocs.length === 0) {
        await markJob(jobId, {
          status: "failed",
          error: "No processable file documents found (all were manual_input — use profile_evaluation instead).",
          updated_at: nowIso(),
          locked_at: null,
          locked_by: null,
        });
        return;
      }

      await logEvent(jobId, "info", "supabaseAdmin", { userId });
      // mark file docs processing
      await Promise.all(fileDocs.map((d) => updateDocument(d.id, userId, { status: "processing" })));

      const limit = pLimit(2);

      await logEvent(jobId, "info", "const docFacts = await Promise.all(", { userId });

      docFacts = await Promise.all(
        fileDocs.map((d, idx) =>
          limit(async () => {
            const storagePath = String(d.pdf_path || "");
            const docId = String(d.id);

            // [2a] Before download
            await checkCancelled(jobId, abortController);

            await setStage(jobId, "downloading_file", {
              total: fileDocs.length,
              done: idx,
              currentDocId: docId,
            });
            await logEvent(jobId, "info", "Downloading file", { docId });

            if (!storagePath) {
              const fallback = {
                document_id: docId,
                title: d.title ?? null,
                key_facts: {
                  blood_type: null,
                  allergies: [],
                  medications: [],
                  conditions: [],
                  surgeries_procedures: [],
                  implants_devices: [],
                  key_labs_vitals: [],
                  extra_notes: ["No pdf_path found on document row."],
                },
                timeline_events: [],
                confidence_0_to_1: 0.1,
              };

              const summaryPath = `${userId}/processed/${docId}/summary.json`;
              await uploadJson(summaryPath, fallback);
              await updateDocument(docId, userId, {
                status: "processed",
                summary_path: summaryPath,
                processed_at: nowIso(),
                processing_error: null,
                updated_at: nowIso(),
              });

              await setStage(jobId, "document_done", {
                total: fileDocs.length,
                done: idx + 1,
                currentDocId: docId,
              });

              return fallback;
            }

            try {
              const buf = await downloadFile(storagePath);
              throwIfAborted(signal);

              const mime = d.mime_type ? String(d.mime_type) : null;
              const isAudio = !!mime && mime.toLowerCase().startsWith("audio/");

              let rawText = "";

              if (isAudio) {
                await setStage(jobId, "transcribing_audio", {
                  total: fileDocs.length,
                  done: idx,
                  currentDocId: docId,
                });
                await logEvent(jobId, "info", "Transcribing audio", { docId, mime });

                rawText = await transcribeAudioBuffer(buf, mime);
                throwIfAborted(signal);
                rawText = rawText || "[No transcript text found. The audio may be empty or unclear.]";

              } else {
                await setStage(jobId, "extracting_text", {
                  total: fileDocs.length,
                  done: idx,
                  currentDocId: docId,
                });

                rawText = await extractPdfText(buf);
                throwIfAborted(signal);
                rawText = (rawText || "").trim();

                // OCR fallback if the extracted text is basically empty
                const OCR_MIN_CHARS = Number(process.env.OCR_MIN_CHARS || 200);
                const OCR_MAX_PAGES = Number(process.env.OCR_MAX_PAGES || 10);

                if (rawText.length < OCR_MIN_CHARS) {
                  // [2b] Before expensive OCR render
                  await checkCancelled(jobId, abortController);

                  await setStage(jobId, "ocr_pdf", { total: fileDocs.length, done: idx, currentDocId: docId });
                  await logEvent(jobId, "info", "PDF text looks empty, running OCR fallback", {
                    docId,
                    extractedChars: rawText.length,
                    maxPages: OCR_MAX_PAGES,
                  });

                  const pages = await renderPdfToPngPages(buf, OCR_MAX_PAGES);
                  throwIfAborted(signal);

                  const ocrText = (await ocrPngPagesToText(pages)).trim();
                  throwIfAborted(signal);

                  if (ocrText) {
                    rawText = rawText ? `${rawText}\n\n[OCR TEXT]\n${ocrText}` : ocrText;
                  }
                }

                if (!rawText) {
                  rawText = "[No extractable text found. This may be a scanned PDF.]";
                }
              }

              const capped = capText(rawText, 180_000);

              // [2c] Before OpenAI extract call (most expensive)
              await checkCancelled(jobId, abortController);

              await setStage(jobId, "openai_extract", {
                total: fileDocs.length,
                done: idx,
                currentDocId: docId,
              });
              await logEvent(jobId, "info", "Calling OpenAI extract", { docId, isAudio });

              const facts = await extractDocumentFacts({
                document_id: docId,
                title: d.title ?? null,
                text: isAudio ? `VOICE NOTE TRANSCRIPT:\n${capped}` : capped,
                signal,
              });
              throwIfAborted(signal);

              const summaryPath = `${userId}/processed/${docId}/summary.json`;
              await uploadJson(summaryPath, facts);

              // [2d] Before FK-sensitive timeline_events write — fixes the FK violation bug
              await checkCancelled(jobId, abortController);

              await replaceDocTimelineEvents(
                userId,
                docId,
                Array.isArray(facts.timeline_events) ? facts.timeline_events : [],
              );

              // [2e] Before marking doc complete
              await checkCancelled(jobId, abortController);

              await updateDocument(docId, userId, {
                status: "processed",
                summary_path: summaryPath,
                processed_at: nowIso(),
                processing_error: null,
                updated_at: nowIso(),
              });

              await setStage(jobId, "document_done", {
                total: fileDocs.length,
                done: idx + 1,
                currentDocId: docId,
              });

              return facts;
            } catch (e: any) {
              // Propagate cancellation without touching doc status — the cancellation
              // handler in main() will revert still-processing docs to 'uploaded'.
              if (e instanceof CancellationError || e?.name === "AbortError") {
                await setStage(jobId, "safe_quitting", {
                  total: fileDocs.length,
                  done: idx,
                  currentDocId: docId,
                });
                throw new CancellationError();
              }
              await updateDocument(docId, userId, {
                status: "failed",
                processing_error: String(e?.message || e),
                updated_at: nowIso(),
              });
              throw e;
            }
          })
        )
      );
    } // end !isProfileOnly document block

    // ── Common tail: runs for both job types ───────────────────────────────────

    const appleHealth = await getAppleHealthSnapshot(userId);

    // Fetch all previously processed document summaries for this user so the
    // evaluation reflects the full health history, not just the current job.
    // For profile_evaluation, limitedDocIds is [] so no exclusion filter is needed.
    const histBaseQuery = supabaseAdmin
      .from("documents")
      .select("id, summary_path")
      .eq("user_id", userId)
      .eq("status", "processed")
      .neq("source_type", "manual_input")   // manual-input facts come from user_profiles directly
      .not("summary_path", "is", null);

    const { data: allProcessedDocs } = await (
      limitedDocIds.length > 0
        ? histBaseQuery.not("id", "in", `(${limitedDocIds.map((id) => `"${id}"`).join(",")})`)
        : histBaseQuery
    );

    const historicalFacts: any[] = [];

    if (allProcessedDocs && allProcessedDocs.length > 0) {
      await Promise.all(
        allProcessedDocs.map(async (row) => {
          try {
            const buf = await downloadFile(String(row.summary_path));
            const parsed = JSON.parse(buf.toString("utf8"));
            if (parsed) historicalFacts.push(parsed);
          } catch {
            // skip unreadable summaries rather than failing the whole job
          }
        })
      );
    }

    const allDocFactsRaw = [...historicalFacts, ...docFacts];

    // ── Load manual profile ────────────────────────────────────────────────────

    await setStage(jobId, "loading_manual_profile");
    await logEvent(jobId, "info", "Loading manual profile", { userId });

    const rawProfile = await fetchUserProfile(userId);
    const manualCtx: ManualProfileContext = rawProfile
      ? buildManualProfileContext(rawProfile)
      : { demographics: {}, _source: "user_profiles", _has_clinical_data: false };
    // Items AI-backfilled into user_profiles in prior runs. Separated so they
    // are never presented to the model as patient-verified ground truth.
    const backfilledCtx: AiBackfilledContext | null = rawProfile
      ? buildAiBackfilledContext(rawProfile)
      : null;

    // ── Suppression: filter user-deleted AI items from doc facts ──────────────
    // If the user deleted an AI-backfilled allergy/medication/condition/procedure
    // from their profile, its normalized key is in ai_backfill_meta.added_keys but
    // absent from the current array. We filter those keys out of every DocumentFacts
    // payload so the item cannot resurface in evaluations, risk flags, or the 3×5 card.
    const suppressedKeys: SuppressedKeys = computeSuppressedKeys(rawProfile ?? {});
    const allDocFacts = filterDocFactsBySuppression(allDocFactsRaw, suppressedKeys);

    const suppressedTotal =
      suppressedKeys.allergies.size +
      suppressedKeys.medications.size +
      suppressedKeys.conditions.size +
      suppressedKeys.surgeries.size;

    await logEvent(jobId, "info", "Manual profile context built", {
      hasClinicalData:        manualCtx._has_clinical_data,
      hasLifestyle:           !!manualCtx.lifestyle,
      hasSymptoms:            !!manualCtx.current_symptoms,
      storyAnswers:           manualCtx.story_context?.length        ?? 0,
      manualAllergies:        manualCtx.allergies?.length            ?? 0,
      manualMedications:      manualCtx.medications?.length          ?? 0,
      manualConditions:       manualCtx.medical_history?.length      ?? 0,
      manualSurgeries:        manualCtx.surgical_history?.length     ?? 0,
      manualFamilyHistory:    manualCtx.family_history?.length       ?? 0,
      manualHospitalizations: manualCtx.hospitalizations?.length     ?? 0,
      manualSocialHistory:    manualCtx.social_history?.length       ?? 0,
      backfilledAllergies:    backfilledCtx?.allergies?.length       ?? 0,
      backfilledMedications:  backfilledCtx?.medications?.length     ?? 0,
      backfilledConditions:   backfilledCtx?.medical_history?.length ?? 0,
      backfilledSurgeries:    backfilledCtx?.surgical_history?.length ?? 0,
      suppressedKeys:         suppressedTotal,
    });

    // ── Manual-input document processing confirmation ─────────────────────────
    // When a user taps "Process" on their Manual Health Profile card in Documents,
    // the edge function enqueues a profile_evaluation job with document_ids set to
    // the manual doc row IDs. We use those IDs directly (from job.document_ids)
    // rather than querying by status, so the log is deterministic regardless of
    // any concurrent status changes.
    if (manualDocIds.length > 0) {
      await logEvent(jobId, "info", "Processing manual-input document — reading medical profile data", {
        documentIds: manualDocIds,
        allergies:        manualCtx.allergies?.length ?? 0,
        medications:      manualCtx.medications?.length ?? 0,
        conditions:       manualCtx.medical_history?.length ?? 0,
        surgeries:        manualCtx.surgical_history?.length ?? 0,
        familyHistory:    manualCtx.family_history?.length ?? 0,
        hospitalizations: manualCtx.hospitalizations?.length ?? 0,
        socialHistory:    manualCtx.social_history?.length ?? 0,
        hasSymptoms:      !!manualCtx.current_symptoms,
        hasLifestyle:     !!manualCtx.lifestyle,
        hasClinicalData:  manualCtx._has_clinical_data,
      });
    }

    // ── Graceful fail: nothing worth evaluating ────────────────────────────────

    if (!hasAnyEvaluatableData(allDocFacts, appleHealth, manualCtx, backfilledCtx)) {
      await markJob(jobId, {
        status: "failed",
        error:
          "No evaluatable data found. Complete at least your basic profile (date of birth, sex), " +
          "or upload health documents, or connect Apple Health before running an analysis.",
        updated_at: nowIso(),
        locked_at: null,
        locked_by: null,
      });
      return;
    }

    // ── OpenAI evaluation ──────────────────────────────────────────────────────

    // [3] Before the expensive health evaluation OpenAI call
    await checkCancelled(jobId, abortController);

    await setStage(jobId, "openai_eval", {
      totalDocFacts: allDocFacts.length,
      isProfileOnly,
      hasClinicalData: manualCtx._has_clinical_data,
    });
    await logEvent(jobId, "info", "Calling OpenAI evaluation", {
      userId,
      totalFacts: allDocFacts.length,
      isProfileOnly,
      hasClinicalData: manualCtx._has_clinical_data,
      storyAnswers: manualCtx.story_context?.length ?? 0,
    });

    const evaluation = await evaluateUserHealth({
      user_id: userId,
      docFacts: allDocFacts,
      appleHealth,
      manualProfile: manualCtx,
      profileBackfill: backfilledCtx,
      signal,
    });
    throwIfAborted(signal);

    // ── Merge manual values into AI card ───────────────────────────────────────
    // Manual allergies, medications, and emergency contact always win.

    const mergedCard = mergeCardWithProfile(evaluation.three_by_five_card, manualCtx, rawProfile);

    const { data: evalRow, error: insErr } = await supabaseAdmin
      .from("health_evaluations")
      .insert({
        user_id: userId,
        score: evaluation.score_0_to_100,
        result: { ...evaluation, three_by_five_card: mergedCard },
      })
      .select("id")
      .single();

    if (insErr) throw insErr;

    const evalPath = `${userId}/ai/evaluation/latest.json`;
    await uploadJson(evalPath, { ...evaluation, three_by_five_card: mergedCard });

    // ── Save health profile ────────────────────────────────────────────────────

    // [4] Before writing the health profile
    await checkCancelled(jobId, abortController);

    await setStage(jobId, "saving_profile");
    await logEvent(jobId, "info", "Saving health profile", { userId });

    const manuallyEnteredFields = [...getManuallyEnteredFields(manualCtx)];

    const manualProfileSig = rawProfile
      ? JSON.stringify({
          date_of_birth: rawProfile?.date_of_birth ?? null,
          sex_or_gender: rawProfile?.sex_or_gender ?? null,
          current_symptoms: String(rawProfile?.current_symptoms ?? "").trim() || null,
          smoking_status: rawProfile?.smoking_status ?? null,
          alcohol_use: rawProfile?.alcohol_use ?? null,
          exercise_level: rawProfile?.exercise_level ?? null,
          allergies: Array.isArray(rawProfile?.allergies) ? rawProfile.allergies : [],
          medications: Array.isArray(rawProfile?.medications) ? rawProfile.medications : [],
          medical_history: Array.isArray(rawProfile?.medical_history) ? rawProfile.medical_history : [],
          surgical_history: Array.isArray(rawProfile?.surgical_history) ? rawProfile.surgical_history : [],
          family_history: Array.isArray(rawProfile?.family_history) ? rawProfile.family_history : [],
          hospitalizations: Array.isArray(rawProfile?.hospitalizations) ? rawProfile.hospitalizations : [],
          social_history: Array.isArray(rawProfile?.social_history) ? rawProfile.social_history : [],
        })
      : null;

    const profileRow = {
      user_id: userId,
      score: evaluation.score_0_to_100,
      score_label: evaluation.score_label,
      summary_json: {
        overview: evaluation.overview,
        highlights: evaluation.highlights,
        risk_flags: evaluation.risk_flags,
        missing_info: evaluation.missing_info,
        suggested_next_steps: evaluation.suggested_next_steps,
        recommendations: evaluation.recommendations ?? [],
        full_summary_markdown: evaluation.full_summary_markdown,
        disclaimer: evaluation.disclaimer,
      },
      card_json: mergedCard,
      sources: {
        job_type: jobType,
        document_ids: [
          ...(allProcessedDocs ?? []).map((r) => r.id),
          ...limitedDocIds,
          ...manualDocIds,
        ],
        apple_health: appleHealth,
        manual_profile: {
          has_data: !!rawProfile,
          has_clinical_data: manualCtx._has_clinical_data,
          manually_entered_fields: manuallyEnteredFields,
          signature: manualProfileSig,
        },
        evaluation_storage_path: evalPath,
        evaluation_id: evalRow?.id ?? null,
      },
      version: "profile_v2",
      updated_at: nowIso(),
    };

    const { error: profErr } = await supabaseAdmin
      .from("health_profiles")
      .upsert(profileRow, { onConflict: "user_id" });

    if (profErr) throw profErr;

    await logEvent(jobId, "info", "Health profile saved", {
      score: evaluation.score_0_to_100,
      mergedAllergies: mergedCard.allergies.length,
      mergedMeds: mergedCard.current_meds.length,
      manuallyEnteredFields,
    });

    // ── Mark manual-input documents as processed ──────────────────────────────
    // Mark exactly the manual doc rows that are linked to this job (from
    // job.document_ids) as processed. Background profile_evaluation jobs that
    // were not triggered by the Process button have manualDocIds = [], so this
    // block is skipped for them — no docs to mark.
    // Non-fatal: failure here must not fail the job.
    if (manualDocIds.length > 0) {
      try{
          await supabaseAdmin
            .from("documents")
            .update({
              status: "processed",
              processed_at: nowIso(),
              updated_at: nowIso(),
              processing_error: null,
            })
            .eq("user_id", userId)
            .in("id", manualDocIds);
        } catch (manualDocErr: any) {
        await logEvent(jobId, "warn", "Could not mark manual-input doc processed (non-fatal)", {
          error: manualDocErr?.message,
        });
      }
    }

    // ── [5] AI backfill into user_profiles ────────────────────────────────────
    // Only runs when document facts are available — profile_evaluation jobs with
    // zero docs have nothing to extract from. Non-fatal: failure here does not
    // fail the overall job.
    if (allDocFacts.length > 0) {
      await setStage(jobId, "ai_backfill");

      const candidates = extractBackfillCandidates(allDocFacts);
      const backfillResult = computeBackfillPatch(
        rawProfile ?? {},
        candidates,
        { job_id: jobId, evaluation_id: evalRow?.id ?? null }
      );

      if (backfillResult) {
        const { error: backfillErr } = await supabaseAdmin
          .from("user_profiles")
          .update(backfillResult.patch)
          .eq("user_id", userId);

        if (backfillErr) {
          // Log but do not throw — backfill failure is never a reason to fail the job.
          await logEvent(jobId, "warn", "AI backfill write failed (non-fatal)", {
            error: backfillErr.message,
          });
        } else {
          await logEvent(jobId, "info", "AI backfill applied to user_profiles", backfillResult.summary);

          // The backfill write just bumped user_profiles.updated_at to a timestamp
          // after health_profiles.updated_at. Re-touch health_profiles so it stays
          // the most recent, otherwise the staleness banner on HealthSummaryScreen
          // would fire on every successful job that triggers a backfill.
          const { error: retouchErr } = await supabaseAdmin
            .from("health_profiles")
            .update({ updated_at: nowIso() })
            .eq("user_id", userId);
          if (retouchErr) {
            // Non-fatal — a stale banner is annoying but not a data error.
            await logEvent(jobId, "warn", "Re-touch health_profiles after backfill failed (non-fatal)", {
              error: retouchErr.message,
            });
          }
        }
      } else {
        await logEvent(jobId, "info", "AI backfill: no new items to add");
      }
    }

    await markJob(jobId, {
      status: "succeeded",
      error: null,
      result: { health_profile_updated: true, evaluation_id: evalRow?.id ?? null },
      updated_at: nowIso(),
      locked_at: null,
      locked_by: null,
    });

  } finally {
    clearInterval(cancelTimer);
  }
}


async function main() {
  console.log("[worker] started");

  // Recover any jobs stuck from a previous crash before polling
  await recoverStaleJobs();

  const recoveryInterval = Math.ceil(300_000 / POLL_MS); // every ~5 minutes
  let pollCount = 0;

  while (true) {
    try {
      // Periodic stale job recovery
      if (pollCount > 0 && pollCount % recoveryInterval === 0) {
        await recoverStaleJobs();
      }
      pollCount++;

      const job = await claimJob();
      if (!job) {
        await sleep(POLL_MS);
        continue;
      }

      console.log("[worker] claimed job", job.id, "type", job.job_type, "user", job.user_id);

      try {
        await processJob(job);
        console.log("[worker] finished job", job.id);
      } catch (e: any) {
        if (e instanceof CancellationError) {
          console.log("[worker] job cancelled", job.id);
          // Mark job cancelled and revert any docs still stuck at 'processing'.
          // For profile_evaluation jobs triggered by the Process button, document_ids
          // contains the manual doc IDs and they will be reverted here.
          // Background evals (document_ids = []) make this a no-op.
          await markJob(job.id, {
            status: "cancelled",
            cancelled_at: nowIso(),
            error: null,
            updated_at: nowIso(),
            locked_at: null,
            locked_by: null,
          });
          await supabaseAdmin
            .from("documents")
            .update({ status: "uploaded", processing_error: null, updated_at: nowIso() })
            .eq("user_id", job.user_id)
            .in("id", job.document_ids)
            .eq("status", "processing");
        } else {
          console.error("[worker] job failed", job.id, e?.message || e);
          await markJob(job.id, {
            status: "failed",
            error: String(e?.message || e),
            updated_at: nowIso(),
            locked_at: null,
            locked_by: null,
          });
        }
      }
    } catch (e: any) {
      console.error("[worker] loop error", e?.message || e);
      await sleep(POLL_MS);
    }
  }
}

main().catch((e) => {
  console.error("[worker] fatal", e);
  process.exit(1);
});
