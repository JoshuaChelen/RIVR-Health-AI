"""Task 4 tests: PDF name sanitization."""
import pytest

from apps.accounts.models import User
from apps.profiles.models import UserProfile
from apps.shares import pdf


@pytest.mark.django_db
def test_sanitize_name_removes_control_chars():
    assert pdf._sanitize_name("John\nEvil\x00Name") == "John Evil Name"


def test_sanitize_name_truncates():
    assert len(pdf._sanitize_name("A" * 200)) == 50


def test_sanitize_name_collapses_spaces():
    assert pdf._sanitize_name("John   Smith") == "John Smith"


def test_sanitize_name_empty():
    assert pdf._sanitize_name("") == ""
    assert pdf._sanitize_name(None) == ""


@pytest.mark.django_db
def test_pdf_sanitizes_profile_name_in_output(db):
    user = User.objects.create_user(email="pdftest@example.com", password="pw123")
    # Postgres TEXT fields reject NUL bytes (\x00); use a tab+newline combo instead
    UserProfile.objects.create(
        user=user,
        first_name="John\nEvil\tName",
        last_name="Smith",
    )
    lines = pdf._lines_for("full_summary", user.id)
    header_text = "\n".join(lines[:3])
    # Embedded newlines/tabs in names should be replaced
    name_line = [l for l in lines[:3] if "John" in l]
    assert name_line, "Name should appear in header"
    assert "\n" not in name_line[0]
    assert "\t" not in name_line[0]


@pytest.mark.django_db
def test_pdf_sanitizes_long_names(db):
    user = User.objects.create_user(email="pdflong@example.com", password="pw123")
    # max_length=255 on the model fields; use 200-char names
    UserProfile.objects.create(
        user=user,
        first_name="A" * 200,
        last_name="B" * 50,
    )
    lines = pdf._lines_for("full_summary", user.id)
    # Name should be truncated to 50 chars each
    name_line = [l for l in lines[:3] if "A" in l]
    if name_line:
        assert len(name_line[0]) <= 110, f"Name line not truncated: {len(name_line[0])}"


@pytest.mark.django_db
def test_build_pdf_with_dangerous_names(db):
    user = User.objects.create_user(email="pdfdanger@example.com", password="pw123")
    UserProfile.objects.create(
        user=user,
        first_name='<script>alert("xss")</script>',
        last_name="../../../etc/passwd",
    )
    pdf_bytes = pdf.build_pdf("full_summary", user.id)
    assert isinstance(pdf_bytes, bytes)
    assert len(pdf_bytes) > 0
    assert pdf_bytes.startswith(b"%PDF")
