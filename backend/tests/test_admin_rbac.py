"""Tests for admin RBAC: PHI access control by group + read-only event admin."""
import pytest
from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group
from django.contrib.admin.sites import AdminSite
from django.test import RequestFactory
from django.utils import timezone

from apps.jobs.admin import AiJobEventAdmin
from apps.jobs.models import AiJobEvent
from apps.profiles.admin import UserProfileAdmin
from apps.profiles.models import UserProfile

User = get_user_model()


def _make_user(email):
    return User.objects.create_user(
        email=email, password="Str0ngPass!23", email_verified_at=timezone.now()
    )


def _request_for(user):
    request = RequestFactory().get("/admin/")
    request.user = user
    return request


def _profile_admin():
    return UserProfileAdmin(UserProfile, AdminSite())


def test_support_cannot_view_profiles(db):
    patient = _make_user("patient1@example.com")
    UserProfile.for_user(patient)
    support = _make_user("support@example.com")
    support.is_staff = True
    support.save()
    group, _ = Group.objects.get_or_create(name="support")
    support.groups.add(group)

    admin = _profile_admin()
    qs = admin.get_queryset(_request_for(support))
    assert qs.count() == 0


def test_auditor_cannot_view_profiles(db):
    patient = _make_user("patient2@example.com")
    UserProfile.for_user(patient)
    auditor = _make_user("auditor@example.com")
    auditor.is_staff = True
    auditor.save()
    group, _ = Group.objects.get_or_create(name="auditor")
    auditor.groups.add(group)

    admin = _profile_admin()
    qs = admin.get_queryset(_request_for(auditor))
    assert qs.count() == 0


def test_clinician_sees_all_profiles(db):
    patient = _make_user("patient3@example.com")
    UserProfile.for_user(patient)
    clinician = _make_user("clinician@example.com")
    clinician.is_staff = True
    clinician.save()
    group, _ = Group.objects.get_or_create(name="clinician")
    clinician.groups.add(group)

    admin = _profile_admin()
    qs = admin.get_queryset(_request_for(clinician))
    assert qs.count() >= 1


def test_superuser_bypasses_rbac(db):
    patient = _make_user("patient4@example.com")
    UserProfile.for_user(patient)
    superuser = User.objects.create_superuser(
        email="root@example.com", password="Str0ngPass!23"
    )

    admin = _profile_admin()
    qs = admin.get_queryset(_request_for(superuser))
    assert qs.count() >= 1


def test_ai_job_event_admin_readonly(db):
    admin = AiJobEventAdmin(AiJobEvent, AdminSite())
    request = _request_for(_make_user("anyone@example.com"))
    assert admin.has_add_permission(request) is False
    assert admin.has_change_permission(request) is False
    assert admin.has_delete_permission(request) is False


def test_support_cannot_view_profile_detail(db):
    support = _make_user("support_view@example.com")
    support.is_staff = True
    support.save()
    group, _ = Group.objects.get_or_create(name="support")
    support.groups.add(group)

    admin = _profile_admin()
    assert admin.has_view_permission(_request_for(support)) is False


def test_clinician_can_view_profile_detail(db):
    clinician = _make_user("clinician_view@example.com")
    clinician.is_staff = True
    clinician.save()
    group, _ = Group.objects.get_or_create(name="clinician")
    clinician.groups.add(group)

    admin = _profile_admin()
    assert admin.has_view_permission(_request_for(clinician)) is True
