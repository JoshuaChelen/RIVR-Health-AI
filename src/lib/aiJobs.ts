// src/lib/aiJobs.ts
import { supabase } from "./supabase";

export async function enqueueDocumentProcessing(documentIds: string[]) {
  const { data: sessionData, error: sessErr } = await supabase.auth.getSession();
  if (sessErr) throw sessErr;

  const token = sessionData.session?.access_token;
  if (!token) throw new Error("Not signed in");

  const { data, error } = await supabase.functions.invoke("enqueue-document-processing", {
    headers: { Authorization: `Bearer ${token}` },
    body: { documentIds },
  });

  if (error) throw error;
  return data?.jobId as string;
}

export async function getHealthProfile(userId: string) {
  const { data, error } = await supabase
    .from("health_profiles")
    .select("user_id,score,score_label,summary_json,card_json,sources,updated_at")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) throw error;
  return data;
}

export async function getLatestEvaluation(userId: string) {
  const { data, error } = await supabase
    .from("health_evaluations")
    .select("id,created_at,score,result")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return data;
}

// NEW: your HealthSummaryScreen needs these
export async function getLatestJob(userId: string) {
  const { data, error } = await supabase
    .from("ai_jobs")
    .select("id,job_type,status,error,document_ids,created_at,updated_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return data;
}

export async function getAllDocumentIds(userId: string) {
  const { data, error } = await supabase
    .from("documents")
    .select("id")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });

  if (error) throw error;
  return (data ?? []).map((r: any) => String(r.id));
}

export async function requestCancelJob(jobId: string): Promise<void> {
  const { error } = await supabase
    .from("ai_jobs")
    .update({ cancel_requested: true })
    .eq("id", jobId);
  if (error) throw error;
}

// keep your old name if you want
export async function startAiJob(documentIds: string[]) {
  return enqueueDocumentProcessing(documentIds);
}
