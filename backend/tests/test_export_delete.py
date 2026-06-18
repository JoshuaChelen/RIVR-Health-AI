"""Tests for Task 6: data export + account deletion with 7-day cooldown."""
import pytest
from django.utils import timezone


@pytest.fixture
def user(db):
    from django.contrib.auth import get_user_model
    User = get_user_model()
    return User.objects.create_user(
        email="export@example.com", password="pass", email_verified_at=timezone.now()
    )


# ── Export ────────────────────────────────────────────────────────────────────


def test_export_request_returns_202(db, api_client, user):
    api_client.force_authenticate(user=user)
    resp = api_client.post("/api/auth/me/export/request")
    assert resp.status_code == 202
    assert "export_id" in resp.data


def test_export_request_creates_data_export_job(db, api_client, user):
    from apps.accounts.models import DataExportJob

    api_client.force_authenticate(user=user)
    api_client.post("/api/auth/me/export/request")
    assert DataExportJob.objects.filter(user=user).exists()


def test_export_requires_email_verification(db, api_client):
    """An unverified user cannot pull a PHI export — gate consistent with other PHI reads."""
    from django.contrib.auth import get_user_model

    User = get_user_model()
    unverified = User.objects.create_user(email="unverified-export@example.com", password="pass")
    assert unverified.email_verified_at is None
    api_client.force_authenticate(user=unverified)
    assert api_client.post("/api/auth/me/export/request").status_code == 403
    assert api_client.get(
        "/api/auth/me/export/status/00000000-0000-0000-0000-000000000000"
    ).status_code == 403


def test_export_task_runs_eagerly_and_completes(db, api_client, user):
    """With CELERY_TASK_ALWAYS_EAGER=True the task runs inline; job completes."""
    from apps.accounts.models import DataExportJob

    api_client.force_authenticate(user=user)
    resp = api_client.post("/api/auth/me/export/request")
    assert resp.status_code == 202

    job = DataExportJob.objects.get(id=resp.data["export_id"])
    assert job.status == DataExportJob.Status.COMPLETED


def test_export_rate_limited_to_once_per_day(db, api_client, user):
    api_client.force_authenticate(user=user)
    r1 = api_client.post("/api/auth/me/export/request")
    assert r1.status_code == 202
    r2 = api_client.post("/api/auth/me/export/request")
    assert r2.status_code == 429


def test_export_status_endpoint(db, api_client, user):
    from apps.accounts.models import DataExportJob

    api_client.force_authenticate(user=user)
    r = api_client.post("/api/auth/me/export/request")
    export_id = r.data["export_id"]
    resp = api_client.get(f"/api/auth/me/export/status/{export_id}")
    assert resp.status_code == 200
    assert resp.data["export_id"] == export_id


def test_export_status_other_user_gets_404(db, api_client, user):
    """A different user cannot access someone else's export."""
    from django.contrib.auth import get_user_model

    User = get_user_model()
    other = User.objects.create_user(
        email="other@example.com", password="pass", email_verified_at=timezone.now()
    )
    api_client.force_authenticate(user=user)
    r = api_client.post("/api/auth/me/export/request")
    export_id = r.data["export_id"]

    api_client.force_authenticate(user=other)
    resp = api_client.get(f"/api/auth/me/export/status/{export_id}")
    assert resp.status_code == 404


def test_export_logs_to_audit(db, api_client, user):
    from apps.audit.models import AuditLog

    api_client.force_authenticate(user=user)
    api_client.post("/api/auth/me/export/request")
    assert AuditLog.objects.filter(user=user, action=AuditLog.Action.ACCESS).exists()


# ── Deletion request ──────────────────────────────────────────────────────────


def test_deletion_request_returns_202(db, api_client, user):
    api_client.force_authenticate(user=user)
    resp = api_client.post("/api/auth/me/delete/request")
    assert resp.status_code == 202
    assert "can_confirm_at" in resp.data


def test_deletion_request_creates_model(db, api_client, user):
    from apps.accounts.models import AccountDeletionRequest

    api_client.force_authenticate(user=user)
    api_client.post("/api/auth/me/delete/request")
    assert AccountDeletionRequest.objects.filter(user=user).exists()


def test_deletion_request_has_7_day_cooldown(db, api_client, user):
    from apps.accounts.models import AccountDeletionRequest

    api_client.force_authenticate(user=user)
    api_client.post("/api/auth/me/delete/request")
    dr = AccountDeletionRequest.objects.get(user=user)
    assert dr.can_confirm_at > timezone.now()
    delta = dr.can_confirm_at - dr.requested_at
    assert delta.days >= 6  # at least 6 days (accounts for subsecond timing)


def test_deletion_request_logged_to_audit(db, api_client, user):
    from apps.audit.models import AuditLog

    api_client.force_authenticate(user=user)
    api_client.post("/api/auth/me/delete/request")
    assert AuditLog.objects.filter(user=user, action=AuditLog.Action.DELETE).exists()


def test_deletion_request_rate_limited(db, api_client, user):
    api_client.force_authenticate(user=user)
    r1 = api_client.post("/api/auth/me/delete/request")
    assert r1.status_code == 202
    r2 = api_client.post("/api/auth/me/delete/request")
    assert r2.status_code == 429


# ── Deletion confirm ──────────────────────────────────────────────────────────


def test_deletion_confirm_before_cooldown_returns_400(db, api_client, user):
    api_client.force_authenticate(user=user)
    r = api_client.post("/api/auth/me/delete/request")
    token = r.data["confirmation_token"]
    resp = api_client.post(
        "/api/auth/me/delete/confirm", {"confirmation_token": token}, format="json"
    )
    assert resp.status_code == 400


def test_deletion_confirm_without_request_returns_400(db, api_client, user):
    api_client.force_authenticate(user=user)
    resp = api_client.post(
        "/api/auth/me/delete/confirm",
        {"confirmation_token": "anything"},
        format="json",
    )
    assert resp.status_code == 400


def test_deletion_confirm_after_cooldown_soft_deletes(db, api_client):
    """After setting can_confirm_at in the past, confirm completes soft-delete."""
    from datetime import timedelta

    from django.contrib.auth import get_user_model
    from django.contrib.auth.models import Permission
    from apps.accounts.models import AccountDeletionRequest

    User = get_user_model()
    u = User.objects.create_user(
        email="confirm@example.com", password="pass", email_verified_at=timezone.now()
    )
    uid = u.id
    api_client.force_authenticate(user=u)

    r = api_client.post("/api/auth/me/delete/request")
    token = r.data["confirmation_token"]

    # Bypass the cooldown by backdating can_confirm_at
    AccountDeletionRequest.objects.filter(user=u).update(
        can_confirm_at=timezone.now() - timedelta(seconds=1)
    )

    resp = api_client.post(
        "/api/auth/me/delete/confirm",
        {"confirmation_token": token},
        format="json",
    )
    assert resp.status_code == 200

    # User is now soft-deleted
    assert not User.objects.filter(id=uid).exists()
    assert User.all_objects.filter(id=uid, deleted_at__isnull=False).exists()


def test_deletion_confirm_wrong_token_returns_400(db, api_client, user):
    from datetime import timedelta
    from apps.accounts.models import AccountDeletionRequest

    api_client.force_authenticate(user=user)
    api_client.post("/api/auth/me/delete/request")
    AccountDeletionRequest.objects.filter(user=user).update(
        can_confirm_at=timezone.now() - timedelta(seconds=1)
    )
    resp = api_client.post(
        "/api/auth/me/delete/confirm",
        {"confirmation_token": "wrongtoken"},
        format="json",
    )
    assert resp.status_code == 400


def test_deletion_confirm_logged_to_audit(db, api_client):
    """The actual soft-delete execution (not just the request) is audited."""
    from datetime import timedelta

    from django.contrib.auth import get_user_model
    from apps.accounts.models import AccountDeletionRequest
    from apps.audit.models import AuditLog

    User = get_user_model()
    u = User.objects.create_user(
        email="confirmaudit@example.com", password="pass", email_verified_at=timezone.now()
    )
    uid = u.id
    api_client.force_authenticate(user=u)

    r = api_client.post("/api/auth/me/delete/request")
    token = r.data["confirmation_token"]
    AccountDeletionRequest.objects.filter(user=u).update(
        can_confirm_at=timezone.now() - timedelta(seconds=1)
    )

    # Audit entries with a live user FK before confirm (request-time entry).
    before = AuditLog.objects.filter(
        resource_id=str(uid), action=AuditLog.Action.DELETE
    ).count()

    resp = api_client.post(
        "/api/auth/me/delete/confirm",
        {"confirmation_token": token},
        format="json",
    )
    assert resp.status_code == 200

    # A second DELETE audit entry was written for the execution itself.
    after = AuditLog.objects.filter(
        resource_id=str(uid), action=AuditLog.Action.DELETE
    ).count()
    assert after == before + 1


# ── Export TTL + cleanup ────────────────────────────────────────────────────


def test_export_url_ttl_is_one_hour(db, api_client, user):
    from datetime import timedelta

    from apps.accounts.models import DataExportJob

    api_client.force_authenticate(user=user)
    r = api_client.post("/api/auth/me/export/request")
    job = DataExportJob.objects.get(id=r.data["export_id"])
    assert job.url_expires_at is not None
    ttl = job.url_expires_at - job.completed_at
    # ~1 hour, allow a small window for execution time.
    assert timedelta(minutes=55) <= ttl <= timedelta(minutes=65)


def test_cleanup_expired_exports_deletes_expired(db, user):
    from datetime import timedelta

    from apps.accounts.export_tasks import cleanup_expired_exports_task
    from apps.accounts.models import DataExportJob

    job = DataExportJob.objects.create(
        user=user,
        status=DataExportJob.Status.COMPLETED,
        export_url="https://example.com/exports/old.zip",
        url_expires_at=timezone.now() - timedelta(hours=1),
    )
    cleaned = cleanup_expired_exports_task()
    assert cleaned >= 1
    job.refresh_from_db()
    assert job.export_url == ""


def test_cleanup_expired_exports_leaves_fresh(db, user):
    from datetime import timedelta

    from apps.accounts.export_tasks import cleanup_expired_exports_task
    from apps.accounts.models import DataExportJob

    job = DataExportJob.objects.create(
        user=user,
        status=DataExportJob.Status.COMPLETED,
        export_url="https://example.com/exports/fresh.zip",
        url_expires_at=timezone.now() + timedelta(hours=1),
    )
    cleanup_expired_exports_task()
    job.refresh_from_db()
    assert job.export_url == "https://example.com/exports/fresh.zip"
