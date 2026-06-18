"""Tests asserting sensitive fields are excluded from API serializers."""
import pytest
from apps.jobs.serializers import AiJobSerializer
from apps.documents.serializers import DocumentSerializer


def test_aijob_serializer_excludes_error():
    assert "error" in AiJobSerializer.Meta.exclude


def test_aijob_serializer_excludes_progress():
    assert "progress" in AiJobSerializer.Meta.exclude


def test_aijob_serializer_excludes_result():
    assert "result" in AiJobSerializer.Meta.exclude


def test_document_serializer_excludes_processing_error():
    assert "processing_error" in DocumentSerializer.Meta.exclude


def test_document_serializer_excludes_sha256():
    assert "sha256" in DocumentSerializer.Meta.exclude


def test_document_serializer_excludes_content_json():
    assert "content_json" in DocumentSerializer.Meta.exclude


def test_aijob_serializer_error_not_in_fields():
    s = AiJobSerializer()
    assert "error" not in s.fields


def test_document_serializer_processing_error_not_in_fields():
    s = DocumentSerializer()
    assert "processing_error" not in s.fields
