/// <reference types="jsr:@supabase/functions-js/edge-runtime.d.ts" />

import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

type Source = {
  title: string;
  type: "document" | "timeline" | "health_summary";
  detail?: string;
};

const DEFAULT_BUCKET = "documents";
const MAX_CONTEXT_CHARS = 30000;
const MAX_QUESTION_CHARS = 500;

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { error: "Method not allowed" });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const openaiKey = Deno.env.get("OPENAI_API_KEY");

    if (!supabaseUrl || !anonKey || !serviceRoleKey) {
      return json(500, { error: "Missing Supabase env vars" });
    }
    if (!openaiKey) {
      return json(503, { error: "AI search is not configured" });
    }

    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader) return json(401, { error: "Missing Authorization" });

    const authed = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false },
    });

    const { data: userRes, error: userErr } = await authed.auth.getUser();
    if (userErr || !userRes.user) return json(401, { error: "Not authenticated" });
    const userId = userRes.user.id;

    const body = await req.json().catch(() => ({}));
    const question = String(body?.question ?? "").trim().slice(0, MAX_QUESTION_CHARS);
    if (!question) return json(400, { error: "Question is required" });

    const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });
    const { context, sources } = await buildPatientContext(admin, userId);
    if (!context.trim()) {
      return json(200, {
        answer: "I could not find enough information in your uploaded records or timeline to answer that.",
        sources: [],
      });
    }

    const ai = await askOpenAI(openaiKey, question, context, sources);
    return json(200, ai);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to answer question";
    return json(500, { error: message });
  }
});

async function buildPatientContext(
  admin: any,
  userId: string,
): Promise<{ context: string; sources: Source[] }> {
  const sources: Source[] = [];
  const sections: string[] = [];

  const { data: health } = await admin
    .from("health_profiles")
    .select("card_json, summary_json, updated_at")
    .eq("user_id", userId)
    .maybeSingle();

  if (health) {
    sections.push(`HEALTH_SUMMARY\n${clip(JSON.stringify(health), 8000)}`);
    sources.push({ title: "AI Health Summary", type: "health_summary" });
  }

  const { data: docs } = await admin
    .from("documents")
    .select("id,title,status,summary_path,source_type,created_at")
    .eq("user_id", userId)
    .eq("status", "processed")
    .or("source_type.is.null,source_type.neq.manual_input")
    .not("summary_path", "is", null)
    .order("created_at", { ascending: false })
    .limit(12);

  for (const doc of docs ?? []) {
    const path = String(doc.summary_path ?? "");
    if (!path) continue;
    try {
      const bucket = Deno.env.get("SUPABASE_STORAGE_BUCKET") || DEFAULT_BUCKET;
      const { data, error } = await admin.storage.from(bucket).download(path);
      if (error || !data) continue;
      const text = await data.text();
      const title = String(doc.title ?? "Uploaded document");
      sections.push(`DOCUMENT: ${title}\n${clip(text, 6000)}`);
      sources.push({ title, type: "document" });
    } catch {
      // Skip unreadable summaries. A single stale storage path should not make
      // the user's records search fail.
    }
  }

  const { data: events } = await admin
    .from("timeline_events")
    .select("title,summary,occurred_at,date_precision,category,event_type,source,tags,data,created_at")
    .eq("user_id", userId)
    .neq("source", "apple_health")
    .order("occurred_at", { ascending: false, nullsFirst: false })
    .limit(80);

  if (events && events.length > 0) {
    sections.push(`TIMELINE_EVENTS\n${clip(JSON.stringify(events), 9000)}`);
    sources.push({ title: "Timeline", type: "timeline" });
  }

  return {
    context: clip(sections.join("\n\n"), MAX_CONTEXT_CHARS),
    sources,
  };
}

async function askOpenAI(
  apiKey: string,
  question: string,
  context: string,
  availableSources: Source[],
): Promise<{ answer: string; sources: Source[] }> {
  const model = Deno.env.get("AI_MODEL_QUESTION_ANSWER") ||
    Deno.env.get("AI_MODEL_EVAL") ||
    "gpt-4o-2024-08-06";
  const baseURL = Deno.env.get("OPENAI_BASE_URL") || "https://api.openai.com/v1";

  const prompt = [
    "You answer patient questions for a personal health record app.",
    "Use only the supplied patient context. Do not use outside medical knowledge to invent facts.",
    "If the context does not contain enough information, say that clearly.",
    "Do not diagnose, prescribe, or replace clinician advice.",
    "Return only JSON with this shape: {\"answer\":\"...\",\"sources\":[{\"title\":\"...\",\"type\":\"document|timeline|health_summary\",\"detail\":\"optional\"}]}",
    "",
    `Question: ${question}`,
    "",
    "Patient context:",
    context,
  ].join("\n");

  const res = await fetch(`${baseURL.replace(/\/$/, "")}/responses`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      input: prompt,
      temperature: 0.2,
    }),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const error = typeof data?.error?.message === "string" ? data.error.message : "OpenAI request failed";
    throw new Error(error);
  }

  const text = extractOutputText(data);
  const parsed = parseAnswerJson(text);
  if (!parsed.answer) {
    return {
      answer: text.trim() || "I could not find enough information in your uploaded records or timeline to answer that.",
      sources: availableSources.slice(0, 5),
    };
  }

  return {
    answer: parsed.answer,
    sources: answerHasNoSupportingEvidence(parsed.answer)
      ? []
      : normalizeModelSources(parsed.sources, availableSources),
  };
}

function extractOutputText(data: any): string {
  if (typeof data?.output_text === "string") return data.output_text;
  const chunks: string[] = [];
  for (const item of data?.output ?? []) {
    for (const content of item?.content ?? []) {
      if (typeof content?.text === "string") chunks.push(content.text);
    }
  }
  return chunks.join("\n").trim();
}

function parseAnswerJson(text: string): { answer: string; sources: Source[] } {
  const raw = text.trim().replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```$/i, "").trim();
  try {
    const parsed = JSON.parse(raw);
    return {
      answer: typeof parsed?.answer === "string" ? parsed.answer.trim() : "",
      sources: Array.isArray(parsed?.sources) ? parsed.sources : [],
    };
  } catch {
    return { answer: "", sources: [] };
  }
}

function normalizeModelSources(value: unknown, available: Source[]): Source[] {
  if (!Array.isArray(value)) return available.slice(0, 5);
  const valid = new Map(available.map((source) => [source.title.toLowerCase(), source]));
  const out: Source[] = [];

  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const title = String(record.title ?? "").trim();
    if (!title) continue;
    const matched = valid.get(title.toLowerCase());
    if (!matched) continue;
    out.push({
      ...matched,
      detail: typeof record.detail === "string" ? record.detail.trim() : matched.detail,
    });
    if (out.length >= 5) break;
  }

  return out.length > 0 ? out : available.slice(0, 5);
}

function answerHasNoSupportingEvidence(answer: string): boolean {
  return [
    "does not contain",
    "does not provide",
    "does not include",
    "could not find",
    "cannot find",
    "not enough information",
    "no information",
    "no recorded",
    "no events",
    "no timeline events",
  ].some((phrase) => answer.toLowerCase().includes(phrase));
}

function clip(value: string, max: number): string {
  return value.length > max ? value.slice(0, max) : value;
}
