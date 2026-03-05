import "dotenv/config";
import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { DocumentFactsSchema, HealthEvaluationSchema, type DocumentFacts, type HealthEvaluation } from "./schemas";

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
}): Promise<DocumentFacts> {
  const system = `You extract structured medical facts from ONE document AND produce timeline events.
Rules:
- Only use what is present in the text. If missing, use null or empty arrays.
- Be conservative. Do not guess blood type.
- timeline_events: include only high confidence events (diagnoses, surgeries, lab results, medications).
- occurred_at should be YYYY-MM-DD if present.
- data_kv must always be present. If nothing, return [] (not {})..
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
      
    });
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
}): Promise<HealthEvaluation> {
  const system = `You create a supportive, patient-friendly health summary and a "3x5 essentials" card.
Important:
- Output MUST match the schema exactly.
- Score is 0-100. Be honest but kind.
- If data is missing, mention it in missing_info.
- Include a short disclaimer that this is not medical advice.`;

  const userContent = `USER_ID: ${input.user_id}\n\nAPPLE_HEALTH:\n${JSON.stringify(input.appleHealth)}\n\nDOCUMENT_FACTS:\n${JSON.stringify(input.docFacts)}`;

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
    });
  };

  const resp = await parseWithRetry(
    () => makeCall(false),
    () => makeCall(true)
  );

  return resp.output_parsed as HealthEvaluation;
}