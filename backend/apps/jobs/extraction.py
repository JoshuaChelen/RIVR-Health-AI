"""PDF and health data extraction utilities.

Provides pure helper functions for:
- Apple Health timeline aggregation
- PDF text extraction
- OCR requirement detection
- PDF page rendering to PNG
"""

from typing import Any, Optional

from django.conf import settings

# OCR configuration defaults
OCR_MIN_CHARS = getattr(settings, "OCR_MIN_CHARS", 200)
OCR_MAX_PAGES = getattr(settings, "OCR_MAX_PAGES", 10)


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


def extract_pdf_text(data: bytes) -> str:
    """Extract text from PDF bytes using pypdf.

    Mirrors pdf-parse library behavior (JavaScript version).

    Args:
        data: Raw PDF file bytes

    Returns:
        Extracted text, trimmed. Empty string on error.
    """
    try:
        import io

        from pypdf import PdfReader

        reader = PdfReader(io.BytesIO(data))
        text_parts = []
        for page in reader.pages:
            page_text = page.extract_text()
            if page_text:
                text_parts.append(page_text)
        text = "".join(text_parts).strip()
        return text
    except Exception:
        return ""


def render_pdf_pages_to_png(
    data: bytes, max_pages: int = 3
) -> list[bytes]:
    """Render PDF pages to PNG images using PyMuPDF (fitz).

    Mirrors pdfjs page rendering behavior with scaling constraints.
    Each page is rendered at scale up to 2x, capped to keep max dimension <= 1300px.

    Args:
        data: Raw PDF file bytes
        max_pages: Maximum number of pages to render (default 3)

    Returns:
        List of PNG image bytes, one per rendered page.
        Empty list on error.

    Notes:
        - Uses fitz.Document for PDF processing
        - Canvas size is ceil'd to integer pixels
        - Output format is PNG with 96 DPI base
    """
    try:
        import fitz  # PyMuPDF

        doc = fitz.open(stream=data, filetype="pdf")
        num_pages = min(doc.page_count, max_pages)

        pngs: list[bytes] = []
        for page_num in range(num_pages):
            page = doc[page_num]

            # Start with scale=1, then cap max dimension to 1300px
            base_rect = page.get_displaylist().rect
            max_dim = 1300
            max_base_dim = max(base_rect.width, base_rect.height)
            scale = min(2.0, max_dim / max_base_dim) if max_base_dim > 0 else 1.0

            # Render at computed scale
            mat = fitz.Matrix(scale, scale)
            pix = page.get_pixmap(matrix=mat, alpha=False)

            # PNG bytes
            png_bytes = pix.tobytes(output="png")
            pngs.append(png_bytes)

        doc.close()
        return pngs
    except Exception:
        return []


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
