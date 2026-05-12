export type AiQuestionSource = {
  title: string;
  type?: string;
  detail?: string;
};

export type AiQuestionResult =
  | { status: "idle" }
  | { status: "answered"; answer: string; sources: AiQuestionSource[] }
  | { status: "unavailable"; message: string };

type FetchLike = (input: string, init: {
  method: "POST";
  headers: Record<string, string>;
  body: string;
}) => Promise<{
  ok: boolean;
  status?: number;
  json: () => Promise<unknown>;
}>;

type AskHealthQuestionOptions = {
  endpoint: string;
  accessToken?: string | null;
  fetchImpl?: FetchLike;
};

const UNAVAILABLE_MESSAGE =
  "AI search is unavailable right now. Try again after the AI worker is connected.";

export function aiQuestionEndpoint(): string | null {
  const configured = process.env.EXPO_PUBLIC_AI_QUESTION_ANSWER_URL?.trim();
  if (configured) return configured;

  const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL?.trim();
  if (!supabaseUrl) return null;
  return `${supabaseUrl.replace(/\/$/, "")}/functions/v1/answer-health-question`;
}

export async function askHealthQuestion(
  question: string,
  options: AskHealthQuestionOptions,
): Promise<AiQuestionResult> {
  const trimmed = question.trim();
  if (!trimmed) return { status: "idle" };

  if (!options.endpoint) {
    return unavailable();
  }

  const fetchImpl = options.fetchImpl ?? fetch;

  try {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (options.accessToken) {
      headers.Authorization = `Bearer ${options.accessToken}`;
    }

    const response = await fetchImpl(options.endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify({ question: trimmed }),
    });

    const json = await response.json().catch(() => ({}));
    if (!response.ok) return unavailable();

    const answer = stringValue((json as any)?.answer);
    if (!answer) return unavailable();

    return {
      status: "answered",
      answer,
      sources: normalizeSources((json as any)?.sources),
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
