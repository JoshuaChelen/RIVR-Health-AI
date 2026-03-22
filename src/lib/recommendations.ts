/**
 * Shared recommendation normalization and filtering.
 * Used by HomeScreen (mini card preview) and AIInsightsScreen (full page).
 *
 * Design philosophy:
 *   Quality > quantity. Every item must answer one of:
 *     - What should the user DO next?
 *     - What specific information is MISSING?
 *     - What concrete follow-up is needed?
 *
 * Source priority (structured path):
 *   1. summary_json.recommendations[]  — structured, from current worker
 *   2. evalResult.recommendations[]    — structured, evaluation-level fallback
 *
 * Legacy fallback (when no structured recommendations exist):
 *   1. missing_info  → shown first, priority "medium"
 *   2. suggested_next_steps → filtered; generic lifestyle items suppressed
 *   3. risk_flags → included only when paired with a clear action verb
 *   — highlights are NOT converted to recommendations (positive notes, not actions)
 */

import { colors } from "../theme/tokens";

// ─── Types ────────────────────────────────────────────────────────────────────

export type Category =
  | "Follow-up"
  | "Missing info"
  | "Monitoring"
  | "Lifestyle"
  | "Medication"
  | "Safety"
  | "Info";

export type Priority = "high" | "medium" | "low";

export type SourceType =
  | "structured"
  | "next_step"
  | "missing_info"
  | "risk_flag"
  | "evaluation";

export type RecommendationItem = {
  id: string;
  title: string;
  body: string;
  details?: string;
  fullTitle?: string;
  fullBody?: string;
  category: Category;
  priority: Priority;
  sourceType: SourceType;
  actionLabel?: string;
  actionType?: string;
};

// ─── Style maps ───────────────────────────────────────────────────────────────

export const CATEGORY_STYLE: Record<Category, { bg: string; text: string }> = {
  "Missing info": { bg: colors.blueSoft,    text: colors.blue },
  "Follow-up":   { bg: colors.tealSoft,    text: colors.teal },
  "Monitoring":  { bg: colors.orangeSoft,  text: colors.orange },
  "Medication":  { bg: colors.blueSoft,    text: colors.blue },
  "Safety":      { bg: colors.dangerSoft,  text: colors.danger },
  "Lifestyle":   { bg: colors.greenSoft,   text: colors.green },
  "Info":        { bg: colors.bgSecondary, text: colors.muted },
};

export const PRIORITY_ACCENT: Record<Priority, string> = {
  high:   colors.danger,
  medium: colors.orange,
  low:    colors.teal,
};

// ─── Sort & filter constants ──────────────────────────────────────────────────

const CATEGORY_SORT_ORDER: Record<Category, number> = {
  "Missing info": 0,
  "Follow-up":   1,
  "Monitoring":  2,
  "Medication":  3,
  "Safety":      4,
  "Lifestyle":   5,
  "Info":        6,
};

const PRIORITY_SORT_ORDER: Record<Priority, number> = {
  high:   0,
  medium: 1,
  low:    2,
};

const MAX_RECS = 6;

/**
 * Matches generic lifestyle phrasing that adds no specific actionable value.
 * Used to suppress weak items from both structured and legacy paths.
 */
const GENERIC_LIFESTYLE_RE =
  /\b(maintain\s+(a\s+)?(healthy|good|active|balanced)|exercise\s+more|sleep\s+(better|more|longer)|eat\s+(well|healthi?er?|better|right|balanced)|reduce\s+stress|stay\s+(active|hydrated)|healthy\s+habits?|monitor\s+your\s+(health\s+generally|overall\s+health)|balanced\s+diet|keep\s+up\s+(the\s+)?(good|healthy)|general(ly)?\s+(health|wellness)|overall\s+(health|wellness))\\b/i;

/**
 * Matches risk_flag text that contains a clear action verb — these are worth
 * converting to a recommendation. Flags with no action verb are passive
 * observations and should not be surfaced.
 */
const ACTIONABLE_FLAG_RE =
  /\b(schedule|monitor|track|review|discuss|check|follow[\s-]up|recheck|refer|consult|test|screen|measure|upload|add|confirm)\b/i;

// ─── Smart CTA inference ──────────────────────────────────────────────────────

/**
 * Infer the best CTA label + action_type from recommendation text and category.
 *
 * Routing logic (in priority order):
 *   1. Apple Health / wearable / activity / vitals keywords → Connect Health
 *   2. Schedule / discuss / see a clinician               → no CTA (external)
 *   3. Everything else (missing data, labs, records, etc) → Add Data
 *
 * "Add Data" (navigate_documents) is the default because the most common
 * in-app action for health data gaps is uploading records or documents.
 */
export function inferAction(
  text: string,
  _category: Category,
): { actionLabel: string; actionType: string } | undefined {
  const l = text.toLowerCase();

  // Apple Health / wearable / activity / vitals → Connect Health
  if (
    /\b(apple\s+health|connect\s+health|steps|step\s+count|heart\s+rate|resting\s+hr|sleep\s+(data|tracking|duration|pattern)|active\s+energy|activity\s+(data|level|tracking)|wearable|healthkit|calories\s+burned|exercise\s+minutes)\b/.test(l)
  ) {
    return { actionLabel: "Connect Health", actionType: "navigate_apple_health" };
  }

  // Schedule / discuss with a clinician → no CTA (can't deep-link to external action)
  if (
    /\b(schedule|book\s+an?\s+appointment|call\s+your|contact\s+your|speak\s+to|discuss\s+with|see\s+your|visit\s+your|make\s+an?\s+appointment)\b/.test(l)
  ) {
    return undefined;
  }

  // Default: Add Data (documents). Covers missing info, labs, records, scans,
  // profile data gaps, medication lists, discharge summaries, etc.
  return { actionLabel: "Add Data", actionType: "navigate_documents" };
}

// ─── Quality filter + sort ─────────────────────────────────────────────────────

/**
 * Apply the shared quality gate, category sort, and item cap.
 * Used for both the structured and legacy paths.
 */
function filterAndSort(items: RecommendationItem[]): RecommendationItem[] {
  return items
    .filter((item) => {
      if (!item.title) return false;

      // Safety items must be high-priority — medium/low safety is observational
      if (item.category === "Safety" && item.priority !== "high") return false;

      // Lifestyle items must pass the specificity test
      if (item.category === "Lifestyle") {
        const combined = `${item.title} ${item.body}`.toLowerCase();
        if (GENERIC_LIFESTYLE_RE.test(combined)) return false;
      }

      return true;
    })
    .sort((a, b) => {
      const catDiff = CATEGORY_SORT_ORDER[a.category] - CATEGORY_SORT_ORDER[b.category];
      if (catDiff !== 0) return catDiff;
      return PRIORITY_SORT_ORDER[a.priority] - PRIORITY_SORT_ORDER[b.priority];
    })
    .slice(0, MAX_RECS);
}

// ─── Structured-path mapping ──────────────────────────────────────────────────

const STRUCTURED_CATEGORY_MAP: Record<string, Category> = {
  follow_up:    "Follow-up",
  missing_info: "Missing info",
  monitoring:   "Monitoring",
  lifestyle:    "Lifestyle",
  safety:       "Safety",
  medication:   "Medication",
  preventive:   "Info",
};

/**
 * Resolve the action_label ↔ action_type pair from AI output.
 * Returns undefined if the pair maps to "Edit Profile" / navigate_profile —
 * those are overridden downstream by inferAction().
 */
function resolveActionPair(
  rawLabel: string | undefined,
  rawType: string | undefined,
): { actionLabel: string; actionType: string } | undefined {
  const LABEL_TO_TYPE: Record<string, string> = {
    "Add Data":      "navigate_documents",
    "Open Documents": "navigate_documents", // legacy label compat
    "Connect Health": "navigate_apple_health",
  };
  const TYPE_TO_LABEL: Record<string, string> = {
    navigate_documents:    "Add Data",
    navigate_apple_health: "Connect Health",
  };

  const label = typeof rawLabel === "string" && rawLabel ? rawLabel : undefined;
  const type  = typeof rawType  === "string" && rawType  ? rawType  : undefined;

  // navigate_profile / "Edit Profile" → discard; let inferAction decide
  if (type === "navigate_profile" || label === "Edit Profile") return undefined;

  if (label && type) return { actionLabel: label, actionType: type };
  if (label && LABEL_TO_TYPE[label]) return { actionLabel: label, actionType: LABEL_TO_TYPE[label] };
  if (type  && TYPE_TO_LABEL[type])  return { actionLabel: TYPE_TO_LABEL[type], actionType: type };
  return undefined;
}

export function normalizeStructuredRec(r: any, index: number): RecommendationItem {
  const id        = typeof r.id === "string" && r.id ? r.id : `rec_${index}`;
  const title     = typeof r.title      === "string" ? r.title.trim()      : "";
  const body      = typeof r.body       === "string" ? r.body.trim()       : "";
  const details   = typeof r.details    === "string" ? r.details.trim()    : "";
  const fullTitle = typeof r.full_title === "string" ? r.full_title.trim() : "";
  const fullBody  = typeof r.full_body  === "string" ? r.full_body.trim()  : "";
  const rawCat    = typeof r.category   === "string" ? r.category          : "follow_up";
  const category: Category = STRUCTURED_CATEGORY_MAP[rawCat] ?? "Info";
  const rawPri   = typeof r.priority === "string" ? r.priority : "medium";
  const priority: Priority = (["high", "medium", "low"] as const).includes(rawPri as Priority)
    ? (rawPri as Priority)
    : "medium";

  const action =
    resolveActionPair(r.action_label, r.action_type) ??
    inferAction(`${title} ${body} ${details}`, category) ??
    {};

  return {
    id,
    title,
    body,
    ...(details   ? { details }               : {}),
    ...(fullTitle ? { fullTitle }             : {}),
    ...(fullBody  ? { fullBody }              : {}),
    category,
    priority,
    sourceType: "structured",
    ...action,
  };
}

// ─── Legacy-path helpers ──────────────────────────────────────────────────────

export function parseRecommendation(text: string): { title: string; body: string } {
  const t = text.trim();
  const sentenceBreak = t.match(/^([^.!?\n]{15,75}[.!?])\s+(.+)$/s);
  if (sentenceBreak) {
    return {
      title: sentenceBreak[1].replace(/[.!?]$/, "").trim(),
      body:  sentenceBreak[2].trim(),
    };
  }
  if (t.length > 78) {
    const cut = t.lastIndexOf(" ", 72);
    if (cut > 20) return { title: t.slice(0, cut), body: t.slice(cut + 1) };
  }
  return { title: t, body: "" };
}

export function detectCategory(text: string): Category {
  const l = text.toLowerCase();
  if (/\bmedication|med\b|prescription|refill|dosage\b/.test(l))               return "Medication";
  if (/\bmissing|incomplete|add your|upload your|provide your\b/.test(l))      return "Missing info";
  if (/diet|exercise|weight\b|lifestyle|nutrition|sleep\b|smoking|alcohol/.test(l)) return "Lifestyle";
  if (/urgent|critical|severe|emergenc|immediately\b/.test(l))                 return "Safety";
  if (/monitor|track\b|measure|screening|blood pressure|glucose|cholesterol|lab\b/.test(l)) return "Monitoring";
  return "Follow-up";
}

/**
 * Returns true if a legacy suggested_next_step is too generic to be shown.
 * Only lifestyle-typed steps that match the generic pattern are suppressed;
 * other categories are kept.
 */
function isGenericLegacyStep(text: string): boolean {
  if (detectCategory(text) !== "Lifestyle") return false;
  return GENERIC_LIFESTYLE_RE.test(text.toLowerCase());
}

// ─── Main entry point ─────────────────────────────────────────────────────────

/**
 * Build a filtered, sorted list of RecommendationItems.
 *
 * Structured path (preferred):
 *   summary_json.recommendations[] or evalResult.recommendations[]
 *   → normalized → quality-filtered → category-sorted → capped at MAX_RECS
 *
 * Legacy fallback (when no structured recommendations exist):
 *   1. missing_info items (priority: medium)
 *   2. suggested_next_steps (generic lifestyle items suppressed)
 *   3. risk_flags with clear action verbs (actionable only)
 *   highlights are NOT included — they are observations, not patient actions.
 */
export function buildRecommendations(
  summaryJson: any,
  evalResult: any,
): RecommendationItem[] {
  // ── Structured path ───────────────────────────────────────────────────────
  const structuredRaw: unknown[] =
    Array.isArray(summaryJson?.recommendations) && summaryJson.recommendations.length > 0
      ? summaryJson.recommendations
      : Array.isArray(evalResult?.recommendations) && evalResult.recommendations.length > 0
        ? evalResult.recommendations
        : [];

  if (structuredRaw.length > 0) {
    const items = structuredRaw
      .map((r, i) => normalizeStructuredRec(r, i))
      .filter((item) => item.title);
    return filterAndSort(items);
  }

  // ── Legacy fallback ───────────────────────────────────────────────────────
  const items: RecommendationItem[] = [];
  let counter = 0;
  const uid = () => String(counter++);

  // 1. missing_info — always shown first, priority "medium"
  //    These represent specific data gaps that improve AI accuracy.
  const missing: unknown[] = Array.isArray(summaryJson?.missing_info)
    ? summaryJson.missing_info : [];
  missing.forEach((m) => {
    const cleanText = typeof m === "string" ? m.replace(/\s+/g, " ").trim() : "";
    if (!cleanText) return;
    // Use the real text as the title — the UI will clamp it when collapsed
    // and show it in full when expanded. No placeholder text.
    const title  = cleanText;
    const body   = "";
    const action = inferAction(`${title} ${cleanText}`, "Missing info") ??
      { actionLabel: "Add Data", actionType: "navigate_documents" };
    items.push({
      id: uid(),
      title,
      body,
      category: "Missing info",
      priority: "medium",
      sourceType: "missing_info",
      ...action,
    });
  });

  // 2. suggested_next_steps — filtered: generic lifestyle items are suppressed
  const steps: unknown[] = Array.isArray(summaryJson?.suggested_next_steps)
    ? summaryJson.suggested_next_steps : [];
  steps.forEach((step, i) => {
    const text = typeof step === "string" ? step.trim() : "";
    if (!text || isGenericLegacyStep(text)) return;
    const { title, body } = parseRecommendation(text);
    const category = detectCategory(text);
    const action = inferAction(text, category);
    items.push({
      id: uid(),
      title,
      body,
      category,
      priority: i < 2 ? "high" : "medium",
      sourceType: "next_step",
      ...action,
    });
  });

  // 3. risk_flags — included only when paired with a clear action verb.
  //    Passive observations ("You have hypertension") are excluded.
  const flags: unknown[] = Array.isArray(summaryJson?.risk_flags)
    ? summaryJson.risk_flags : [];
  flags.forEach((flag) => {
    const text = typeof flag === "string" ? flag.trim() : "";
    if (!text || !ACTIONABLE_FLAG_RE.test(text)) return;
    const { title, body } = parseRecommendation(text);
    const category = detectCategory(text);
    if (isGenericLegacyStep(text)) return;
    const action = inferAction(text, category);
    items.push({
      id: uid(),
      title,
      body,
      category,
      priority: "medium",
      sourceType: "risk_flag",
      ...action,
    });
  });

  // highlights → intentionally excluded.
  //   Positive observations are not action recommendations.

  // 4. Evaluation fallback when summary_json produced nothing
  if (items.length === 0 && evalResult) {
    const evalSteps: unknown[] = Array.isArray(evalResult?.suggested_next_steps)
      ? evalResult.suggested_next_steps : [];
    evalSteps.forEach((step, i) => {
      const text = typeof step === "string" ? step.trim() : "";
      if (!text || isGenericLegacyStep(text)) return;
      const { title, body } = parseRecommendation(text);
      const category = detectCategory(text);
      const action = inferAction(text, category);
      items.push({
        id: uid(),
        title,
        body,
        category,
        priority: i < 2 ? "high" : "medium",
        sourceType: "evaluation",
        ...action,
      });
    });
  }

  return filterAndSort(items);
}
