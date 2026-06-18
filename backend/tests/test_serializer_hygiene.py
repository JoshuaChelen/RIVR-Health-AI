"""Tests asserting sensitive fields are excluded from API serializers,
while client-consumed fields are retained."""
from apps.jobs.serializers import AiJobSerializer
from apps.documents.serializers import DocumentSerializer


# ── Removed (confirmed no client usage) ───────────────────────────────────────

def test_aijob_serializer_excludes_error():
    assert "error" in AiJobSerializer.Meta.exclude


def test_aijob_serializer_excludes_result():
    assert "result" in AiJobSerializer.Meta.exclude


def test_document_serializer_excludes_sha256():
    assert "sha256" in DocumentSerializer.Meta.exclude


def test_aijob_serializer_error_not_in_fields():
    s = AiJobSerializer()
    assert "error" not in s.fields


# ── Retained (client reads/writes these) ──────────────────────────────────────

def test_aijob_serializer_keeps_progress():
    # client reads progress.currentDocId for the per-doc progress bar
    assert "progress" not in AiJobSerializer.Meta.exclude
    assert "progress" in AiJobSerializer().fields


def test_document_serializer_keeps_processing_error():
    # client reads failed-doc UI; writes "" to reset on re-upload (sanitized in save())
    assert "processing_error" not in DocumentSerializer.Meta.exclude
    assert "processing_error" in DocumentSerializer().fields


def test_document_serializer_keeps_content_json():
    # client writes content_json on every manual-profile upsert
    assert "content_json" not in DocumentSerializer.Meta.exclude
    assert "content_json" in DocumentSerializer().fields
