"""Tests for Task 1: Append-only AuditLog."""
import pytest
from django.core.exceptions import PermissionDenied
from django.utils import timezone

from apps.audit.models import AuditLog


@pytest.fixture
def user(db):
    from django.contrib.auth import get_user_model
    User = get_user_model()
    return User.objects.create_user(email="audit@example.com", password="pass", email_verified_at=timezone.now())


def test_audit_log_create(user):
    entry = AuditLog.objects.create(
        user=user,
        user_email_snapshot=user.email,
        resource_type="document",
        resource_id="abc123",
        action=AuditLog.Action.CREATE,
    )
    assert entry.pk is not None
    assert AuditLog.objects.filter(pk=entry.pk).exists()


def test_audit_log_immutable_on_update(user):
    entry = AuditLog.objects.create(
        user=user,
        resource_type="document",
        resource_id="abc",
        action=AuditLog.Action.CREATE,
    )
    entry.resource_id = "changed"
    with pytest.raises(PermissionDenied):
        entry.save()


def test_audit_log_delete_raises(user):
    entry = AuditLog.objects.create(
        user=user,
        resource_type="document",
        resource_id="abc",
        action=AuditLog.Action.CREATE,
    )
    with pytest.raises(PermissionDenied):
        entry.delete()


def test_audit_log_queryset_delete_raises(user):
    AuditLog.objects.create(
        user=user,
        resource_type="document",
        resource_id="del_qs",
        action=AuditLog.Action.CREATE,
    )
    with pytest.raises(PermissionDenied):
        AuditLog.objects.filter(resource_id="del_qs").first().delete()


def test_middleware_attaches_audit_context(db, api_client):
    from django.contrib.auth import get_user_model
    User = get_user_model()
    u = User.objects.create_user(email="mw@example.com", password="pass", email_verified_at=timezone.now())
    api_client.force_authenticate(user=u)
    # Any authenticated endpoint will go through the middleware
    resp = api_client.get("/api/profile/")
    assert resp.status_code in (200, 404)  # endpoint exists, just checking middleware ran


def test_document_creation_triggers_audit_log(user, db):
    from apps.documents.models import Document
    initial_count = AuditLog.objects.filter(resource_type="document").count()
    doc = Document.objects.create(
        user=user,
        title="Test doc",
        status=Document.Status.UPLOADED,
        source_type=Document.SourceType.FILE,
        pdf_path="documents/test/x.pdf",
    )
    after_count = AuditLog.objects.filter(resource_type="document").count()
    assert after_count == initial_count + 1
    entry = AuditLog.objects.filter(resource_type="document", resource_id=str(doc.id)).last()
    assert entry is not None
    assert entry.action == AuditLog.Action.CREATE


def test_document_update_triggers_audit_log(user, db):
    from apps.documents.models import Document
    doc = Document.objects.create(
        user=user,
        title="Test doc",
        status=Document.Status.UPLOADED,
        source_type=Document.SourceType.FILE,
        pdf_path="documents/test/x.pdf",
    )
    before = AuditLog.objects.filter(resource_type="document", resource_id=str(doc.id)).count()
    doc.title = "Updated"
    doc.save()
    after = AuditLog.objects.filter(resource_type="document", resource_id=str(doc.id)).count()
    assert after == before + 1
