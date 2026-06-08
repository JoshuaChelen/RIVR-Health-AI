"""Share package creation + resolution. Security-critical."""
import hashlib
import secrets
import uuid
from datetime import timedelta

from django.conf import settings
from django.core.files.base import ContentFile
from django.core.files.storage import default_storage
from django.utils import timezone

from apps.common import storage

from . import pdf
from .models import SharePackage

VALID_TYPES = {"full_summary", "card_3x5", "pre_visit_note", "full_timeline"}


def _hash(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def create_share(user, share_types: list[str], pin: str | None = None) -> tuple[str, SharePackage]:
    types = [t for t in share_types if t in VALID_TYPES] or ["full_summary"]
    pdfs: dict[str, str] = {}
    for t in types:
        key = f"share-artifacts/{uuid.uuid4().hex}/{t}.pdf"
        default_storage.save(key, ContentFile(pdf.build_pdf(t, user.id)))
        pdfs[t] = key
    token = secrets.token_urlsafe(32)
    package = SharePackage.objects.create(
        owner=user,
        token_hash=_hash(token),
        file_type=SharePackage.FileType.HEALTH_PROFILE,
        expires_at=timezone.now() + timedelta(minutes=settings.SHARE_EXPIRES_MINUTES),
        max_views=settings.SHARE_MAX_VIEWS,
        pin_hash=_hash(pin) if pin else "",
        payload_json={"types": types, "pdfs": pdfs},
    )
    return token, package


def _delete_artifacts(package: SharePackage) -> None:
    for key in (package.payload_json or {}).get("pdfs", {}).values():
        storage.delete(key)
    package.artifacts_deleted_at = timezone.now()
    package.save(update_fields=["artifacts_deleted_at"])


def resolve_share(token: str, pin: str | None = None) -> dict:
    """Validate a share token and return signed artifact URLs, or an error dict."""
    package = SharePackage.objects.filter(token_hash=_hash(token)).first()
    if package is None or package.revoked:
        return {"error": "Not found", "status": 404}
    if timezone.now() >= package.expires_at:
        if package.artifacts_deleted_at is None:
            _delete_artifacts(package)
        return {"error": "This link has expired", "status": 410}
    if package.pin_hash:
        if package.pin_attempts >= settings.SHARE_MAX_PIN_ATTEMPTS:
            return {"error": "Too many attempts", "pinRequired": True, "status": 429}
        if not pin:
            return {"pinRequired": True, "status": 401}
        if not secrets.compare_digest(package.pin_hash, _hash(pin)):
            package.pin_attempts += 1
            package.save(update_fields=["pin_attempts"])
            return {"error": "Wrong PIN", "pinRequired": True, "status": 401}
    if package.max_views is not None and package.views_count >= package.max_views:
        return {"error": "View limit reached", "status": 410}

    package.views_count += 1
    package.save(update_fields=["views_count"])
    items = [
        {"title": pdf.TITLES.get(t, t), "signedUrl": storage.signed_url(key, expire=120), "expiresIn": 120}
        for t, key in (package.payload_json or {}).get("pdfs", {}).items()
    ]
    return {"items": items, "expiresAt": package.expires_at.isoformat(), "pinRequired": False}


def cleanup_expired_artifacts() -> int:
    expired = SharePackage.objects.filter(
        file_type=SharePackage.FileType.HEALTH_PROFILE,
        artifacts_deleted_at__isnull=True,
        expires_at__lte=timezone.now(),
    )
    count = 0
    for package in expired:
        _delete_artifacts(package)
        count += 1
    return count
