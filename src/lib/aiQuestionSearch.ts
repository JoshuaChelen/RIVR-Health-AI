import { askHealthQuestion as apiAskHealthQuestion, type QaTurn } from "./api/data";

export type AiQuestionSource = {
  title: string;
  type?: string;
  detail?: string;
};

export type AiQuestionResult =
  | { status: "idle" }
  | { status: "answered"; answer: string; sources: AiQuestionSource[] }
  | { status: "unavailable"; message: string };



const UNAVAILABLE_MESSAGE =
  "AI search is unavailable right now. Try again after the AI worker is connected.";

export async function askHealthQuestion(
  question: string,
  history: QaTurn[] = [],
): Promise<AiQuestionResult> {
  const trimmed = question.trim();
  if (!trimmed) return { status: "idle" };

  try {
    const { answer, sources } = await apiAskHealthQuestion(trimmed, history);

    return {
      status: "answered",
      answer,
      sources: normalizeSources(sources),
    };
  } catch {
    return unavailable();
  }
}

function unavailable(): AiQuestionResult {
  return {
    status: "unavailable",
    message: UNAVAILABLE_MESSAGE,
  };
}

function normalizeSources(value: unknown): AiQuestionSource[] {
  if (!Array.isArray(value)) return [];

  const sources: AiQuestionSource[] = [];
  for (const source of value) {
    if (!source || typeof source !== "object") continue;
      const record = source as Record<string, unknown>;
      const title = stringValue(record.title ?? record.name ?? record.label);
    if (!title) continue;
    sources.push({
        title,
        type: stringValue(record.type) || undefined,
        detail: stringValue(record.detail) || undefined,
    });
    if (sources.length >= 5) break;
  }
  return sources;
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}
