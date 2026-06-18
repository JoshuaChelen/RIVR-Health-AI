"""Task 7 tests: scheduled cleanup of expired share artifacts."""
from datetime import timedelta
from unittest.mock import patch

import pytest
from django.utils import timezone

from apps.accounts.models import User
from apps.shares.cleanup import cleanup_expired_shares
from apps.shares.models import SharePackage


@pytest.fixture
def user(db):
    return User.objects.create_user(email="cleanup@example.com", password="pw123")


@pytest.mark.django_db
def test_cleanup_deletes_expired_share_artifacts(user):
    expired_pkg = SharePackage.objects.create(
        owner=user,
        token_hash="expired_hash",
        file_type="health_profile",
        expires_at=timezone.now() - timedelta(hours=2),
        payload_json={"pdfs": {"full_summary": "path/to/pdf.pdf"}},
        artifacts_deleted_at=None,
    )
    active_pkg = SharePackage.objects.create(
        owner=user,
        token_hash="active_hash",
        file_type="health_profile",
        expires_at=timezone.now() + timedelta(hours=1),
        payload_json={"pdfs": {"full_summary": "path/to/active.pdf"}},
        artifacts_deleted_at=None,
    )
    with patch("apps.shares.cleanup.storage.delete") as mock_delete:
        count = cleanup_expired_shares(grace_period_hours=0)
    assert count >= 1
    mock_delete.assert_called_with("path/to/pdf.pdf")
    expired_pkg.refresh_from_db()
    assert expired_pkg.artifacts_deleted_at is not None
    active_pkg.refresh_from_db()
    assert active_pkg.artifacts_deleted_at is None


@pytest.mark.django_db
def test_cleanup_respects_grace_period(user):
    pkg = SharePackage.objects.create(
        owner=user,
        token_hash="grace_hash",
        file_type="health_profile",
        expires_at=timezone.now() - timedelta(minutes=30),
        payload_json={"pdfs": {"full_summary": "path.pdf"}},
        artifacts_deleted_at=None,
    )
    with patch("apps.shares.cleanup.storage.delete"):
        count = cleanup_expired_shares(grace_period_hours=1)
    assert count == 0
    pkg.refresh_from_db()
    assert pkg.artifacts_deleted_at is None


@pytest.mark.django_db
def test_cleanup_handles_missing_files_gracefully(user):
    pkg = SharePackage.objects.create(
        owner=user,
        token_hash="missing_hash",
        file_type="health_profile",
        expires_at=timezone.now() - timedelta(hours=2),
        payload_json={"pdfs": {"a": "missing/a.pdf", "b": "missing/b.pdf"}},
        artifacts_deleted_at=None,
    )
    with patch("apps.shares.cleanup.storage.delete"):
        count = cleanup_expired_shares(grace_period_hours=0)
    assert count == 1
    pkg.refresh_from_db()
    assert pkg.artifacts_deleted_at is not None


@pytest.mark.django_db
def test_cleanup_skips_already_cleaned(user):
    already_cleaned = SharePackage.objects.create(
        owner=user,
        token_hash="cleaned_hash",
        file_type="health_profile",
        expires_at=timezone.now() - timedelta(hours=2),
        payload_json={"pdfs": {"full_summary": "path.pdf"}},
        artifacts_deleted_at=timezone.now() - timedelta(hours=1),
    )
    with patch("apps.shares.cleanup.storage.delete") as mock_delete:
        count = cleanup_expired_shares(grace_period_hours=0)
    assert count == 0
    mock_delete.assert_not_called()
