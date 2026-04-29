import "dotenv/config";
import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { DocumentFactsSchema, HealthEvaluationSchema, type DocumentFacts, type HealthEvaluation } from "./schemas";
import {
  serializeProfileContext,
  serializeBackfilledContext,
  type ManualProfileContext,
  type AiBackfilledContext,
} from "./profileContext";

import fs from "fs";
import path from "path";
import os from "os";
import { promises as fsp } from "fs";
import { randomUUID } from "crypto";


function mimeToExt(mime: string | null) {
  const m = (mime ?? "").toLowerCase();
  if (m.includes("mp3") || m.includes("mpeg")) return "mp3";
  if (m.includes("wav")) return "wav";
  if (m.includes("webm")) return "webm";
  if (m.includes("ogg")) return "ogg";
  // audio/mp4 is usually .m4a
  return "m4a";
}


function pickOutputText(resp: any): string {
  if (typeof resp?.output_text === "string") return resp.output_text;

  // fallback for older response shapes
  const chunks: string[] = [];
  const output = resp?.output ?? [];
  for (const item of output) {
    const content = item?.content ?? [];
    for (const c of content) {
      if (typeof c?.text === "string") chunks.push(c.text);
    }
  }
  return chunks.join("\n").trim();
}

export async function ocrPngPagesToText(pages: Array<{ page: number; png: Buffer }>): Promise<string> {
  const model = process.env.AI_MODEL_OCR || "gpt-4o-mini";

  const system =
    "You are an OCR engine. Extract ALL visible text exactly as it appears. " +
    "Preserve line breaks. Do not add commentary. Output plain text only.";

  const userContent: any[] = [];

  for (const p of pages) {
    userContent.push({ type: "input_text", text: `PAGE ${p.page}` });
    userContent.push({
      type: "input_image",
      image_url: `data:image/png;base64,${p.png.toString("base64")}`,
    });
  }

  const resp = await openai.responses.create({
    model,
    input: [
      { role: "system", content: [{ type: "input_text", text: system }] },
      { role: "user", content: userContent },
    ],
  });

  return pickOutputText(resp);
}

export async function transcribeAudioBuffer(buf: Buffer, mimeType: string | null) {
  if (buf.length === 0) {
    throw new Error("Audio buffer is empty — nothing to transcribe.");
  }
  if (buf.length > 25 * 1024 * 1024) {
    throw new Error("Audio too large to transcribe (25MB limit).");
  }

  const ext = mimeToExt(mimeType);
  const tmpPath = path.join(os.tmpdir(), `rivr_${randomUUID()}.${ext}`);

  await fsp.writeFile(tmpPath, buf);

  try {
    const model = process.env.AI_MODEL_TRANSCRIBE || "whisper-1";
    const transcription = await openai.audio.transcriptions.create({
      file: fs.createReadStream(tmpPath),
      model,
    });
    return (transcription as any).text ? String((transcription as any).text) : "";
  } finally {
    await fsp.unlink(tmpPath).catch(() => {});
  }
}


function mustEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

const openai = new OpenAI({
  apiKey: mustEnv("OPENAI_API_KEY"),
  baseURL: process.env.OPENAI_BASE_URL || "https://api.openai.com/v1",
});

const MODEL_EXTRACT = process.env.AI_MODEL_EXTRACT || "gpt-4o-2024-08-06";
const MODEL_EVAL = process.env.AI_MODEL_EVAL || "gpt-4o-2024-08-06";

/**
 * Helper to attempt a parse once, and if it fails (usually schema validation),
 * try exactly one more time with a corrective prompt.
 */
async function parseWithRetry<T>(fn: () => Promise<T>, retryFn: () => Promise<T>) {
  try {
    return await fn();
  } catch (e) {
    console.warn("[AI] Schema parsing failed, attempting retry...", e instanceof Error ? e.message : e);
    return await retryFn();
  }
}

export async function extractDocumentFacts(input: {
  document_id: string;
  title: string | null;
  text: string;
  signal?: AbortSignal;
}): Promise<DocumentFacts> {
  const system = `You extract structured medical facts from ONE document AND produce timeline events.
Rules:
- Only use what is present in the text. If missing, use null or empty arrays.
- Be conservative. Do not guess blood type.
- timeline_events: include only high confidence events (diagnoses, surgeries, lab results, medications).
- For occurred_at, look carefully for dates anywhere in the document: visit/encounter dates, signature dates, lab collection/draw dates, prescription dates, discharge dates, headers, footers, and report-generated dates.
- Accept partial dates. Use YYYY-MM-DD when known precisely, YYYY-MM when only month is known, YYYY when only year is known. Set date_precision accordingly ("day" / "month" / "year").
- If no event date can be found in the document, return occurred_at: null and date_precision: null. Do NOT use today's date. Do NOT invent a date.
- data_kv must always be present. If nothing, return [] (not {}).
Return JSON only in the required schema.`;

  const userContent = `Document ID: ${input.document_id}\nTitle: ${input.title ?? ""}\n\nTEXT:\n${input.text}`;

  const makeCall = (isRetry = false) => {
    const messages: any[] = [
      { role: "system", content: [{ type: "input_text", text: system }] },
      { role: "user", content: [{ type: "input_text", text: userContent }] },
    ];

    if (isRetry) {
      messages.push({
        role: "user",
        content: [{ type: "input_text", text: "Your previous output failed schema validation. Output valid JSON that matches the schema exactly, with no extra keys or markdown formatting." }]
      });
    }

    return openai.responses.parse({
      model: MODEL_EXTRACT,
      input: messages,
      text: { format: zodTextFormat(DocumentFactsSchema, "document_facts") },
    }, { signal: input.signal });
  };

  const resp = await parseWithRetry(
    () => makeCall(false),
    () => makeCall(true)
  );

  return resp.output_parsed as DocumentFacts;
}

export async function evaluateUserHealth(input: {
  user_id: string;
  docFacts: DocumentFacts[];
  appleHealth: { steps_avg_7d: number | null; sleep_avg_min_7d: number | null; resting_hr_recent: number | null; };
  manualProfile?: ManualProfileContext;
  /** AI-backfilled items from user_profiles that the patient has not explicitly verified. */
  profileBackfill?: AiBackfilledContext | null;
  signal?: AbortSignal;
}): Promise<HealthEvaluation> {
  const hasManualProfile = !!input.manualProfile;
  const hasDocFacts = input.docFacts.length > 0;
  const hasBackfill = !!(
    input.profileBackfill &&
    (
      (input.profileBackfill.allergies?.length ?? 0) > 0 ||
      (input.profileBackfill.medications?.length ?? 0) > 0 ||
      (input.profileBackfill.medical_history?.length ?? 0) > 0 ||
      (input.profileBackfill.surgical_history?.length ?? 0) > 0
    )
  );

  // ── System prompt ──────────────────────────────────────────────────────────
  // Trust ladder is built dynamically from whichever sources are present.
  // MANUAL_PROFILE = only items the patient typed themselves (ai_ IDs excluded).
  // PROFILE_BACKFILL = AI-backfilled items stored in user_profiles, not yet
  //   verified by the patient. Lower trust than MANUAL_PROFILE, higher than
  //   raw DOCUMENT_FACTS (because the patient at least implicitly accepted them
  //   by not deleting them).

  const ladder: string[] = [];
  let r = 1;
  if (hasManualProfile) {
    ladder.push(`  ${r++}. MANUAL_PROFILE (highest trust) — entered directly by the patient. Every fact here is verified ground truth.`);
  }
  if (hasBackfill) {
    ladder.push(`  ${r++}. PROFILE_BACKFILL (medium trust) — AI-suggested items from prior document analysis, stored in the patient's profile but not explicitly verified. Use as supporting evidence; never override MANUAL_PROFILE.`);
  }
  ladder.push(`  ${r++}. APPLE_HEALTH — passive sensor data from the patient's device. Reliable for trends; lacks clinical context.`);
  if (hasDocFacts) {
    ladder.push(`  ${r++}. DOCUMENT_FACTS — extracted by AI from uploaded health documents. May contain OCR errors, outdated values, or interpretation artifacts.`);
  }

  const noDocsNote = !hasDocFacts && hasManualProfile
    ? `\n  No uploaded documents are present. Produce a complete, useful summary using available sources alone.`
    : "";

  const sourceSection = `\nDATA SOURCES — in order of trust for this evaluation:\n${ladder.join("\n")}${noDocsNote}`;

  // Conflict resolution — only emitted when multiple sources are present
  const conflictLines: string[] = [];
  if (hasManualProfile && (hasBackfill || hasDocFacts)) {
    conflictLines.push("If MANUAL_PROFILE and any other source disagree on any fact, always use the MANUAL_PROFILE value. The patient knows their own history better than AI extraction.");
    conflictLines.push("Never silently drop a MANUAL_PROFILE fact in favor of PROFILE_BACKFILL or DOCUMENT_FACTS.");
  }
  if (hasManualProfile && hasDocFacts) {
    conflictLines.push("Exception: if DOCUMENT_FACTS contains a specific clinical measurement (lab value, vital sign, dated diagnosis) absent from MANUAL_PROFILE, include it as supplementary — it adds rather than contradicts.");
  }
  if (hasBackfill) {
    conflictLines.push("PROFILE_BACKFILL items are AI-suggested, not patient-verified. Include them as supporting evidence. Do not present them with the same confidence as MANUAL_PROFILE.");
    conflictLines.push("If PROFILE_BACKFILL and DOCUMENT_FACTS overlap on the same item, mention it once using the more detailed version.");
  }
  const conflictSection = conflictLines.length > 0
    ? `\nCONFLICT RESOLUTION:\n  - ${conflictLines.join("\n  - ")}`
    : "";

  const fieldGuidance = `
HOW TO POPULATE EACH OUTPUT FIELD:

score_0_to_100 / score_label:
  This score is a metric of the patient's CURRENT HEALTH PROFILE, not a profile-completion score.

  It should reflect:
  - known disease burden and how serious it appears
  - current symptoms and functional impact
  - cardiometabolic and lifestyle risk factors
  - known protective behaviors (exercise, non-smoking, good sleep, etc.)
  - available Apple Health trends
  - known labs and vitals when present

  It should NOT primarily reflect:
  - how many documents were uploaded
  - how complete the profile is
  - whether some information is missing

  IMPORTANT:
  Missing information should lower confidence in the score, but should NOT substantially lower the health score itself unless the missing information is itself clinically concerning.

  Score from known evidence:
  - known positive evidence can raise the score
  - known negative evidence can lower the score
  - unknowns should usually remain neutral

  Use this scale:
  - 90–100: exceptionally favorable known health profile, strong health-supporting behaviors, and no major known uncontrolled risks
  - 75–89: generally healthy overall, with some manageable risks or mild chronic issues
  - 60–74: mixed profile, meaningful risk factors or chronic conditions, but not severe overall compromise
  - 40–59: significant health burden, poor control, or multiple substantial risk factors
  - 0–39: severe health burden, major instability, or serious functional/safety concerns

  A person with multiple chronic conditions and sedentary lifestyle should not score above 60.
  A person with sparse data but no clear negative evidence should not automatically receive a low score; reflect uncertainty elsewhere, not by turning this into a profile-completion score.

score_label:
  Match the score with a patient-friendly label:
  - 90–100 → Excellent
  - 75–89 → Strong
  - 60–74 → Fair
  - 40–59 → Concerning
  - 0–39 → High Risk

overview (2–4 sentences, patient-friendly):
  Synthesize ALL sources into a personal summary of this specific patient. Reference their age and sex if known. Mention their most significant condition, medication, or lifestyle factor. Make it feel specific to them, not a generic template. Do not mention data sources by name.

highlights (positive observations):
  Draw from MANUAL_PROFILE lifestyle fields (e.g., "never smoked", "exercises regularly"), controlled conditions, healthy labs, and good Apple Health metrics. These should feel genuinely earned, not invented.

risk_flags (concerns and risks):
  Include clinical concerns from MANUAL_PROFILE medical_history, current_symptoms, family_history, and adverse lifestyle factors (smoking, heavy alcohol, sedentary). Supplement with document-extracted conditions and abnormal labs. Family history from MANUAL_PROFILE belongs here when clinically relevant (e.g., "Family history of heart disease").

missing_info (what would improve this analysis):
  List only genuinely absent information that would materially change the evaluation. Do NOT list information the patient already provided in MANUAL_PROFILE. Do NOT add generic items like "upload more documents" unless a specific document type would add real value.

suggested_next_steps (personalized action items):
  Reference this specific patient's conditions, medications, symptoms, and lifestyle. Use story answers from MANUAL_PROFILE to personalize framing — if a patient values family or mentions caregiving responsibilities, frame wellness steps in that context. Never give generic advice that ignores what you know about them.

three_by_five_card (emergency reference card — accuracy is paramount):
  major_conditions: use MANUAL_PROFILE medical_history as the primary source. Add any high-confidence document-extracted conditions not already listed. Each entry should be brief (condition name + year if known).
  major_surgeries: use MANUAL_PROFILE surgical_history as the primary source. Supplement from documents.
  current_meds: use MANUAL_PROFILE medications as the primary source (name + dose + frequency). Include document-extracted meds only if they are absent from the profile.
  allergies: use MANUAL_PROFILE allergies as the primary source with reaction and severity. Include document-extracted allergies only if absent from the profile and high confidence.
  implants_devices: from documents if not in profile; may be empty.
  anticoagulants: extract from medications list (blood thinners like warfarin, apixaban, rivaroxaban, heparin). This is safety-critical for emergency responders.
  anesthesia_notes: any anesthesia risks or notes from surgical history, medications, or conditions.
  emergency_contact: use MANUAL_PROFILE emergency contact name and phone if present. Otherwise null.
  one_line_summary: one sentence capturing the most clinically significant fact for an emergency responder who has 5 seconds to read this card.

full_summary_markdown:
  Write this as a patient-friendly narrative summary in paragraph form, not as bullets and not as many separate sections.

  Format rules:
  - Do NOT use markdown headers.
  - Do NOT use bullet points unless absolutely unavoidable.
  - Prefer 3–6 well-written paragraphs.
  - Each paragraph should connect ideas and explain what the overall picture means.
  - The writing should feel like a real explanation, not a checklist or data dump.

  Content goals:
  - Start with the big picture of the patient's health based on the available data.
  - Explain what seems to be going well.
  - Explain the main health concerns, conditions, symptoms, or risk patterns that matter most.
  - Explain how lifestyle, Apple Health trends, medications, symptoms, and history fit together when relevant.
  - When information is missing, mention how that limits the picture, but do not let the summary become a profile-completion report.
  - If the patient's own story/context is present, weave it in naturally with a phrase like: "In the patient's own words..."
  - End with a short plain-language explanation of what deserves attention next.

  Style rules:
  - Be warm, clear, and medically responsible.
  - Avoid jargon when possible.
  - Do not just list diagnoses, medications, allergies, or symptoms.
  - Synthesize the information and explain what it suggests about the patient's overall health.
  - Focus on meaning, patterns, and implications, not just raw facts.
  - Do not repeat the same facts already covered elsewhere unless they help explain the overall picture.
  - If data is sparse, say that clearly and briefly, while still giving the most useful overall interpretation possible.
    - Do NOT include disclaimer language in this field.
    - Do NOT say "this summary is informational", "not a substitute for medical advice", "follow up with your clinician", or similar boilerplate unless it is part of a concrete patient-specific next step.
    - The final paragraph must end with a useful, patient-specific conclusion, not a legal or safety disclaimer.
    - Any disclaimer belongs ONLY in the separate disclaimer field.

  Good summary behavior:
  - "Overall, the available information suggests..."
  - "Taken together, these findings point to..."
  - "The main issues that stand out are..."
  - "This likely matters because..."
  - "A key limitation in understanding the full picture is..."

  Bad summary behavior:
  - separate mini sections
  - bullet lists of conditions
  - repeating "the patient has..." over and over
  - turning the whole summary into missing-info reminders

  The final result should read like a thoughtful narrative explanation of what is going on with the patient's health, not a structured notes page.

recommendations (3–6 structured items — populate AFTER completing the other fields):
  Create a small set of useful, action-first recommendations for this patient.

  Core goal:
  Recommendations should help the user understand what they should DO next, what important information is MISSING, and what meaningful FOLLOW-UP is needed.
  Do NOT use this section to simply restate facts the user already knows.

  Source priority:
  1. missing_info
  2. suggested_next_steps
  3. risk_flags only when a clear action follows from them

  Quality gate:
  Every recommendation must answer at least one of these:
  - What should the patient do next?
  - What important information is missing?
  - What follow-up is needed?

  Suppress these:
  - generic lifestyle advice not clearly grounded in this patient's data
  - passive observations that only restate known facts
  - vague administrative language like "Confirmation of..." or "Assessment of..."
  - non-urgent safety items that do not lead to a specific action
  - filler recommendations added just to increase the count

  Diversity goal:
  If the data allows, aim for 2–3 different useful recommendation types rather than flooding the list with only one category.
  Missing info should appear first when important, but do NOT let the full list become repetitive if there are also strong follow-up actions.

  id: unique string — "rec_01", "rec_02", etc.

  title:
    ≤ 55 characters.
    A compact, scannable preview label for the collapsed card.
    Start with a clear action verb when possible.
    Do NOT end with "..." or "…".
    Do NOT truncate mid-thought.
    Example: "Add allergy records" not "Confirmation of allergies (penicillin and pean..."

  full_title:
    The complete user-facing title with no truncation and no ellipsis.
    This is shown in expanded mode. Write it as a full, clean action phrase.
    May be longer than "title" — no character limit.
    Do NOT end with "..." or "…".
    Example: "Add your full allergy list including penicillin and peanut reactions"

  body:
    1 short sentence only.
    A compact preview sentence shown in the collapsed card below the title.
    Keep it brief and readable at a glance.

  full_body:
    1–3 full sentences.
    This is the complete expanded explanation shown when the user taps "See more".
    Explain what information is missing, why it matters, and what the patient should do.
    If based on missing_info, name the exact missing field or record clearly.
    Do NOT use "..." or "…" here.
    Do NOT cut off mid-thought.

  details:
    Same as full_body, or a slightly richer version if useful.
    Omit if it would be identical to full_body.

  category: choose the most accurate:
    missing_info   → specific missing information or missing records that would materially improve the analysis
    follow_up      → meaningful next step, provider contact, test, appointment, or review
    monitoring     → concrete tracking or recheck plan for a known issue
    medication     → medication review, dose clarification, refill, adherence, or side-effect follow-up
    safety         → truly urgent concern or dangerous information gap only
    lifestyle      → only when specific, personalized, and clearly actionable
    preventive     → useful screening or prevention action when truly relevant

  priority:
    high   → urgent action, significant clinical concern, or highly important missing information
    medium → useful and specific next step or information gap
    low    → lower-impact optimization or preventive action

  source:
    short snake_case descriptor of the motivating issue, such as:
    "missing_recent_labs", "medication_dose_unknown", "sleep_data_gap", "bp_follow_up_needed"

  action_label (optional):
    Use only when there is a clear in-app destination.
    Prefer these exact labels:
    "Add Data"       → when uploading or adding health records/documents is the best next step
    "Connect Health" → when Apple Health would close the data gap
    "View Health"    → when the recommendation points to Apple Health trends already available

  action_type (optional):
    If action_label is set, it must be one of:
    navigate_documents | navigate_apple_health

  CTA routing rules:
  - If the recommendation is about missing records, labs, reports, imaging, visit summaries, medication records, or health documents, use:
    action_label: "Add Data"
    action_type: "navigate_documents"
  - If the recommendation is about missing sleep, steps, heart rate, activity, wearable, or Apple Health data, use:
    action_label: "Connect Health"
    action_type: "navigate_apple_health"
  - If the item is about scheduling, discussing, or following up with a clinician and there is no meaningful in-app destination, omit the CTA entirely.

  Sorting rules:
  - Show the most useful items first.
  - Prefer this category order when similarly valuable:
    missing_info → follow_up → monitoring → medication → safety → lifestyle → preventive
  - Within a category, higher priority comes first.
  - Deduplicate aggressively.
  - Maximum 6 items.
  - Do not pad the list with weak recommendations.

  disclaimer:
    Write exactly one short sentence.
    Keep it neutral and brief.
    This field is separate from the summary.
    Do NOT repeat or paraphrase this disclaimer in overview, full_summary_markdown, suggested_next_steps, or recommendations.
  `;
  const generalRules = `
GENERAL RULES:
  - Output MUST match the schema exactly. No extra keys. No markdown outside full_summary_markdown.
  - Score 0–100: be honest. Do not inflate.
  - Do not hallucinate facts not present in any data source.
  - Put any disclaimer text ONLY in the separate disclaimer field.
  - Never include disclaimer, liability, or "not a substitute for medical advice" language in full_summary_markdown, overview, suggested_next_steps, or recommendations.
  - full_summary_markdown must end with patient-specific next steps, not a disclaimer.
  - If a list field (allergies, current_meds, etc.) has nothing to report, use an empty array []. Never omit it.`;

  const system = `You are a health information synthesizer producing a structured health summary for a patient's personal health app.
${sourceSection}
${conflictSection}
${fieldGuidance}
${generalRules}`.trim();

  // ── User content ───────────────────────────────────────────────────────────
  // Order mirrors the trust ladder: MANUAL_PROFILE → PROFILE_BACKFILL →
  // APPLE_HEALTH → DOCUMENT_FACTS. Model attention prioritizes earlier context.

  const profileSection = hasManualProfile
    ? `\n\nMANUAL_PROFILE:\n${serializeProfileContext(input.manualProfile!)}`
    : "";

  const backfillSection = hasBackfill
    ? `\n\nPROFILE_BACKFILL:\n${serializeBackfilledContext(input.profileBackfill!)}`
    : "";

  const userContent =
    `USER_ID: ${input.user_id}` +
    profileSection +
    backfillSection +
    `\n\nAPPLE_HEALTH:\n${JSON.stringify(input.appleHealth)}` +
    `\n\nDOCUMENT_FACTS:\n${JSON.stringify(input.docFacts)}`;

  const makeCall = (isRetry = false) => {
    const messages: any[] = [
      { role: "system", content: [{ type: "input_text", text: system }] },
      { role: "user", content: [{ type: "input_text", text: userContent }] },
    ];

    if (isRetry) {
      messages.push({
        role: "user",
        content: [{ type: "input_text", text: "Your previous output failed schema validation. Output valid JSON that matches the schema exactly, with no extra keys." }]
      });
    }

    return openai.responses.parse({
      model: MODEL_EVAL,
      input: messages,
      text: { format: zodTextFormat(HealthEvaluationSchema, "health_evaluation") },
    }, { signal: input.signal });
  };

  const resp = await parseWithRetry(
    () => makeCall(false),
    () => makeCall(true)
  );

  return resp.output_parsed as HealthEvaluation;
}