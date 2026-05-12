export type DatePrecision = "day" | "month" | "year";

export type TimelineLike = {
  id?: string | null;
  occurred_at?: string | null;
  date_precision?: DatePrecision | string | null;
  title?: string | null;
  event_type?: string | null;
  category?: string | null;
  source?: string | null;
  summary?: string | null;
  included_in_previsit?: boolean | null;
  document_id?: string | null;
  documentTitle?: string | null;
  created_at?: string | null;
  tags?: unknown;
  data?: unknown;
};

export type NormalizedTimelineEvent = {
  id: string;
  occurred_at: string | null;
  date_precision: DatePrecision | null;
  title: string;
  event_type: string;
  category: string;
  source: string;
  summary: string;
  included_in_previsit: boolean;
  document_id: string | null;
  documentTitle: string | null;
  created_at: string | null;
  tags: string[];
  data: Record<string, unknown>;
};

const PRECISIONS = new Set(["day", "month", "year"]);

export function normalizeTimelineEvent(row: TimelineLike): NormalizedTimelineEvent {
  const data = isRecord(row.data) ? row.data : {};
  const occurredAt = normalizeStoredDate(row.occurred_at);
  return {
    id: stringOr(row.id, ""),
    occurred_at: occurredAt,
    date_precision: occurredAt ? normalizePrecision(row.date_precision, row.occurred_at) : null,
    title: stringOr(row.title, "Untitled event"),
    event_type: stringOr(row.event_type, "other"),
    category: stringOr(row.category, "Other"),
    source: stringOr(row.source, "unknown"),
    summary: stringOr(row.summary, ""),
    included_in_previsit: !!row.included_in_previsit,
    document_id: stringOrNull(row.document_id),
    documentTitle: stringOrNull(row.documentTitle),
    created_at: normalizeStoredDate(row.created_at),
    tags: normalizeTags(row.tags),
    data,
  };
}

export function normalizePrecision(
  precision: DatePrecision | string | null | undefined,
  occurredAt?: string | null,
): DatePrecision | null {
  if (typeof precision === "string" && PRECISIONS.has(precision)) {
    return precision as DatePrecision;
  }
  const raw = String(occurredAt ?? "").trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return "day";
  if (/^\d{4}-\d{2}$/.test(raw)) return "month";
  if (/^\d{4}$/.test(raw)) return "year";
  return null;
}

export function normalizeStoredDate(value?: string | null): string | null {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  const day = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (day) {
    const [, y, m, d] = day;
    return isValidYmd(Number(y), Number(m), Number(d)) ? `${y}-${m}-${d}` : null;
  }
  const month = raw.match(/^(\d{4})-(\d{2})$/);
  if (month) {
    const [, y, m] = month;
    return isValidYmd(Number(y), Number(m), 1) ? `${y}-${m}-01` : null;
  }
  const year = raw.match(/^(\d{4})$/);
  if (year) {
    const y = Number(year[1]);
    return y > 0 ? `${year[1]}-01-01` : null;
  }
  return null;
}

export function ageAtIncident(dob?: string | null, occurredAt?: string | null): number | null {
  const birth = parseYmd(dob);
  const incident = parseYmd(occurredAt);
  if (!birth || !incident || incident.getTime() < birth.getTime()) return null;
  let age = incident.getFullYear() - birth.getFullYear();
  const monthDelta = incident.getMonth() - birth.getMonth();
  if (monthDelta < 0 || (monthDelta === 0 && incident.getDate() < birth.getDate())) age--;
  return age >= 0 && age < 130 ? age : null;
}

export function formatTimelineDateMain(
  event: Pick<NormalizedTimelineEvent, "occurred_at" | "date_precision" | "created_at">,
  dob?: string | null,
): { primary: string; secondary: string | null } {
  const ymd = event.occurred_at;
  const precision = event.date_precision;
  const year = ymd ? parseYmd(ymd)?.getFullYear() ?? null : null;
  const age = ageAtIncident(dob, ymd);
  const reported = formatReportedDate(event.created_at);

  if (!ymd || !precision || !year) {
    return {
      primary: "Incident date unknown",
      secondary: reported ? `Reported ${reported}` : "Reported date unknown",
    };
  }

  const showDetail = precision === "day" && isWithinLastMonths(ymd, 24);
  const incidentLabel = showDetail
    ? `Occurred ${formatDate(ymd, precision, "short")}`
    : `Incident year ${year}`;
  const ageLabel = age == null ? null : `patient age ${age}`;
  return {
    primary: ageLabel ? `${incidentLabel}, ${ageLabel}` : incidentLabel,
    secondary: reported ? `Reported ${reported}` : null,
  };
}

export function formatTimelineDateDetail(
  event: Pick<NormalizedTimelineEvent, "occurred_at" | "date_precision" | "created_at">,
  dob?: string | null,
): { incident: string; reported: string; sentence: string } {
  const ymd = event.occurred_at;
  const precision = event.date_precision;
  const year = ymd ? parseYmd(ymd)?.getFullYear() ?? null : null;
  const age = ageAtIncident(dob, ymd);
  const incident = ymd && precision ? formatDate(ymd, precision, "long") : "Incident date unknown";
  const reported = formatReportedDate(event.created_at) ?? "Reported date unknown";
  const sentence = year
    ? `Occurred in ${year}${age == null ? "" : `, when the patient was ${age} years old`}.`
    : "Incident date is unknown.";
  return { incident, reported, sentence };
}

export function formatDate(ymd: string, precision: DatePrecision, style: "short" | "long" = "long"): string {
  const dt = parseYmd(ymd);
  if (!dt) return "Date unknown";
  if (precision === "year") return `${dt.getFullYear()}`;
  if (precision === "month") {
    return dt.toLocaleDateString(undefined, { month: "long", year: "numeric" });
  }
  return dt.toLocaleDateString(undefined, {
    month: style === "short" ? "short" : "long",
    day: "numeric",
    year: "numeric",
  });
}

export type ClinicalTag = { label: string; value: string };

export type TimelineEventSaveDraft = {
  title: string;
  summary: string;
  occurred_at: string;
  date_precision: DatePrecision;
  category: string;
  event_type: string;
  tagsCsv: string;
};

export type TimelineEventSavePayload = {
  title: string;
  summary: string;
  occurred_at: string | null;
  date_precision: DatePrecision | null;
  category: string;
  event_type: string;
  tags: string[];
};

export type TimelineEventSavePayloadResult =
  | { ok: true; payload: TimelineEventSavePayload }
  | { ok: false; error: string };

export function buildTimelineEventSavePayload(
  draft: TimelineEventSaveDraft,
): TimelineEventSavePayloadResult {
  const rawDate = draft.occurred_at.trim();
  let normalizedOccurredAt: string | null = null;

  if (rawDate) {
    const acceptable: Record<DatePrecision, RegExp[]> = {
      day:   [/^\d{4}-\d{2}-\d{2}$/],
      month: [/^\d{4}-\d{2}$/,  /^\d{4}-\d{2}-\d{2}$/],
      year:  [/^\d{4}$/,        /^\d{4}-\d{2}-\d{2}$/],
    };
    if (!acceptable[draft.date_precision].some((re) => re.test(rawDate))) {
      return {
        ok: false,
        error:
          draft.date_precision === "year"  ? "Date must be in YYYY or YYYY-MM-DD format." :
          draft.date_precision === "month" ? "Date must be in YYYY-MM or YYYY-MM-DD format." :
                                             "Date must be in YYYY-MM-DD format.",
      };
    }

    normalizedOccurredAt = normalizeStoredDate(rawDate);
    if (!normalizedOccurredAt) {
      return {
        ok: false,
        error:
          draft.date_precision === "day" ? "Date must be a real date in YYYY-MM-DD format." :
          draft.date_precision === "month" ? "Date must be in YYYY-MM or YYYY-MM-DD format." :
                                             "Date must be in YYYY or YYYY-MM-DD format.",
      };
    }
  }

  return {
    ok: true,
    payload: {
      title:          draft.title.trim() || "Untitled event",
      summary:        draft.summary.trim(),
      occurred_at:    normalizedOccurredAt,
      date_precision: normalizedOccurredAt ? draft.date_precision : null,
      category:       draft.category.trim() || "Other",
      event_type:     draft.event_type.trim() || "other",
      tags:           normalizeTagsCsv(draft.tagsCsv),
    },
  };
}

export function clinicalTagsForEvent(
  event: Pick<NormalizedTimelineEvent, "title" | "summary" | "category" | "event_type" | "tags" | "data">,
): ClinicalTag[] {
  const tags: ClinicalTag[] = [];
  const text = `${event.title} ${event.summary} ${event.category} ${event.event_type} ${event.tags.join(" ")}`;
  const side = detectSide(text);
  if (side) tags.push({ label: "Side", value: side });

  for (const body of ["thumb", "knee", "shoulder", "hip", "ankle", "wrist", "elbow", "back", "neck", "foot", "hand"]) {
    if (wordIncludes(text, body)) {
      tags.push({ label: "Body Part", value: capitalizeClinical(body) });
      break;
    }
  }

  const category = String(event.category ?? "").toLowerCase();
  const type = String(event.event_type ?? "").toLowerCase();
  if (category.includes("med") || type.includes("med")) tags.push({ label: "Medication", value: "Medication" });
  if (type.includes("surgery") || wordIncludes(text, "surgery")) tags.push({ label: "Surgery", value: "Surgery" });
  if (type.includes("procedure") || wordIncludes(text, "procedure")) tags.push({ label: "Procedure", value: "Procedure" });
  if (type.includes("diagn") || wordIncludes(text, "diagnosis")) tags.push({ label: "Diagnosis", value: "Diagnosis" });
  if (wordIncludes(text, "injury") || wordIncludes(text, "fracture")) tags.push({ label: "Injury", value: "Injury" });
  if (wordIncludes(text, "pain") || wordIncludes(text, "symptom")) tags.push({ label: "Symptom", value: "Symptom" });

  return dedupeTags(tags).slice(0, 6);
}

export function normalizeClinicalLabel(label: string): string {
  const trimmed = label
    .replace(/_/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .trim();
  if (!trimmed) return "Clinical Detail";
  if (/^(l|left)$/i.test(trimmed)) return "Left";
  if (/^(r|right)$/i.test(trimmed)) return "Right";
  return trimmed
    .split(/\s+/)
    .map((part) => /^(l|r)$/i.test(part) ? part.toUpperCase() : capitalizeClinical(part))
    .join(" ");
}

function isWithinLastMonths(ymd: string | null | undefined, months: number): boolean {
  const dt = parseYmd(ymd);
  if (!dt) return false;
  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - months);
  return dt.getTime() >= cutoff.getTime();
}

function formatReportedDate(value?: string | null): string | null {
  const dt = parseYmd(value);
  if (!dt) return null;
  return dt.toLocaleDateString(undefined, { month: "long", year: "numeric" });
}

function parseYmd(value?: string | null): Date | null {
  const ymd = normalizeStoredDate(value);
  if (!ymd) return null;
  const [y, m, d] = ymd.split("-").map(Number);
  if (!y || !m || !d) return null;
  const dt = new Date(y, m - 1, d);
  return Number.isNaN(dt.getTime()) ? null : dt;
}

function isValidYmd(year: number, month: number, day: number): boolean {
  if (!year || !month || !day) return false;
  const dt = new Date(year, month - 1, day);
  return (
    dt.getFullYear() === year &&
    dt.getMonth() === month - 1 &&
    dt.getDate() === day
  );
}

function normalizeTags(tags: unknown): string[] {
  return Array.isArray(tags)
    ? tags.map((tag) => String(tag ?? "").trim()).filter(Boolean)
    : [];
}

function normalizeTagsCsv(tagsCsv: string): string[] {
  const seen = new Set<string>();
  const tags: string[] = [];
  for (const raw of tagsCsv.split(",")) {
    const tag = raw.trim();
    const key = tag.toLowerCase();
    if (!tag || seen.has(key)) continue;
    seen.add(key);
    tags.push(tag);
  }
  return tags;
}

function stringOr(value: unknown, fallback: string): string {
  const s = String(value ?? "").trim();
  return s || fallback;
}

function stringOrNull(value: unknown): string | null {
  const s = String(value ?? "").trim();
  return s || null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function detectSide(text: string): string | null {
  if (/\b(left|lt|l)\b/i.test(text)) return "Left";
  if (/\b(right|rt|r)\b/i.test(text)) return "Right";
  return null;
}

function wordIncludes(text: string, word: string): boolean {
  return new RegExp(`\\b${word}\\b`, "i").test(text);
}

function capitalizeClinical(value: string): string {
  return value ? value.charAt(0).toUpperCase() + value.slice(1).toLowerCase() : value;
}

function dedupeTags(tags: ClinicalTag[]): ClinicalTag[] {
  const seen = new Set<string>();
  return tags.filter((tag) => {
    const key = `${tag.label}:${tag.value}`.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
