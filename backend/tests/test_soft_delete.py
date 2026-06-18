"""Tests for Task 2: Soft-delete + retention."""
import pytest
from django.utils import timezone


@pytest.fixture
def user(db):
    from django.contrib.auth import get_user_model
    User = get_user_model()
    return User.objects.create_user(email="soft@example.com", password="pass", email_verified_at=timezone.now())


def test_soft_delete_sets_deleted_at(user):
    from apps.documents.models import Document
    doc = Document.objects.create(
        user=user, title="doc", status=Document.Status.UPLOADED,
        source_type=Document.SourceType.FILE, pdf_path="x",
    )
    assert doc.deleted_at is None
    doc.soft_delete("test_reason")
    assert doc.deleted_at is not None
    assert doc.deletion_reason == "test_reason"


def test_default_manager_excludes_deleted(user):
    from apps.documents.models import Document
    doc = Document.objects.create(
        user=user, title="doc2", status=Document.Status.UPLOADED,
        source_type=Document.SourceType.FILE, pdf_path="x2",
    )
    doc_id = doc.id
    doc.soft_delete("gone")
    assert not Document.objects.filter(id=doc_id).exists()


def test_all_objects_manager_includes_deleted(user):
    from apps.documents.models import Document
    doc = Document.objects.create(
        user=user, title="doc3", status=Document.Status.UPLOADED,
        source_type=Document.SourceType.FILE, pdf_path="x3",
    )
    doc_id = doc.id
    doc.soft_delete("hidden")
    assert not Document.objects.filter(id=doc_id).exists()
    assert Document.all_objects.filter(id=doc_id).exists()


def test_override_delete_is_soft(user):
    from apps.documents.models import Document
    doc = Document.objects.create(
        user=user, title="doc4", status=Document.Status.UPLOADED,
        source_type=Document.SourceType.FILE, pdf_path="x4",
    )
    doc_id = doc.id
    doc.delete()
    # Row still exists in DB
    assert Document.all_objects.filter(id=doc_id).exists()
    refreshed = Document.all_objects.get(id=doc_id)
    assert refreshed.deleted_at is not None


def test_user_soft_delete(user):
    from django.contrib.auth import get_user_model
    User = get_user_model()
    uid = user.id
    user.soft_delete("user_request")
    assert not User.objects.filter(id=uid).exists()
    assert User.all_objects.filter(id=uid).exists()
    assert User.all_objects.get(id=uid).deleted_at is not None


def test_account_delete_endpoint_soft_deletes(db, api_client):
    from django.contrib.auth import get_user_model
    from apps.documents.models import Document

    User = get_user_model()
    u = User.objects.create_user(email="del@example.com", password="pass", email_verified_at=timezone.now())
    api_client.force_authenticate(user=u)
    uid = u.id

    # Create a document for the user
    Document.objects.create(
        user=u, title="d", status=Document.Status.UPLOADED,
        source_type=Document.SourceType.FILE, pdf_path="documents/some/path.pdf",
    )

    resp = api_client.delete("/api/account")
    assert resp.status_code == 204

    # Default managers hide the soft-deleted rows
    assert not User.objects.filter(id=uid).exists()
    assert Document.objects.filter(user_id=uid).count() == 0

    # But all_objects shows them
    assert User.all_objects.filter(id=uid).exists()
    assert Document.all_objects.filter(user_id=uid, deleted_at__isnull=False).count() > 0


def test_purge_task_hard_deletes_old_rows(db):
    from datetime import timedelta
    from unittest.mock import patch

    from django.contrib.auth import get_user_model
    from apps.documents.models import Document

    User = get_user_model()
    u = User.objects.create_user(email="purge@example.com", password="pass", email_verified_at=timezone.now())
    doc = Document.objects.create(
        user=u, title="old", status=Document.Status.UPLOADED,
        source_type=Document.SourceType.FILE, pdf_path="purge/path",
    )
    doc.soft_delete("old")
    doc_id = doc.id

    # Backdate deleted_at to 31 days ago
    old_time = timezone.now() - timedelta(days=31)
    Document.all_objects.filter(id=doc_id).update(deleted_at=old_time)

    from apps.jobs.tasks import purge_expired_soft_deletes_task
    purge_expired_soft_deletes_task()

    assert not Document.all_objects.filter(id=doc_id).exists()


def test_purge_task_does_not_touch_recent_soft_deletes(db):
    from django.contrib.auth import get_user_model
    from apps.documents.models import Document

    User = get_user_model()
    u = User.objects.create_user(email="recent@example.com", password="pass", email_verified_at=timezone.now())
    doc = Document.objects.create(
        user=u, title="recent", status=Document.Status.UPLOADED,
        source_type=Document.SourceType.FILE, pdf_path="recent/path",
    )
    doc.soft_delete("recent")
    doc_id = doc.id

    from apps.jobs.tasks import purge_expired_soft_deletes_task
    purge_expired_soft_deletes_task()

    # Not yet 30 days — row still present
    assert Document.all_objects.filter(id=doc_id).exists()


def test_audit_log_never_purged(db):
    """AuditLog should not be touched by the purge task (no deleted_at field)."""
    from datetime import timedelta

    from django.contrib.auth import get_user_model
    from apps.audit.models import AuditLog

    User = get_user_model()
    u = User.objects.create_user(email="ap@example.com", password="pass", email_verified_at=timezone.now())
    entry = AuditLog.objects.create(
        user=u, resource_type="document", resource_id="x", action=AuditLog.Action.CREATE,
    )
    eid = entry.id

    from apps.jobs.tasks import purge_expired_soft_deletes_task
    purge_expired_soft_deletes_task()

    assert AuditLog.objects.filter(id=eid).exists()
