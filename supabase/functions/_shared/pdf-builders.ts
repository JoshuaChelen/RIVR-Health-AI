/// <reference types="jsr:@supabase/functions-js/edge-runtime.d.ts" />

import { PDFDocument, rgb, StandardFonts } from "npm:pdf-lib@1.17.1";

// ── Brand colors ───────────────────────────────────────────────────────────────
const TEAL      = rgb(0.122, 0.678, 0.651);   // #1FADA6
const DARK      = rgb(0.051, 0.106, 0.165);   // #0D1B2A
const TEXT_SUB  = rgb(0.239, 0.322, 0.420);   // #3D526B
const MUTED     = rgb(0.392, 0.447, 0.545);   // #64748B
const SUBTLE    = rgb(0.580, 0.639, 0.722);   // #94A3B8
const BORDER    = rgb(0.894, 0.925, 0.945);   // #E4ECF2
const TEAL_SOFT = rgb(0.902, 0.980, 0.973);   // #E6FAF8
const PAGE_BG   = rgb(0.961, 0.973, 0.980);   // #F5F8FA
const WHITE     = rgb(1, 1, 1);
const BLUE      = rgb(0.145, 0.388, 0.922);
const GREEN     = rgb(0.022, 0.588, 0.412);
const ORANGE    = rgb(0.918, 0.486, 0.169);

// ── Page constants (US Letter) ─────────────────────────────────────────────────
const PW = 612;
const PH = 792;
const M  = 56;
const CW = PW - M * 2; // 500pt content width

// ── Text sanitiser ─────────────────────────────────────────────────────────────
function clean(s: unknown): string {
  if (s == null) return "";
  return String(s)
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/\u2013/g, "-")
    .replace(/\u2014/g, "--")
    .replace(/\u2026/g, "...")
    .replace(/\u00B7/g, "*")
    .replace(/[^\x00-\xFF]/g, "")
    .trim();
}

function arrStr(arr: unknown, fallback = "None listed"): string {
  if (!Array.isArray(arr) || arr.length === 0) return fallback;
  const s = arr.map((x) => clean(x)).filter(Boolean).join(", ");
  return s || fallback;
}

// ── Word wrap ─────────────────────────────────────────────────────────────────
function wrap(text: string, font: any, size: number, maxW: number): string[] {
  if (!text) return [];
  const result: string[] = [];
  for (const raw of text.split("\n")) {
    const words = raw.split(" ").filter(Boolean);
    if (!words.length) { result.push(""); continue; }
    let line = "";
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word;
      if (line && font.widthOfTextAtSize(candidate, size) > maxW) {
        result.push(line);
        line = word;
      } else {
        line = candidate;
      }
    }
    if (line) result.push(line);
  }
  return result;
}

// ── Shared page drawing ───────────────────────────────────────────────────────

function drawTopBar(page: any): void {
  page.drawRectangle({ x: 0, y: PH - 6, width: PW, height: 6, color: TEAL });
}

function drawPageHeader(
  page: any,
  title: string,
  subtitle: string,
  bold: any,
  regular: any,
): number {
  drawTopBar(page);
  page.drawText("RIVR HEALTH", {
    x: M, y: PH - 28,
    size: 7.5, font: bold, color: TEAL, characterSpacing: 1.6,
  });
  page.drawText(title, { x: M, y: PH - 52, size: 22, font: bold, color: DARK });
  if (subtitle) {
    page.drawText(subtitle, { x: M, y: PH - 74, size: 10, font: regular, color: MUTED });
  }
  page.drawLine({
    start: { x: M, y: PH - 88 }, end: { x: PW - M, y: PH - 88 },
    thickness: 0.75, color: BORDER,
  });
  return PH - 104;
}

function drawContinuationHeader(page: any, label: string, regular: any): number {
  drawTopBar(page);
  page.drawText(label, { x: M, y: PH - 24, size: 8, font: regular, color: MUTED });
  page.drawLine({
    start: { x: M, y: PH - 32 }, end: { x: PW - M, y: PH - 32 },
    thickness: 0.5, color: BORDER,
  });
  return PH - 48;
}

function drawSectionLabel(page: any, text: string, x: number, y: number, bold: any): number {
  page.drawText(text.toUpperCase(), {
    x, y, size: 8, font: bold, color: TEAL, characterSpacing: 1.3,
  });
  return y - 16;
}

function drawParagraph(
  page: any, text: string, x: number, y: number,
  size: number, font: any, color: any, maxW: number, lineH: number,
): number {
  for (const line of wrap(clean(text), font, size, maxW)) {
    if (y < 60) break;
    page.drawText(line || " ", { x, y, size, font, color });
    y -= lineH;
  }
  return y;
}

function drawFooters(pages: any[], regular: any): void {
  const total = pages.length;
  pages.forEach((p, i) => {
    p.drawText(`Page ${i + 1} of ${total}  ·  RIVR Health  ·  Confidential`, {
      x: M, y: 20, size: 7, font: regular, color: SUBTLE,
    });
  });
}

// ── Date helper ───────────────────────────────────────────────────────────────
function evDate(ymd: string, precision: string): string {
  if (!ymd) return "";
  try {
    const [y, m, d] = ymd.split("-").map(Number);
    const dt = new Date(y, (m || 1) - 1, d || 1);
    if (precision === "year")  return String(dt.getFullYear());
    if (precision === "month") return dt.toLocaleDateString("en-US", { month: "short", year: "numeric" });
    return dt.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  } catch { return ymd; }
}

// ── Category style (shared across timeline PDFs) ──────────────────────────────

const CAT_STYLES: Record<string, { dot: any; bg: any; label: string }> = {
  medications: { dot: BLUE,  bg: rgb(0.94, 0.96, 1.00), label: "Medications" },
  vitals:      { dot: GREEN, bg: rgb(0.94, 1.00, 0.97), label: "Vitals"      },
  labs:        { dot: GREEN, bg: rgb(0.94, 1.00, 0.97), label: "Labs"        },
  lifestyle:   { dot: rgb(0.745, 0.094, 0.365), bg: rgb(1.00, 0.94, 0.97), label: "Lifestyle" },
};

function getCatStyle(cat: string): { dot: any; bg: any; label: string } {
  const key = Object.keys(CAT_STYLES).find((k) => (cat ?? "").toLowerCase().includes(k));
  return key ? CAT_STYLES[key] : { dot: ORANGE, bg: rgb(1.00, 0.97, 0.94), label: clean(cat) || "Other" };
}

// ── Timeline grouping helpers ─────────────────────────────────────────────────

function yearMonthKey(ymd: string, precision: string): string {
  if (!ymd) return "unknown";
  const [y, m] = ymd.split("-").map(Number);
  if (precision === "year") return String(y || "?");
  return `${y || "?"}-${String(m || 1).padStart(2, "0")}`;
}

function yearMonthLabel(ymd: string, precision: string): string {
  if (!ymd) return "Unknown";
  try {
    const [y, m, d] = ymd.split("-").map(Number);
    const dt = new Date(y, (m || 1) - 1, d || 1);
    if (precision === "year") return String(dt.getFullYear());
    return dt.toLocaleDateString("en-US", { month: "long", year: "numeric" });
  } catch { return ymd; }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Full Summary PDF
// ═══════════════════════════════════════════════════════════════════════════════

export async function buildFullSummaryPdf(data: {
  score?: number | null;
  label?: string | null;
  overview?: string | null;
  full_summary_markdown?: string | null;
  disclaimer?: string | null;
}): Promise<Uint8Array> {
  const doc     = await PDFDocument.create();
  const bold    = await doc.embedFont(StandardFonts.HelveticaBold);
  const regular = await doc.embedFont(StandardFonts.Helvetica);

  const pages: any[] = [];
  const newPage = () => { const p = doc.addPage([PW, PH]); pages.push(p); return p; };

  const dateStr = new Date().toLocaleDateString("en-US", {
    weekday: "long", year: "numeric", month: "long", day: "numeric",
  });

  let page = newPage();
  let y    = drawPageHeader(page, "AI Health Summary", `Generated ${dateStr}`, bold, regular);

  // ── SHIN Score ──────────────────────────────────────────────────────────────
  if (typeof data.score === "number") {
    y -= 0;
    y = drawSectionLabel(page, "SHIN Score", M, y, bold);
    y += 10; // breathing room below section label

    const scoreStr = String(data.score);
    const scoreW   = bold.widthOfTextAtSize(scoreStr, 44);
    const scoreY   = y - 34; // baseline of the 44pt number

    // Big score number
    page.drawText(scoreStr, { x: M, y: scoreY, size: 44, font: bold, color: TEAL });

    // "/100" aligned near the top of the score (superscript-ish)
    page.drawText("/100", {
      x: M + scoreW + 10,
      y: scoreY + 20,
      size: 13,
      font: regular,
      color: MUTED,
    });

    // Label badge on its own row below the score
    if (data.label) {
      const lt     = clean(data.label);
      const lw     = bold.widthOfTextAtSize(lt, 9.5) + 18; 
      const lx  = M + scoreW + regular.widthOfTextAtSize("/100", 13) + 14;
      const ly2 = y - 24;
      page.drawRectangle({ x: lx, y: ly2, width: lw, height: 20, color: TEAL_SOFT, borderColor: TEAL, borderWidth: 0.5 });
      page.drawText(lt, { x: lx + 9, y: ly2 + 5.5, size: 9.5, font: bold, color: TEAL }); 
      y -= 58;
    } else {
      y -= 58;
    }
  }

  // ── Overview ────────────────────────────────────────────────────────────────
  if (data.overview) {
    y -= 4;
    y = drawSectionLabel(page, "Overview", M, y, bold);
    y = drawParagraph(page, data.overview, M, y, 11, regular, DARK, CW, 16);
    y -= 10;
  }

  // Divider
  page.drawLine({ start: { x: M, y }, end: { x: PW - M, y }, thickness: 0.5, color: BORDER });
  y -= 18;

  // ── Full analysis body ──────────────────────────────────────────────────────
  if (data.full_summary_markdown) {
    y = drawSectionLabel(page, "Full Health Analysis", M, y, bold);
    y -= 6;

    for (const raw of clean(data.full_summary_markdown).split("\n")) {
      if (y < 80) {
        page = newPage();
        y = drawContinuationHeader(page, "RIVR HEALTH  ·  AI Health Summary (continued)", regular);
      }
      const line = raw.trimEnd();

      if (line.startsWith("## ")) {
        y -= 8;
        page.drawText(clean(line.replace(/^##\s*/, "")), { x: M, y, size: 12.5, font: bold, color: DARK });
        y -= 4;
        page.drawLine({ start: { x: M, y }, end: { x: M + CW * 0.55, y }, thickness: 0.4, color: BORDER });
        y -= 12;
      } else if (line.startsWith("# ")) {
        y -= 10;
        page.drawText(clean(line.replace(/^#\s*/, "")), { x: M, y, size: 15, font: bold, color: DARK });
        y -= 18;
      } else if (/^[-*]\s/.test(line)) {
        const bullet = "• " + clean(line.replace(/^[-*]\s*/, "").replace(/\*\*/g, ""));
        for (const bl of wrap(bullet, regular, 10, CW - 16)) {
          if (y < 80) { page = newPage(); y = drawContinuationHeader(page, "RIVR HEALTH  ·  AI Health Summary (continued)", regular); }
          page.drawText(bl, { x: M + 10, y, size: 10, font: regular, color: DARK });
          y -= 14;
        }
      } else if (line === "") {
        y -= 5;
      } else {
        const plain = clean(line.replace(/\*\*/g, "").replace(/\*/g, ""));
        for (const wl of wrap(plain, regular, 10, CW)) {
          if (y < 80) { page = newPage(); y = drawContinuationHeader(page, "RIVR HEALTH  ·  AI Health Summary (continued)", regular); }
          page.drawText(wl || " ", { x: M, y, size: 10, font: regular, color: TEXT_SUB });
          y -= 14;
        }
      }
    }
  }

  // ── Disclaimer ──────────────────────────────────────────────────────────────
  if (data.disclaimer) {
    y -= 14;
    page.drawLine({ start: { x: M, y }, end: { x: PW - M, y }, thickness: 0.5, color: BORDER });
    y -= 12;
    y = drawParagraph(page, data.disclaimer, M, y, 7.5, regular, SUBTLE, CW, 11);
  }

  drawFooters(pages, regular);
  return doc.save();
}

// ═══════════════════════════════════════════════════════════════════════════════
// 3×5 Health Card PDF
// ═══════════════════════════════════════════════════════════════════════════════

export async function buildCard3x5Pdf(cardData: any): Promise<Uint8Array> {
  const doc     = await PDFDocument.create();
  const bold    = await doc.embedFont(StandardFonts.HelveticaBold);
  const regular = await doc.embedFont(StandardFonts.Helvetica);

  const page = doc.addPage([PW, PH]);
  page.drawRectangle({ x: 0, y: 0, width: PW, height: PH, color: PAGE_BG });

  // Card geometry: 490 × 330, centered
  const CX  = (PW - 490) / 2;   // ≈ 61
  const CY  = (PH - 330) / 2;   // ≈ 231
  const CW2 = 490;
  const CH  = 330;

  // Shadow
  page.drawRectangle({ x: CX + 4, y: CY - 4, width: CW2, height: CH, color: BORDER });
  // Card body
  page.drawRectangle({ x: CX, y: CY, width: CW2, height: CH, color: WHITE, borderColor: BORDER, borderWidth: 1 });

  // Header band
  const HBAND = 50;
  page.drawRectangle({ x: CX, y: CY + CH - HBAND, width: CW2, height: HBAND, color: TEAL });

  const dateStr = new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  const dW = regular.widthOfTextAtSize(dateStr, 8);

  page.drawText("RIVR HEALTH", {
    x: CX + 16, y: CY + CH - 18, size: 7, font: bold, color: TEAL_SOFT, characterSpacing: 1.5,
  });
  page.drawText("HEALTH ESSENTIAL CARD", {
    x: CX + 16, y: CY + CH - 36, size: 11, font: bold, color: WHITE, characterSpacing: 0.4,
  });
  page.drawText(dateStr, {
    x: CX + CW2 - dW - 16, y: CY + CH - 18, size: 8, font: regular, color: TEAL_SOFT,
  });

  // Content area
  const INR  = CX + 18;
  const COL  = (CW2 - 36) / 2;  // ≈ 227pt per column
  let ly     = CY + CH - HBAND - 16;
  let ry     = ly;

  // Blood type — prominent
  page.drawText("BLOOD TYPE", { x: INR, y: ly, size: 6.5, font: bold, color: MUTED, characterSpacing: 0.6 });
  ly -= 3;
  page.drawText(clean(cardData?.blood_type ?? "Unknown"), { x: INR, y: ly - 20, size: 22, font: bold, color: TEAL });
  ly -= 44;

  // Field drawing helper
  const field = (label: string, val: string, x: number, y: number): number => {
    page.drawText(label.toUpperCase(), { x, y, size: 6.5, font: bold, color: MUTED, characterSpacing: 0.5 });
    y -= 13;
    const lines = wrap(val, regular, 9, COL - 4).slice(0, 2);
    for (const vl of lines) {
      page.drawText(vl, { x, y, size: 9, font: regular, color: DARK });
      y -= 12;
    }
    return y - 6;
  };

  // Left column
  ly = field("Major Conditions", arrStr(cardData?.major_conditions), INR, ly);
  ly = field("Medications",      arrStr(cardData?.current_meds),      INR, ly);
  ly = field("Anesthesia Notes", arrStr(cardData?.anesthesia_notes),  INR, ly);

  // Right column
  ry = field("Allergies", arrStr(cardData?.allergies),        INR + COL + 8, ry);
  ry = field("Surgeries", arrStr(cardData?.major_surgeries),  INR + COL + 8, ry);
  ry = field("Implants",  arrStr(cardData?.implants_devices), INR + COL + 8, ry);
  ry = field("Anticoag.", arrStr(cardData?.anticoagulants),   INR + COL + 8, ry);

  // Divider
  const divY = Math.min(ly, ry) - 6;
  page.drawLine({
    start: { x: CX + 16, y: divY }, end: { x: CX + CW2 - 16, y: divY },
    thickness: 0.5, color: BORDER,
  });

  // Emergency contact
  const ec = cardData?.emergency_contact;
  if (ec?.name || ec?.phone) {
    const ecY = divY - 16;
    page.drawText("EMERGENCY CONTACT", { x: INR, y: ecY, size: 6.5, font: bold, color: MUTED, characterSpacing: 0.5 });
    const ecText = [ec?.name, ec?.phone].filter(Boolean).map(clean).join("  ·  ");
    if (ecText) page.drawText(ecText, { x: INR, y: ecY - 12, size: 9, font: bold, color: DARK });
  }

  // One-line summary
  if (cardData?.one_line_summary) {
    const sl = wrap(clean(cardData.one_line_summary), regular, 8, CW2 - 36);
    if (sl.length) page.drawText(sl[0], { x: INR, y: CY + 14, size: 8, font: regular, color: MUTED });
  }

  // Below-card branding
  const brand = "Generated by RIVR Health AI  ·  Confidential  ·  For healthcare provider use";
  const bW    = regular.widthOfTextAtSize(brand, 8);
  page.drawText(brand, { x: (PW - bW) / 2, y: CY - 20, size: 8, font: regular, color: SUBTLE });

  return doc.save();
}

// ═══════════════════════════════════════════════════════════════════════════════
// Pre-Visit Note PDF
// ═══════════════════════════════════════════════════════════════════════════════

export async function buildPreVisitNotePdf(data: {
  generated_at: string;
  events: any[];
}): Promise<Uint8Array> {
  const doc     = await PDFDocument.create();
  const bold    = await doc.embedFont(StandardFonts.HelveticaBold);
  const regular = await doc.embedFont(StandardFonts.Helvetica);

  const events  = Array.isArray(data?.events) ? data.events : [];
  const dateStr = new Date(data?.generated_at ?? Date.now()).toLocaleDateString("en-US", {
    year: "numeric", month: "long", day: "numeric",
  });

  const pages: any[] = [];
  const newPage = () => { const p = doc.addPage([PW, PH]); pages.push(p); return p; };

  let page = newPage();
  let y = drawPageHeader(
    page,
    "Pre-Visit Note",
    `${dateStr}  ·  ${events.length} event${events.length !== 1 ? "s" : ""} selected`,
    bold, regular,
  );

  if (events.length === 0) {
    page.drawText("No events have been selected for this pre-visit note.", {
      x: M, y: y - 20, size: 11, font: regular, color: MUTED,
    });
    drawFooters(pages, regular);
    return doc.save();
  }

  // Category styles
  const CAT: Record<string, { dot: any; bg: any; label: string }> = {
    medications: { dot: BLUE,   bg: rgb(0.94, 0.96, 1.00), label: "Medications" },
    vitals:      { dot: GREEN,  bg: rgb(0.94, 1.00, 0.97), label: "Vitals"      },
    labs:        { dot: GREEN,  bg: rgb(0.94, 1.00, 0.97), label: "Labs"        },
    lifestyle:   { dot: rgb(0.745, 0.094, 0.365), bg: rgb(1.00, 0.94, 0.97), label: "Lifestyle" },
  };
  const catStyle = (cat: string) => {
    const key = Object.keys(CAT).find((k) => (cat ?? "").toLowerCase().includes(k));
    return key ? CAT[key] : { dot: ORANGE, bg: rgb(1.00, 0.97, 0.94), label: cat ?? "Other" };
  };

  for (let i = 0; i < events.length; i++) {
    const ev       = events[i];
    const cs       = catStyle(ev.category ?? "");
    const summText = ev.summary?.trim() ? clean(ev.summary.trim()) : null;
    const summLines = summText ? wrap(summText, regular, 10, CW - 36) : [];
    const blockH   = 36 + summLines.length * 14 + (summLines.length > 0 ? 4 : 0) + 14;

    if (y - blockH < 80) {
      page = newPage();
      y = drawContinuationHeader(page, "RIVR HEALTH  ·  Pre-Visit Note (continued)", regular);
    }

    // Card background
    page.drawRectangle({
      x: M - 8, y: y - blockH + 10, width: CW + 16, height: blockH,
      color: PAGE_BG, borderColor: BORDER, borderWidth: 0.5,
    });

    // Number badge (filled square for simplicity — avoids drawCircle ambiguity)
    const BSIZ = 18;
    page.drawRectangle({ x: M, y: y - BSIZ + 4, width: BSIZ, height: BSIZ, color: TEAL });
    const numStr = String(i + 1);
    const numW   = bold.widthOfTextAtSize(numStr, 9);
    page.drawText(numStr, { x: M + (BSIZ - numW) / 2, y: y - BSIZ + 7, size: 9, font: bold, color: WHITE });

    // Title and date
    const titleLines = wrap(clean(ev.title ?? "Untitled"), bold, 11, CW - 100);
    const dateLabel  = evDate(ev.occurred_at ?? "", ev.date_precision ?? "day");
    const dlW        = regular.widthOfTextAtSize(dateLabel, 9);
    page.drawText(titleLines[0] ?? "", { x: M + 26, y: y - 4, size: 11, font: bold, color: DARK });
    page.drawText(dateLabel, { x: PW - M - dlW, y: y - 4, size: 9, font: regular, color: MUTED });
    y -= 20;

    // Category pill
    const catLabel = cs.label.charAt(0).toUpperCase() + cs.label.slice(1);
    const catW     = bold.widthOfTextAtSize(catLabel, 8) + 12;
    page.drawRectangle({ x: M + 26, y: y - 4, width: catW, height: 14, color: cs.bg });
    page.drawText(catLabel, { x: M + 32, y: y - 1, size: 8, font: bold, color: cs.dot });
    y -= 18;

    // Summary
    for (const sl of summLines) {
      page.drawText(sl, { x: M + 26, y, size: 10, font: regular, color: TEXT_SUB });
      y -= 14;
    }

    y -= 16; // inter-event gap
  }

  // Disclaimer
  y -= 8;
  page.drawLine({ start: { x: M, y }, end: { x: PW - M, y }, thickness: 0.5, color: BORDER });
  y -= 12;
  drawParagraph(
    page,
    "This pre-visit note is generated by RIVR Health AI for informational purposes only. " +
    "Review all information with your healthcare provider before your appointment.",
    M, y, 7.5, regular, SUBTLE, CW, 11,
  );

  drawFooters(pages, regular);
  return doc.save();
}

// ═══════════════════════════════════════════════════════════════════════════════
// Full Health Timeline PDF
// ═══════════════════════════════════════════════════════════════════════════════

export async function buildFullTimelinePdf(data: {
  generated_at: string;
  events: any[];
}): Promise<Uint8Array> {
  const doc     = await PDFDocument.create();
  const bold    = await doc.embedFont(StandardFonts.HelveticaBold);
  const regular = await doc.embedFont(StandardFonts.Helvetica);

  const events  = Array.isArray(data?.events) ? data.events : [];
  const dateStr = new Date(data?.generated_at ?? Date.now()).toLocaleDateString("en-US", {
    year: "numeric", month: "long", day: "numeric",
  });

  const pages: any[] = [];
  const newPage = () => { const p = doc.addPage([PW, PH]); pages.push(p); return p; };

  let page = newPage();
  let y = drawPageHeader(
    page,
    "Full Health Timeline",
    `${dateStr}  ·  ${events.length} event${events.length !== 1 ? "s" : ""}`,
    bold, regular,
  );

  if (events.length === 0) {
    page.drawText("No timeline events found.", {
      x: M, y: y - 20, size: 11, font: regular, color: MUTED,
    });
    drawFooters(pages, regular);
    return doc.save();
  }

  let lastGroupKey = "";

  for (const ev of events) {
    const precision  = ev.date_precision ?? "day";
    const groupKey   = yearMonthKey(ev.occurred_at ?? "", precision);
    const groupLabel = yearMonthLabel(ev.occurred_at ?? "", precision);

    const summText  = ev.summary?.trim() ? clean(ev.summary.trim()) : null;
    const summLines = summText ? wrap(summText, regular, 10, CW - 8) : [];
    const blockH    = 18 + 16 + summLines.length * 14 + (summLines.length > 0 ? 4 : 0) + 14;

    const needGroupHeader = groupKey !== lastGroupKey;
    const groupHeaderH    = needGroupHeader ? 30 : 0;

    if (y - groupHeaderH - blockH < 80) {
      page = newPage();
      y = drawContinuationHeader(page, "RIVR HEALTH  ·  Full Health Timeline (continued)", regular);
    }

    // Month/year group divider
    if (needGroupHeader) {
      y -= 8;
      const lw = bold.widthOfTextAtSize(groupLabel, 9);
      page.drawLine({ start: { x: M, y: y - 4 }, end: { x: M + 20, y: y - 4 }, thickness: 1, color: TEAL });
      page.drawText(groupLabel, { x: M + 26, y: y - 8, size: 9, font: bold, color: TEAL, characterSpacing: 0.5 });
      page.drawLine({
        start: { x: M + 26 + lw + 8, y: y - 4 },
        end:   { x: PW - M, y: y - 4 },
        thickness: 0.5, color: BORDER,
      });
      y -= 22;
      lastGroupKey = groupKey;
    }

    // Event card background
    page.drawRectangle({
      x: M - 8, y: y - blockH + 10, width: CW + 16, height: blockH,
      color: PAGE_BG, borderColor: BORDER, borderWidth: 0.5,
    });

    const cs        = getCatStyle(ev.category ?? "");
    const dateLabel = evDate(ev.occurred_at ?? "", precision);

    // Title + date right-aligned
    const titleText = wrap(clean(ev.title ?? "Untitled"), bold, 11, CW - 90)[0] ?? "";
    const dlW       = regular.widthOfTextAtSize(dateLabel, 9);
    page.drawText(titleText, { x: M, y: y - 4, size: 11, font: bold, color: DARK });
    page.drawText(dateLabel, { x: PW - M - dlW, y: y - 4, size: 9, font: regular, color: MUTED });
    y -= 18;

    // Category pill
    const catW = bold.widthOfTextAtSize(cs.label, 8) + 12;
    page.drawRectangle({ x: M, y: y - 4, width: catW, height: 14, color: cs.bg });
    page.drawText(cs.label, { x: M + 6, y: y - 1, size: 8, font: bold, color: cs.dot });
    y -= 16;

    // Summary lines
    for (const sl of summLines) {
      page.drawText(sl, { x: M, y, size: 10, font: regular, color: TEXT_SUB });
      y -= 14;
    }

    y -= 14; // inter-event gap
  }

  // Disclaimer
  if (y > 80) {
    y -= 8;
    page.drawLine({ start: { x: M, y }, end: { x: PW - M, y }, thickness: 0.5, color: BORDER });
    y -= 12;
    drawParagraph(
      page,
      "This timeline is generated by RIVR Health AI for informational purposes only. " +
      "Review all information with your healthcare provider.",
      M, y, 7.5, regular, SUBTLE, CW, 11,
    );
  }

  drawFooters(pages, regular);
  return doc.save();
}
