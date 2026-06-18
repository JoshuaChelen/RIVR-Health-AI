"""PDF and health data extraction utilities.

Provides pure helper functions for:
- Apple Health timeline aggregation
- PDF text + image extraction (PyMuPDF)
"""

import re
from dataclasses import dataclass, field
from typing import Optional

from django.conf import settings

# Minimum pixel dimension for an embedded image to be worth OCR-ing.
# Images smaller than this on BOTH axes (logos, icons, signature glyphs) are skipped.
MIN_IMAGE_PX = getattr(settings, "OCR_MIN_IMAGE_PX", 100)


def _as_int(v):
    return int(round(v)) if isinstance(v, (int, float)) else None


_UNIT_CANON = [
    (re.compile(r"\bmilligram(s)?\b", re.I), "mg"),
    (re.compile(r"\bmicrogram(s)?\b|\bμg\b|\bug\b", re.I), "mcg"),
    (re.compile(r"\bkilogram(s)?\b|\bkgs\b", re.I), "kg"),
    (re.compile(r"\bmillilit(er|re)(s)?\b", re.I), "mL"),
    (re.compile(r"\bpound(s)?\b|\blbs\b", re.I), "lb"),
    (re.compile(r"\bgram(s)?\b", re.I), "g"),
]


def normalize_units(value):
    """Canonicalize unit SPELLINGS (e.g. 'milligrams'->'mg'). Does NOT convert numeric values
    (mg<->mcg conversion is unsafe for clinical data — only spelling is normalized)."""
    if not value or not isinstance(value, str):
        return value
    out = value
    for pat, repl in _UNIT_CANON:
        out = pat.sub(repl, out)
    return out


def assess_text_quality(text):
    """Heuristic flag for garbage OCR/extraction. Returns {score: 0-1, is_low: bool}.
    Low score => mostly non-word characters or vowel-less tokens (likely OCR noise)."""
    t = (text or "").strip()
    if len(t) > 180000:
        t = t[:180000]
    if len(t) < 20:
        return {"score": 0.0, "is_low": True}
    printable = len(re.findall(r"[A-Za-z0-9\s.,;:%/()\-+]", t))
    ratio = printable / len(t)
    tokens = t.split()
    wordish = sum(1 for w in tokens if re.search(r"[aeiou]", w, re.I)) / max(len(tokens), 1)
    score = round(min(ratio, wordish), 2)
    return {"score": score, "is_low": score < 0.5}


def apple_health_snapshot(events):
    """Most-recent value per Apple Health metric.

    `events` are apple_health timeline events ordered newest-first. The mobile app
    pushes one pre-aggregated event per metric per day (clearing + reinserting), so
    the first event seen per metric is the current value (averaging them is wrong).
    """
    out = {
        "steps_per_day_7d_avg": None,
        "sleep_min_per_night_7d_avg": None,
        "distance_mi_per_day_7d_avg": None,
        "active_energy_kcal_per_day_7d_avg": None,
        "heart_rate_bpm_latest": None,
        "hrv_ms_latest": None,
        "hrv_algorithm": None,
        "weight_lb_latest": None,
        "blood_pressure_latest": None,
    }

    def num(data, *keys):
        for k in keys:
            v = data.get(k)
            if v is not None:
                try:
                    return float(v)
                except (TypeError, ValueError):
                    pass
        return None

    for ev in events:
        et = str(ev.get("event_type", "")).lower()
        data = ev.get("data") or {}
        if "steps" in et:
            if out["steps_per_day_7d_avg"] is None:
                out["steps_per_day_7d_avg"] = _as_int(num(data, "steps", "value"))
        elif "sleep" in et:
            if out["sleep_min_per_night_7d_avg"] is None:
                out["sleep_min_per_night_7d_avg"] = _as_int(num(data, "minutes", "sleep_minutes", "value"))
        elif "distance" in et:
            if out["distance_mi_per_day_7d_avg"] is None:
                v = num(data, "miles", "value")
                out["distance_mi_per_day_7d_avg"] = round(v, 2) if v is not None else None
        elif "energy" in et:
            if out["active_energy_kcal_per_day_7d_avg"] is None:
                out["active_energy_kcal_per_day_7d_avg"] = _as_int(num(data, "kcal", "value"))
        elif "hrv" in et or "variability" in et:
            if out["hrv_ms_latest"] is None:
                v = num(data, "hrv_ms", "ms", "value")
                if v is not None:
                    out["hrv_ms_latest"] = round(v, 1)
                    # iOS HealthKit reports SDNN; Android Health Connect reports
                    # RMSSD. These are different HRV algorithms and not
                    # numerically comparable, so tag which one this value is
                    # (from the row's provenance) so the eval model reads it
                    # correctly. Only tag when a value was actually captured, so
                    # the label never appears without a corresponding value.
                    origin = str(data.get("origin", "")).lower()
                    out["hrv_algorithm"] = (
                        "RMSSD" if origin == "health_connect"
                        else "SDNN" if origin == "healthkit"
                        else None
                    )
        elif "weight" in et:
            if out["weight_lb_latest"] is None:
                v = num(data, "weight_lb", "pounds", "lb", "value")
                out["weight_lb_latest"] = round(v, 1) if v is not None else None
        elif "pressure" in et:
            if out["blood_pressure_latest"] is None:
                s_v, d_v = num(data, "systolic"), num(data, "diastolic")
                if s_v is not None and d_v is not None:
                    out["blood_pressure_latest"] = {"systolic": _as_int(s_v), "diastolic": _as_int(d_v)}
        elif "heart" in et or "resting" in et:
            if out["heart_rate_bpm_latest"] is None:
                out["heart_rate_bpm_latest"] = _as_int(num(data, "bpm", "value"))
    return out


@dataclass
class PageContent:
    text: str
    images: list[bytes] = field(default_factory=list)


@dataclass
class PdfContent:
    pages: list[PageContent] = field(default_factory=list)


def _render_page_to_png(page) -> Optional[bytes]:
    """Render a single page to PNG (fallback for pages with no text and no raster image)."""
    try:
        import fitz

        rect = page.rect
        longest = max(rect.width, rect.height)
        scale = min(2.0, 1300 / longest) if longest > 0 else 1.0
        pix = page.get_pixmap(matrix=fitz.Matrix(scale, scale), alpha=False)
        return pix.tobytes("png")
    except Exception:
        return None


def extract_pdf(data: bytes, *, min_image_px: int = MIN_IMAGE_PX) -> PdfContent:
    """Extract the text layer and every qualifying embedded image, per page.

    Each page yields its text plus PNG bytes for every embedded raster image whose
    width or height is >= min_image_px. A page with neither text nor a qualifying
    image is rendered whole so OCR can still read it. Returns empty on open failure.
    """
    import fitz

    try:
        doc = fitz.open(stream=data, filetype="pdf")
    except Exception:
        return PdfContent(pages=[])

    pages: list[PageContent] = []
    try:
        for page in doc:
            text = (page.get_text() or "").strip()
            images: list[bytes] = []
            for img in page.get_images(full=True):
                xref, w, h = img[0], img[2], img[3]
                if w < min_image_px and h < min_image_px:
                    continue
                try:
                    pix = fitz.Pixmap(doc, xref)
                    if pix.n - pix.alpha >= 4:  # CMYK -> RGB
                        pix = fitz.Pixmap(fitz.csRGB, pix)
                    images.append(pix.tobytes("png"))
                except Exception:
                    continue
            if not text and not images:
                png = _render_page_to_png(page)
                if png:
                    images.append(png)
            pages.append(PageContent(text=text, images=images))
    finally:
        doc.close()

    return PdfContent(pages=pages)


