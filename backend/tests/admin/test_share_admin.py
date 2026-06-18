"""Task 6 tests: admin PHI exclusion and audit log immutability."""
import pytest
from django.contrib.admin.sites import AdminSite
from django.utils import timezone

from apps.accounts.models import User
from apps.shares.admin import ShareAccessLogAdmin, SharePackageAdmin
from apps.shares.models import ShareAccessLog, SharePackage


@pytest.fixture
def admin_user(db):
    return User.objects.create_user(email="admin@example.com", password="pw123", is_staff=True)


@pytest.fixture
def superuser(db):
    return User.objects.create_superuser(email="super@example.com", password="pw123")


@pytest.mark.django_db
def test_share_admin_excludes_payload():
    admin_site = AdminSite()
    instance = SharePackageAdmin(SharePackage, admin_site)
    assert "payload_json" in (instance.exclude or [])
    assert "payload_json" not in (instance.list_display or [])


@pytest.mark.django_db
def test_share_admin_no_add_permission(admin_user):
    from django.test import RequestFactory
    rf = RequestFactory()
    req = rf.get("/")
    req.user = admin_user
    instance = SharePackageAdmin(SharePackage, AdminSite())
    assert instance.has_add_permission(req) is False


@pytest.mark.django_db
def test_share_admin_no_change_permission(admin_user):
    from django.test import RequestFactory
    rf = RequestFactory()
    req = rf.get("/")
    req.user = admin_user
    instance = SharePackageAdmin(SharePackage, AdminSite())
    assert instance.has_change_permission(req, None) is False


@pytest.mark.django_db
def test_share_admin_delete_only_for_superuser(admin_user, superuser):
    from django.test import RequestFactory
    rf = RequestFactory()

    req_staff = rf.get("/")
    req_staff.user = admin_user
    req_super = rf.get("/")
    req_super.user = superuser

    instance = SharePackageAdmin(SharePackage, AdminSite())
    assert instance.has_delete_permission(req_staff, None) is False
    assert instance.has_delete_permission(req_super, None) is True


@pytest.mark.django_db
def test_access_log_admin_immutable(admin_user):
    from django.test import RequestFactory
    rf = RequestFactory()
    req = rf.get("/")
    req.user = admin_user
    instance = ShareAccessLogAdmin(ShareAccessLog, AdminSite())
    assert instance.has_add_permission(req) is False
    assert instance.has_change_permission(req, None) is False
    assert instance.has_delete_permission(req, None) is False
