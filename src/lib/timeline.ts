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
  return {
    id: stringOr(row.id, ""),
    occurred_at: normalizeStoredDate(row.occurred_at),
    date_precision: normalizePrecision(row.date_precision, row.occurred_at),
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
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10);
  if (/^\d{4}-\d{2}$/.test(raw)) return `${raw}-01`;
  if (/^\d{4}$/.test(raw)) return `${raw}-01-01`;
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

  return dedupeTags(tags).slice(0, 5);
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

export function timelineMatchesQuery(event: NormalizedTimelineEvent, query: string): boolean {
  const q = normalizeSearchText(query);
  if (!q) return true;
  const haystack = normalizeSearchText([
    event.title,
    event.summary,
    event.category,
    event.event_type,
    event.source,
    event.documentTitle,
    event.occurred_at,
    event.created_at,
    event.tags.join(" "),
    JSON.stringify(event.data ?? {}),
    clinicalTagsForEvent(event).map((t) => `${t.label} ${t.value}`).join(" "),
  ].filter(Boolean).join(" "));

  const years = q.match(/\b(19|20)\d{2}\b/g) ?? [];
  if (years.length > 0 && !years.some((year) => haystack.includes(year))) return false;

  const stop = new Set(["show", "me", "all", "find", "my", "what", "was", "i", "taking", "after", "for", "from", "the", "timeline"]);
  const terms = q.split(/\s+/).filter((term) => term.length > 1 && !stop.has(term) && !/^(19|20)\d{2}$/.test(term));
  return terms.every((term) => haystack.includes(term));
}

export function healthCardMatchesQuery(card: unknown, query: string): boolean {
  const q = normalizeSearchText(query);
  if (!q || !card) return false;
  const haystack = normalizeSearchText(JSON.stringify(card));
  const years = q.match(/\b(19|20)\d{2}\b/g) ?? [];
  if (years.length > 0 && !years.some((year) => haystack.includes(year))) return false;
  const stop = new Set(["show", "me", "all", "find", "my", "what", "was", "i", "taking", "after", "for", "from", "the", "timeline", "health", "card"]);
  const terms = q.split(/\s+/).filter((term) => term.length > 1 && !stop.has(term) && !/^(19|20)\d{2}$/.test(term));
  return terms.length > 0 && terms.every((term) => haystack.includes(term));
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

function normalizeTags(tags: unknown): string[] {
  return Array.isArray(tags)
    ? tags.map((tag) => String(tag ?? "").trim()).filter(Boolean)
    : [];
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

function normalizeSearchText(value: string): string {
  return value
    .toLowerCase()
    .replace(/\bleft\b/g, "left l")
    .replace(/\bright\b/g, "right r")
    .replace(/[^a-z0-9\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
