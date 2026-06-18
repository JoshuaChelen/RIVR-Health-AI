"""Tests for Task 8: SubprocessorBAA registry."""
import pytest
from datetime import date, timedelta

from django.utils import timezone


@pytest.fixture
def baa(db):
    from apps.compliance.models import SubprocessorBAA
    return SubprocessorBAA.objects.create(
        vendor_name="OpenAI",
        service="LLM inference",
        baa_signed_date=date(2024, 1, 1),
        baa_expires_at=date(2099, 12, 31),
        status=SubprocessorBAA.Status.SIGNED,
    )


def test_subprocessor_baa_create(baa):
    from apps.compliance.models import SubprocessorBAA
    assert SubprocessorBAA.objects.filter(vendor_name="OpenAI").exists()


def test_is_expired_false(baa):
    assert not baa.is_expired()


def test_is_expired_true(db):
    from apps.compliance.models import SubprocessorBAA
    past = SubprocessorBAA.objects.create(
        vendor_name="OldVendor",
        service="old stuff",
        baa_signed_date=date(2020, 1, 1),
        baa_expires_at=date(2021, 1, 1),
        status=SubprocessorBAA.Status.EXPIRED,
    )
    assert past.is_expired()


def test_days_until_expiry(baa):
    days = baa.days_until_expiry()
    assert days > 0


def test_days_until_expiry_negative(db):
    from apps.compliance.models import SubprocessorBAA
    expired = SubprocessorBAA.objects.create(
        vendor_name="ExpiredVendor",
        service="x",
        baa_signed_date=date(2020, 1, 1),
        baa_expires_at=date(2020, 6, 1),
        status=SubprocessorBAA.Status.EXPIRED,
    )
    assert expired.days_until_expiry() < 0


def test_validate_baas_command_no_issues(db, capsys):
    from apps.compliance.models import SubprocessorBAA
    from django.core.management import call_command
    SubprocessorBAA.objects.create(
        vendor_name="GoodVendor",
        service="fine",
        baa_signed_date=date(2024, 1, 1),
        baa_expires_at=date(2099, 1, 1),
        status=SubprocessorBAA.Status.SIGNED,
    )
    call_command("validate_baas")
    captured = capsys.readouterr()
    assert "current" in captured.out.lower()


def test_validate_baas_command_warns_expired(db, capsys):
    from apps.compliance.models import SubprocessorBAA
    from django.core.management import call_command
    SubprocessorBAA.objects.create(
        vendor_name="ExpiredVendorCmd",
        service="x",
        baa_signed_date=date(2020, 1, 1),
        baa_expires_at=date(2020, 6, 1),
        status=SubprocessorBAA.Status.EXPIRED,
    )
    call_command("validate_baas")
    captured = capsys.readouterr()
    assert "expired" in captured.err.lower() or "attention" in captured.out.lower()


def test_vendor_name_unique(db):
    from apps.compliance.models import SubprocessorBAA
    from django.db import IntegrityError
    SubprocessorBAA.objects.create(
        vendor_name="UniqueVendor",
        service="x",
        baa_signed_date=date(2024, 1, 1),
        baa_expires_at=date(2099, 1, 1),
    )
    with pytest.raises(IntegrityError):
        SubprocessorBAA.objects.create(
            vendor_name="UniqueVendor",
            service="duplicate",
            baa_signed_date=date(2024, 1, 1),
            baa_expires_at=date(2099, 1, 1),
        )
