/// <reference types="jsr:@supabase/functions-js/edge-runtime.d.ts" />
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(status: number, body: any) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
    const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY");
    const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SERVICE_ROLE) {
      return json(500, { error: "Missing Supabase env vars" });
    }

    const authHeader = req.headers.get("Authorization") || "";
    if (!authHeader) return json(401, { error: "Missing Authorization" });

    const authed = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false },
    });

    const { data: userRes, error: userErr } = await authed.auth.getUser();
    if (userErr || !userRes.user) return json(401, { error: "Not authenticated" });
    const userId = userRes.user.id;

    const body = await req.json().catch(() => ({}));

    // jobType determines the processing branch. Defaults to "process_documents"
    // so all existing callers that omit this field continue to work unchanged.
    const jobType: string = body.jobType === "profile_evaluation"
      ? "profile_evaluation"
      : "process_documents";

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });

    // ── profile_evaluation branch ─────────────────────────────────────────────
    // No documents are required. Skip ownership validation and document status
    // updates entirely. Deduplicate against any queued or running evaluation
    // for the same user so rapid saves don't stack up multiple jobs.
    if (jobType === "profile_evaluation") {
      const { data: existingJob } = await admin
        .from("ai_jobs")
        .select("id,status")
        .eq("user_id", userId)
        .eq("job_type", "profile_evaluation")
        .in("status", ["queued", "running"])
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (existingJob) {
        return json(200, { ok: true, jobId: existingJob.id, reused: true });
      }

      const { data: job, error: jobErr } = await admin
        .from("ai_jobs")
        .insert({
          user_id:      userId,
          job_type:     "profile_evaluation",
          document_ids: [],
          status:       "queued",
          priority:     100,
          attempts:     0,
          error:        null,
          result:       null,
        })
        .select("id")
        .single();

      if (jobErr) return json(500, { error: jobErr.message });

      return json(200, { ok: true, jobId: job.id });
    }

    // ── process_documents branch ──────────────────────────────────────────────
    const documentIds: string[] = Array.isArray(body.documentIds)
      ? body.documentIds.map(String)
      : body.documentId
      ? [String(body.documentId)]
      : [];

    if (documentIds.length === 0) return json(400, { error: "No documentIds provided" });

    // Validate ownership (and existence); fetch source_type to split routing.
    const { data: docs, error: docsErr } = await admin
      .from("documents")
      .select("id,user_id,status,source_type")
      .in("id", documentIds);

    if (docsErr) return json(500, { error: docsErr.message });

    const owned = (docs ?? []).filter((d) => d.user_id === userId);
    if (owned.length !== documentIds.length) {
      return json(403, { error: "One or more documents are not yours (or do not exist)" });
    }

    // Split: manual-input docs trigger a profile_evaluation job; file docs
    // continue through the existing process_documents pipeline.

    let lastJobId: string | null = null;

    // ── manual_input → profile_evaluation ─────────────────────────────────────
    const manualIds = owned
  .filter((d) => d.source_type === "manual_input")
  .map((d) => d.id);

const fileIds = owned
  .filter((d) => d.source_type !== "manual_input")
  .map((d) => d.id);

if (manualIds.length > 0) {
  await admin
    .from("documents")
    .update({ status: "processing", processing_error: null })
    .in("id", manualIds)
    .eq("user_id", userId);

  const { data: existingEval } = await admin
    .from("ai_jobs")
    .select("id,status,document_ids")
    .eq("user_id", userId)
    .eq("job_type", "profile_evaluation")
    .in("status", ["queued", "running"])
    .contains("document_ids", manualIds)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existingEval) {
    lastJobId = existingEval.id;
  } else {
    const { data: evalJob, error: evalErr } = await admin
      .from("ai_jobs")
      .insert({
        user_id: userId,
        job_type: "profile_evaluation",
        document_ids: manualIds,
        status: "queued",
        priority: 100,
        attempts: 0,
        error: null,
        result: null,
      })
      .select("id")
      .single();

    if (evalErr) return json(500, { error: evalErr.message });
    lastJobId = evalJob.id;
  }

  if (fileIds.length === 0) {
    return json(200, { ok: true, jobId: lastJobId, manualDocIds: manualIds });
  }
}

    // ── file docs → process_documents (original logic) ────────────────────────
    if (fileIds.length > 0) {
      // Best-effort dedup: avoid stacking duplicate queued/running jobs for same docs.
      const { data: existingJob } = await admin
        .from("ai_jobs")
        .select("id,status,document_ids")
        .eq("user_id", userId)
        .eq("job_type", "process_documents")
        .in("status", ["queued", "running"])
        .contains("document_ids", fileIds)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (existingJob) {
        return json(200, { ok: true, jobId: existingJob.id, reused: true });
      }

      const { data: job, error: jobErr } = await admin
        .from("ai_jobs")
        .insert({
          user_id:      userId,
          job_type:     "process_documents",
          document_ids: fileIds,
          status:       "queued",
          priority:     100,
          attempts:     0,
          error:        null,
          result:       null,
        })
        .select("id")
        .single();

      if (jobErr) return json(500, { error: jobErr.message });
      lastJobId = job.id;

      // Mark file docs as processing so UI and worker agree.
      const { error: updErr } = await admin
        .from("documents")
        .update({ status: "processing", processing_error: null })
        .in("id", fileIds)
        .eq("user_id", userId);

      if (updErr) return json(500, { error: updErr.message });
    }

    return json(200, { ok: true, jobId: lastJobId });
  } catch (e: any) {
    return json(500, { error: e?.message ?? "Unknown error" });
  }
});
