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


def test_purge_user_with_audit_and_backfill_rows_does_not_raise(db):
    """A user with backfill + audit rows must hard-purge WITHOUT ProtectedError,
    and the immutable audit rows must persist with the user reference nulled."""
    from datetime import timedelta

    from django.contrib.auth import get_user_model
    from apps.audit.models import AuditLog
    from apps.jobs.models import BackfillAuditLog

    User = get_user_model()
    u = User.objects.create_user(email="protected@example.com", password="pass", email_verified_at=timezone.now())
    uid = u.id

    backfill = BackfillAuditLog.objects.create(
        user=u,
        field_name="medications",
        new_value=["aspirin"],
        source=BackfillAuditLog.Source.AI_EXTRACTION,
    )
    audit = AuditLog.objects.create(
        user=u, resource_type="user", resource_id=str(uid), action=AuditLog.Action.CREATE,
    )

    # Soft-delete the user, then backdate beyond the 30-day grace window.
    u.soft_delete("user_request")
    old_time = timezone.now() - timedelta(days=31)
    User.all_objects.filter(id=uid).update(deleted_at=old_time)

    from apps.jobs.tasks import purge_expired_soft_deletes_task
    result = purge_expired_soft_deletes_task()  # must not raise ProtectedError

    assert result["users"] >= 1
    assert not User.all_objects.filter(id=uid).exists()

    # Immutable logs survive; FK is SET_NULL.
    backfill.refresh_from_db()
    audit.refresh_from_db()
    assert backfill.user_id is None
    assert audit.user_id is None


def test_health_profile_and_evaluation_soft_delete_and_purge(db):
    """HealthProfile + HealthEvaluation are PHI: soft-deletable, default manager
    hides deleted, and the purge task hard-deletes expired rows."""
    from datetime import timedelta

    from django.contrib.auth import get_user_model
    from apps.health.models import HealthEvaluation, HealthProfile

    User = get_user_model()
    u = User.objects.create_user(email="hp@example.com", password="pass", email_verified_at=timezone.now())

    hp = HealthProfile.objects.create(user=u, score=80, score_label="good")
    he = HealthEvaluation.objects.create(user=u, score=80)
    he_id = he.id

    # Active rows visible by default.
    assert HealthProfile.objects.filter(pk=u.pk).exists()
    assert HealthEvaluation.objects.filter(id=he_id).exists()

    hp.soft_delete("gone")
    he.soft_delete("gone")

    # Default manager hides them; all_objects still shows them.
    assert not HealthProfile.objects.filter(pk=u.pk).exists()
    assert not HealthEvaluation.objects.filter(id=he_id).exists()
    assert HealthProfile.all_objects.filter(pk=u.pk).exists()
    assert HealthEvaluation.all_objects.filter(id=he_id).exists()

    # Backdate past grace window and purge.
    old_time = timezone.now() - timedelta(days=31)
    HealthProfile.all_objects.filter(pk=u.pk).update(deleted_at=old_time)
    HealthEvaluation.all_objects.filter(id=he_id).update(deleted_at=old_time)

    from apps.jobs.tasks import purge_expired_soft_deletes_task
    purge_expired_soft_deletes_task()

    assert not HealthProfile.all_objects.filter(pk=u.pk).exists()
    assert not HealthEvaluation.all_objects.filter(id=he_id).exists()


def test_old_access_token_rejected_after_account_soft_delete(db, api_client):
    """Real JWT path: after soft-delete, a request bearing the old access token
    returns 401 because the default UserManager filters out deleted users, so
    the token's user can no longer be resolved."""
    from django.contrib.auth import get_user_model
    from rest_framework_simplejwt.tokens import RefreshToken

    User = get_user_model()
    u = User.objects.create_user(email="jwt@example.com", password="pass", email_verified_at=timezone.now())

    access = str(RefreshToken.for_user(u).access_token)
    api_client.credentials(HTTP_AUTHORIZATION=f"Bearer {access}")

    # Token works while the account is active.
    assert api_client.get("/api/profile").status_code == 200

    # Soft-delete the account; the same token must now be rejected.
    u.soft_delete("user_request")
    assert api_client.get("/api/profile").status_code == 401
