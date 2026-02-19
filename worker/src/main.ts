// worker/src/main.ts
import "dotenv/config";
import os from "os";
import pLimit from "p-limit";
import { supabaseAdmin } from "./supabaseAdmin";
import { extractPdfText, capText } from "./pdfText";
import { extractDocumentFacts, evaluateUserHealth } from "./ai";
import { getAppleHealthSnapshot } from "./appleHealth";

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

  await setStage(jobId, "started");
  await logEvent(jobId, "info", "Job started", { userId });
  
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
    .select("id,user_id,title,pdf_path,status,created_at")
    .eq("user_id", userId)
    .in("id", limitedDocIds);

  if (docsErr || !docs) throw docsErr || new Error("Failed to fetch documents");

  await logEvent(jobId, "info", "supabaseAdmin", { userId });
  // mark docs processing
  await Promise.all(docs.map((d) => updateDocument(d.id, userId, { status: "processing" })));

  const limit = pLimit(2);

  await logEvent(jobId, "info", "const docFacts = await Promise.all(", { userId });
// ... inside processJob function ...

const docFacts = await Promise.all(
  docs.map((d) =>
    limit(async () => {
      const pdfPath = String(d.pdf_path || "");
      const docId = d.id as string;
      
      // FIX: Define fallbackDate here at the top of the block
      const fallbackDate = new Date(d.created_at ?? Date.now()).toISOString().slice(0, 10);

      await setStage(jobId, "downloading_pdf", { total: docs.length, done: -1, currentDocId: docId });
      await logEvent(jobId, "info", "Downloading PDF", { docId });

      if (!pdfPath) {
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
        await updateDocument(docId, userId, { status: "processed", summary_path: summaryPath });
        return fallback;
      }

      try {
        const buf = await downloadFile(pdfPath);
        await setStage(jobId, "extracting_text", { total: docs.length, done: -2, currentDocId: docId });

        const rawText = await extractPdfText(buf);
        const safeText = rawText || "[No extractable text found. This may be a scanned PDF.]";
        const capped = capText(safeText, 180_000);

        await setStage(jobId, "openai_extract", { total: docs.length, done: -3, currentDocId: docId });
        await logEvent(jobId, "info", "Calling OpenAI extract", { docId });

        const facts = await extractDocumentFacts({
          document_id: docId,
          title: d.title ?? null,
          text: capped,
        });

        const summaryPath = `${userId}/processed/${docId}/summary.json`;
        await uploadJson(summaryPath, facts);

        // CLEANED UP: Use the fallbackDate defined at the top
        await replaceDocTimelineEvents(
          userId,
          docId,
          Array.isArray(facts.timeline_events) ? facts.timeline_events : [],
          fallbackDate
        );

        await updateDocument(docId, userId, {
          status: "processed",
          summary_path: summaryPath,
          processed_at: nowIso(),
          processing_error: null,
          updated_at: nowIso(),
        });

        await setStage(jobId, "saving_results", { total: docs.length, done: -4, currentDocId: docId });
        await setStage(jobId, "document_done", { total: docs.length, done: -5, currentDocId: docId });
        
        return facts;
      } catch (e: any) {
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

  const evaluation = await evaluateUserHealth({
    user_id: userId,
    docFacts,
    appleHealth,
  });

  const { data: evalRow, error: insErr } = await supabaseAdmin
  .from("health_evaluations")
  .insert({
    user_id: userId,
    score: evaluation.score_0_to_100,
    result: evaluation,
  })
  .select("id")
  .single();

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
    document_ids: limitedDocIds,
    apple_health: appleHealth,
    evaluation_storage_path: `${userId}/ai/evaluation/latest.json`,
    evaluation_id: evalRow?.id ?? null,
  },
  version: "profile_v1",
  updated_at: nowIso(),
};

const evalPath = `${userId}/ai/evaluation/latest.json`;
await uploadJson(evalPath, evaluation);

const { error: profErr } = await supabaseAdmin
  .from("health_profiles")
  .upsert(profileRow, { onConflict: "user_id" });

if (profErr) throw profErr;


await setStage(jobId, "openai_eval", { total: docs.length, done: docs.length });
await logEvent(jobId, "info", "Calling OpenAI evaluation");

// 3) Optional: update job.result with pointers
await markJob(jobId, {
  status: "succeeded",
  error: null,
  result: { health_profile_updated: true, evaluation_id: evalRow?.id ?? null },
  updated_at: nowIso(),
});
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
        console.error("[worker] job failed", job.id, e?.message || e);
        await markJob(job.id, {
            status: "failed",
            error: String(e?.message || e),
            updated_at: nowIso(),
            locked_at: null,
            locked_by: null,
            });
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
