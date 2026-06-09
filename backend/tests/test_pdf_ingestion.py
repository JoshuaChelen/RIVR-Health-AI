"""Unit tests for the PyMuPDF text+image extractor and batched OCR."""
import fitz  # PyMuPDF

from apps.jobs import ai_client, extraction


def _png(w: int, h: int) -> bytes:
    """A solid-gray PNG of exact pixel size w x h."""
    pix = fitz.Pixmap(fitz.csRGB, fitz.IRect(0, 0, w, h))
    pix.clear_with(128)
    return pix.tobytes("png")


def _make_pdf(text: str = "", image_sizes: tuple = ()) -> bytes:
    """One-page PDF with optional text and embedded images of given pixel sizes."""
    doc = fitz.open()
    page = doc.new_page()
    if text:
        page.insert_text((72, 72), text)
    for i, (w, h) in enumerate(image_sizes):
        top = 120 + i * 80
        page.insert_image(fitz.Rect(72, top, 132, top + 60), stream=_png(w, h))
    return doc.tobytes()


def test_extract_pdf_text_layer():
    content = extraction.extract_pdf(_make_pdf(text="Hello clinical world"))
    assert len(content.pages) == 1
    assert "Hello clinical world" in content.pages[0].text
    assert content.pages[0].images == []


def test_extract_pdf_large_image_captured():
    content = extraction.extract_pdf(_make_pdf(text="report", image_sizes=((200, 200),)))
    assert len(content.pages[0].images) == 1


def test_extract_pdf_tiny_image_filtered():
    content = extraction.extract_pdf(_make_pdf(text="report", image_sizes=((20, 20),)))
    assert content.pages[0].images == []


def test_extract_pdf_asymmetric_image_captured():
    # 50 wide, 200 tall -> kept (filter skips only when BOTH dims are below the threshold)
    content = extraction.extract_pdf(_make_pdf(text="", image_sizes=((50, 200),)))
    assert len(content.pages[0].images) == 1


def test_extract_pdf_image_only_page_captured():
    content = extraction.extract_pdf(_make_pdf(text="", image_sizes=((400, 400),)))
    assert content.pages[0].text == ""
    assert len(content.pages[0].images) == 1


def test_extract_pdf_blank_page_uses_render_fallback():
    # No text, no embedded image -> page is rendered so OCR still gets a shot.
    content = extraction.extract_pdf(_make_pdf(text="", image_sizes=()))
    assert content.pages[0].text == ""
    assert len(content.pages[0].images) == 1


def test_extract_pdf_bad_bytes_returns_empty():
    content = extraction.extract_pdf(b"not a pdf")
    assert content.pages == []


class _FakeResp:
    def __init__(self, text):
        self.output_text = text


class _FakeResponses:
    def __init__(self, calls):
        self.calls = calls

    def create(self, **kwargs):
        self.calls.append(kwargs)
        return _FakeResp(f"text{len(self.calls)}")


class _FakeClient:
    def __init__(self, calls):
        self.responses = _FakeResponses(calls)


def test_ocr_images_empty_returns_empty():
    assert ai_client.ocr_images([]) == ""


def test_ocr_images_batches_and_concatenates(monkeypatch):
    calls = []
    monkeypatch.setattr(ai_client, "_client", lambda: _FakeClient(calls))
    out = ai_client.ocr_images([b"img"] * 25, batch_size=10)
    assert len(calls) == 3  # 10 + 10 + 5
    assert out == "text1\ntext2\ntext3"


def test_ocr_images_uses_default_batch_size(monkeypatch):
    calls = []
    monkeypatch.setattr(ai_client, "_client", lambda: _FakeClient(calls))
    monkeypatch.setattr(ai_client, "OCR_BATCH_SIZE", 3)
    ai_client.ocr_images([b"img"] * 7)  # ceil(7/3) = 3 calls
    assert len(calls) == 3
