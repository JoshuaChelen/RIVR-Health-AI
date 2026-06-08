"""Model + constraint tests for the migrated schema."""
import uuid

import pytest
from django.contrib.auth import get_user_model
from django.db import IntegrityError, transaction

from apps.documents.models import Document
from apps.health.models import HealthProfile
from apps.jobs.models import AiJob, AiJobEvent
from apps.shares.models import SharePackage, SharePackageItem
from apps.timeline.models import TimelineEvent

User = get_user_model()


@pytest.fixture
def user(db):
    return User.objects.create_user(email="u@example.com", password="pw")


@pytest.fixture
def other_user(db):
    return User.objects.create_user(email="o@example.com", password="pw")


def test_health_profile_pk_is_user_and_defaults_v2(user):
    hp = HealthProfile.objects.create(user=user, score=80, score_label="Good")
    assert hp.pk == user.pk
    assert hp.version == "profile_v2"
    assert hp.summary_json == {} and hp.card_json == {} and hp.sources == {}


def test_manual_input_unique_per_user(user, other_user):
    Document.objects.create(user=user, source_type=Document.SourceType.MANUAL_INPUT)
    # A second manual-input doc for the SAME user is rejected.
    with pytest.raises(IntegrityError):
        with transaction.atomic():
            Document.objects.create(user=user, source_type=Document.SourceType.MANUAL_INPUT)
    # But a file doc for the same user, and a manual doc for another user, are fine.
    Document.objects.create(user=user, source_type=Document.SourceType.FILE)
    Document.objects.create(user=other_user, source_type=Document.SourceType.MANUAL_INPUT)


def test_ai_job_defaults(user):
    job = AiJob.objects.create(user=user, job_type=AiJob.JobType.PROCESS_DOCUMENTS)
    assert job.status == AiJob.Status.QUEUED
    assert job.priority == 100
    assert job.attempts == 0
    assert job.document_ids == []
    assert job.progress == {}
    assert job.cancel_requested is False


def test_ai_job_event_bigint_pk(user):
    job = AiJob.objects.create(user=user, job_type=AiJob.JobType.PROFILE_EVALUATION)
    ev = AiJobEvent.objects.create(job=job, message="started")
    assert isinstance(ev.pk, int)
    assert ev.level == AiJobEvent.Level.INFO


def test_share_token_hash_unique(user, other_user):
    from django.utils import timezone

    expires = timezone.now()
    SharePackage.objects.create(
        owner=user, token_hash="abc", file_type=SharePackage.FileType.HEALTH_PROFILE, expires_at=expires
    )
    with pytest.raises(IntegrityError):
        with transaction.atomic():
            SharePackage.objects.create(
                owner=other_user, token_hash="abc", file_type=SharePackage.FileType.PDF, expires_at=expires
            )


def test_share_package_item_unique_together(user):
    from django.utils import timezone

    pkg = SharePackage.objects.create(
        owner=user, token_hash="t1", file_type=SharePackage.FileType.PDF, expires_at=timezone.now()
    )
    doc = Document.objects.create(user=user, source_type=Document.SourceType.PDF)
    SharePackageItem.objects.create(package=pkg, document=doc)
    with pytest.raises(IntegrityError):
        with transaction.atomic():
            SharePackageItem.objects.create(package=pkg, document=doc)


def test_timeline_document_set_null_on_delete(user):
    doc = Document.objects.create(user=user, source_type=Document.SourceType.PDF)
    ev = TimelineEvent.objects.create(user=user, document=doc, title="Visit")
    doc.delete()
    ev.refresh_from_db()
    assert ev.document_id is None  # SET_NULL, event survives


def test_delete_user_cascades(user):
    Document.objects.create(user=user, source_type=Document.SourceType.FILE)
    HealthProfile.objects.create(user=user, score=50, score_label="Fair")
    AiJob.objects.create(user=user, job_type=AiJob.JobType.PROCESS_DOCUMENTS)
    uid = user.pk
    user.delete()
    assert Document.objects.filter(user_id=uid).count() == 0
    assert HealthProfile.objects.filter(user_id=uid).count() == 0
    assert AiJob.objects.filter(user_id=uid).count() == 0
