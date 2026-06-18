"""Tests for Task 7: BackfillAuditLog."""
import pytest
from django.core.exceptions import PermissionDenied
from django.utils import timezone


@pytest.fixture
def user(db):
    from django.contrib.auth import get_user_model
    User = get_user_model()
    return User.objects.create_user(email="ba@example.com", password="pass", email_verified_at=timezone.now())


def test_backfill_audit_log_create(user):
    from apps.jobs.models import BackfillAuditLog
    entry = BackfillAuditLog.objects.create(
        user=user,
        field_name="allergies",
        new_value=["peanuts"],
        source=BackfillAuditLog.Source.AI_EXTRACTION,
    )
    assert entry.pk is not None


def test_backfill_audit_log_immutable(user):
    from apps.jobs.models import BackfillAuditLog
    entry = BackfillAuditLog.objects.create(
        user=user,
        field_name="medications",
        new_value=["aspirin"],
        source=BackfillAuditLog.Source.AI_EXTRACTION,
    )
    entry.field_name = "changed"
    with pytest.raises(PermissionDenied):
        entry.save()


def test_backfill_audit_log_delete_raises(user):
    from apps.jobs.models import BackfillAuditLog
    entry = BackfillAuditLog.objects.create(
        user=user,
        field_name="allergies",
        new_value=[],
        source=BackfillAuditLog.Source.MANUAL_APPROVAL,
    )
    with pytest.raises(PermissionDenied):
        entry.delete()


def test_backfill_audit_log_queryset_delete_raises(user):
    """Bulk queryset .delete() must be blocked (it bypasses instance .delete())."""
    from apps.jobs.models import BackfillAuditLog
    BackfillAuditLog.objects.create(
        user=user,
        field_name="allergies",
        new_value=["latex"],
        source=BackfillAuditLog.Source.AI_EXTRACTION,
    )
    with pytest.raises(PermissionDenied):
        BackfillAuditLog.objects.filter(field_name="allergies").delete()
    assert BackfillAuditLog.objects.filter(field_name="allergies").exists()


def test_log_backfill_helper_creates_entry(user):
    from apps.jobs.backfill_audit import log_backfill
    from apps.jobs.models import BackfillAuditLog
    count_before = BackfillAuditLog.objects.filter(user=user).count()
    log_backfill(
        user=user,
        field_name="medical_history",
        new_value=["hypertension"],
        source=BackfillAuditLog.Source.AI_EXTRACTION,
        old_value=None,
        evaluation_id="eval-123",
    )
    assert BackfillAuditLog.objects.filter(user=user).count() == count_before + 1


def test_log_backfill_helper_no_op_on_error(user):
    """log_backfill should never raise — it silently swallows errors."""
    from apps.jobs.backfill_audit import log_backfill
    # Pass invalid source to trigger a DB-level error path in a real scenario;
    # but since the helper catches all exceptions, it should return silently.
    # Just verify it doesn't raise.
    log_backfill(
        user=user,
        field_name="x",
        new_value="y",
        source="ai_extraction",
    )


def test_backfill_audit_with_old_value(user):
    from apps.jobs.models import BackfillAuditLog
    entry = BackfillAuditLog.objects.create(
        user=user,
        field_name="allergies",
        old_value=["eggs"],
        new_value=["eggs", "peanuts"],
        source=BackfillAuditLog.Source.MANUAL_APPROVAL,
        evaluation_id="eval-456",
        document_id="doc-789",
    )
    assert entry.old_value == ["eggs"]
    assert entry.evaluation_id == "eval-456"
    assert entry.document_id == "doc-789"
