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

// ─── Job helpers ──────────────────────────────────────────────────────────────

async function claimJob() {
  const workerId = `${os.hostname()}:${process.pid}`;
  const { data, error } = await supabaseAdmin.rpc("claim_ai_job", { p_worker_id: workerId });
  if (error) throw error;
  if (!data || data.length === 0) return null;
  return data[0];
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
  const { error } = await supabaseAdmin.from("ai_jobs").update(patch).eq("id", jobId);
  if (error) throw error;
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
  const { data, error } = await supabaseAdmin.storage.from(BUCKET).download(storagePath);
  if (error || !data) throw error || new Error("download failed");
  const ab = await data.arrayBuffer();
  return Buffer.from(ab);
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
  fallbackDate: string
) {
  await supabaseAdmin
    .from("timeline_events")
    .delete()
    .eq("user_id", userId)
    .eq("document_id", docId)
    .eq("source", DOC_TIMELINE_SOURCE);

  const safeEvents = (events || [])
    .map((ev) => {
      // normalize date but do not drop if missing, DB needs NOT NULL occurred_at
      const normalized = normalizeDate(ev);

      const occurred_at = normalized?.occurred_at ?? fallbackDate;
      const date_precision = normalized?.date_precision ?? "day";

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
        occurred_at, // NOT NULL in DB
        date_precision, // NOT NULL in DB
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


async function processJob(job: any) {
  const jobId = job.id as string;
  const userId = job.user_id as string;

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
  await logEvent(jobId, "info", "Job started", { userId });

  // [1] First cancellation check — before any document work begins
  await checkCancelled(jobId, abortController);

  const docIds: string[] = Array.isArray(job.document_ids) ? job.document_ids : [];
  const limitedDocIds = docIds.slice(0, MAX_DOCS_PER_JOB);

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
    .select("id,user_id,title,pdf_path,mime_type,status,created_at")
    .eq("user_id", userId)
    .in("id", limitedDocIds);

  if (docsErr || !docs) throw docsErr || new Error("Failed to fetch documents");

  await logEvent(jobId, "info", "supabaseAdmin", { userId });
  // mark docs processing
  await Promise.all(docs.map((d) => updateDocument(d.id, userId, { status: "processing" })));

  const limit = pLimit(2);

  await logEvent(jobId, "info", "const docFacts = await Promise.all(", { userId });

const docFacts = await Promise.all(
  docs.map((d, idx) =>
    limit(async () => {
      const storagePath = String(d.pdf_path || "");
      const docId = String(d.id);

      const fallbackDate = new Date(d.created_at ?? Date.now()).toISOString().slice(0, 10);

      // [2a] Before download
      await checkCancelled(jobId, abortController);

      await setStage(jobId, "downloading_file", {
        total: docs.length,
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
          total: docs.length,
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
            total: docs.length,
            done: idx,
            currentDocId: docId,
          });
          await logEvent(jobId, "info", "Transcribing audio", { docId, mime });

          rawText = await transcribeAudioBuffer(buf, mime);
          throwIfAborted(signal);
          rawText = rawText || "[No transcript text found. The audio may be empty or unclear.]";

        } else {
          await setStage(jobId, "extracting_text", {
            total: docs.length,
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

            await setStage(jobId, "ocr_pdf", { total: docs.length, done: idx, currentDocId: docId });
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
          total: docs.length,
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
          fallbackDate
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
          total: docs.length,
          done: idx + 1,
          currentDocId: docId,
        });

        return facts;
      } catch (e: any) {
        // Propagate cancellation without touching doc status — the cancellation
        // handler in main() will revert still-processing docs to 'uploaded'.
        if (e instanceof CancellationError || e?.name === "AbortError") {
          await setStage(jobId, "safe_quitting", {
            total: docs.length,
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
const appleHealth = await getAppleHealthSnapshot(userId);

// Fetch all previously processed document summaries for this user so the
// evaluation reflects the full health history, not just the current job.
const { data: allProcessedDocs } = await supabaseAdmin
  .from("documents")
  .select("id, summary_path")
  .eq("user_id", userId)
  .eq("status", "processed")
  .not("summary_path", "is", null)
  .not("id", "in", `(${limitedDocIds.map((id) => `"${id}"`).join(",")})`);

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

const allDocFacts = [...historicalFacts, ...docFacts];

// [3] Before the expensive health evaluation OpenAI call
await checkCancelled(jobId, abortController);

await setStage(jobId, "openai_eval", { total: docs.length, done: docs.length });
await logEvent(jobId, "info", "Calling OpenAI evaluation", { userId, totalFacts: allDocFacts.length });

const evaluation = await evaluateUserHealth({
  user_id: userId,
  docFacts: allDocFacts,
  appleHealth,
  signal,
});
throwIfAborted(signal);

const { data: evalRow, error: insErr } = await supabaseAdmin
  .from("health_evaluations")
  .insert({
    user_id: userId,
    score: evaluation.score_0_to_100,
    result: evaluation,
  })
  .select("id")
  .single();

if (insErr) throw insErr;

const evalPath = `${userId}/ai/evaluation/latest.json`;
await uploadJson(evalPath, evaluation);

// [4] Before writing the health profile
await checkCancelled(jobId, abortController);

await setStage(jobId, "saving_profile", { total: docs.length, done: docs.length });

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
    full_summary_markdown: evaluation.full_summary_markdown,
    disclaimer: evaluation.disclaimer,
  },
  card_json: evaluation.three_by_five_card,
  sources: {
    document_ids: [...(allProcessedDocs ?? []).map((r) => r.id), ...limitedDocIds],
    apple_health: appleHealth,
    evaluation_storage_path: evalPath,
    evaluation_id: evalRow?.id ?? null,
  },
  version: "profile_v1",
  updated_at: nowIso(),
};

const { error: profErr } = await supabaseAdmin
  .from("health_profiles")
  .upsert(profileRow, { onConflict: "user_id" });

if (profErr) throw profErr;

await markJob(jobId, {
  status: "succeeded",
  error: null,
  result: { health_profile_updated: true, evaluation_id: evalRow?.id ?? null },
  updated_at: nowIso(),
  locked_at: null,
  locked_by: null,
});

}finally {
    clearInterval(cancelTimer);
  }
  
}



async function main() {
  console.log("[worker] started");

  while (true) {
    try {
      const job = await claimJob();
      if (!job) {
        await sleep(POLL_MS);
        continue;
      }

      console.log("[worker] claimed job", job.id, "user", job.user_id);

      try {
        await processJob(job);
        console.log("[worker] finished job", job.id);
      } catch (e: any) {
        if (e instanceof CancellationError) {
          console.log("[worker] job cancelled", job.id);
          // Mark job cancelled and revert any docs still stuck at 'processing'
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
