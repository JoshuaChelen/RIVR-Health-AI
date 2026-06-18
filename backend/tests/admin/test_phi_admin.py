"""Tests asserting PHI fields are NOT in admin list_display/search_fields."""
import pytest
from django.contrib.admin.sites import AdminSite

from apps.jobs.admin import AiJobAdmin, AiJobEventAdmin
from apps.jobs.models import AiJob, AiJobEvent
from apps.profiles.admin import UserProfileAdmin
from apps.profiles.models import UserProfile
from apps.timeline.admin import TimelineEventAdmin
from apps.timeline.models import TimelineEvent


@pytest.mark.django_db
def test_aijob_event_message_not_in_list_display():
    admin = AiJobEventAdmin(AiJobEvent, AdminSite())
    assert "message" not in admin.list_display


@pytest.mark.django_db
def test_aijob_event_has_sanitized_message_callable():
    admin = AiJobEventAdmin(AiJobEvent, AdminSite())
    # sanitized_message should be in readonly_fields
    assert "sanitized_message" in admin.readonly_fields


@pytest.mark.django_db
def test_user_profile_first_name_not_in_list_display():
    admin = UserProfileAdmin(UserProfile, AdminSite())
    assert "first_name" not in admin.list_display


@pytest.mark.django_db
def test_user_profile_last_name_not_in_list_display():
    admin = UserProfileAdmin(UserProfile, AdminSite())
    assert "last_name" not in admin.list_display


@pytest.mark.django_db
def test_user_profile_first_name_not_in_search_fields():
    admin = UserProfileAdmin(UserProfile, AdminSite())
    assert "first_name" not in admin.search_fields


@pytest.mark.django_db
def test_user_profile_last_name_not_in_search_fields():
    admin = UserProfileAdmin(UserProfile, AdminSite())
    assert "last_name" not in admin.search_fields


@pytest.mark.django_db
def test_user_profile_names_in_readonly_fields():
    admin = UserProfileAdmin(UserProfile, AdminSite())
    assert "first_name" in admin.readonly_fields
    assert "last_name" in admin.readonly_fields


@pytest.mark.django_db
def test_timeline_event_title_not_in_list_display():
    admin = TimelineEventAdmin(TimelineEvent, AdminSite())
    assert "title" not in admin.list_display


@pytest.mark.django_db
def test_timeline_event_title_not_in_search_fields():
    admin = TimelineEventAdmin(TimelineEvent, AdminSite())
    assert "title" not in admin.search_fields


@pytest.mark.django_db
def test_timeline_event_title_in_readonly_fields():
    admin = TimelineEventAdmin(TimelineEvent, AdminSite())
    assert "title" in admin.readonly_fields
