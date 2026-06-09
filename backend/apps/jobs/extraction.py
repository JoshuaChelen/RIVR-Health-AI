"""PDF and health data extraction utilities.

Provides pure helper functions for:
- Apple Health timeline aggregation
- PDF text + image extraction (PyMuPDF)
"""

from dataclasses import dataclass, field
from typing import Any, Optional

from django.conf import settings

# Minimum pixel dimension for an embedded image to be worth OCR-ing.
# Images smaller than this on BOTH axes (logos, icons, signature glyphs) are skipped.
MIN_IMAGE_PX = getattr(settings, "OCR_MIN_IMAGE_PX", 100)


def apple_health_snapshot(
    events: list[dict[str, Any]],
) -> dict[str, Optional[float]]:
    """Aggregate Apple Health timeline events into 7-day averages.

    Processes events from the last 14 days (filtered upstream) and aggregates:
    - steps_avg_7d: Average daily steps (matching 'steps' in event_type)
    - sleep_avg_min_7d: Average sleep in minutes (matching 'sleep' in event_type)
    - resting_hr_recent: Most recent resting heart rate value (matching 'heart', 'hr', or 'resting')

    Args:
        events: List of dicts with keys:
            - event_type (str): Type of health event (case-insensitive)
            - occurred_at (str or Date): When the event occurred
            - data (dict): Event data with value fields

    Returns:
        Dict with keys:
            - steps_avg_7d: float or None
            - sleep_avg_min_7d: float or None
            - resting_hr_recent: float or None

    Extraction rules:
    - Steps: data.steps, data.value, or NaN
    - Sleep: data.minutes, data.sleep_minutes, data.value, or NaN (in minutes)
    - Heart rate: data.bpm, data.value, or NaN; takes most recent non-NaN value
    """
    step_values: list[float] = []
    sleep_values: list[float] = []
    hr_values: list[float] = []

    for event in events:
        event_type = str(event.get("event_type", "")).lower()
        data = event.get("data", {}) or {}

        # Extract steps
        if "steps" in event_type:
            value = _get_number(data.get("steps"), data.get("value"))
            if value is not None:
                step_values.append(value)

        # Extract sleep (in minutes)
        if "sleep" in event_type:
            value = _get_number(
                data.get("minutes"),
                data.get("sleep_minutes"),
                data.get("value"),
            )
            if value is not None:
                sleep_values.append(value)

        # Extract heart rate / resting heart rate
        if any(x in event_type for x in ["heart", "hr", "resting"]):
            value = _get_number(data.get("bpm"), data.get("value"))
            if value is not None:
                hr_values.append(value)

    return {
        "steps_avg_7d": _average(step_values),
        "sleep_avg_min_7d": _average(sleep_values),
        "resting_hr_recent": hr_values[-1] if hr_values else None,
    }


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


# --- Private helpers ----------------------------------------------------------


def _get_number(*values: Any) -> Optional[float]:
    """Extract first non-None, finite numeric value.

    Args:
        *values: Variable args to check in order

    Returns:
        First finite float value, or None if all are non-finite or missing
    """
    for v in values:
        if v is not None:
            try:
                num = float(v)
                if num == num and num != float("inf") and num != float("-inf"):
                    return num
            except (ValueError, TypeError):
                pass
    return None


def _average(values: list[float]) -> Optional[float]:
    """Compute arithmetic mean of list.

    Args:
        values: List of numeric values

    Returns:
        Mean value, or None if list is empty
    """
    if not values:
        return None
    return sum(values) / len(values)
