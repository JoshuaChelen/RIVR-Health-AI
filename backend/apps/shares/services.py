"""Share package creation + resolution. Security-critical."""
import hashlib
import secrets
import uuid
from datetime import timedelta

from django.conf import settings
from django.core.files.base import ContentFile
from django.core.files.storage import default_storage
from django.db import models, transaction
from django.utils import timezone

from apps.common import storage

from . import pdf
from .audit import log_share_access
from .models import SharePackage

VALID_TYPES = {"full_summary", "card_3x5", "pre_visit_note", "full_timeline"}


def _hash(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def create_share(user, share_types: list[str], pin: str | None = None) -> tuple[str, SharePackage]:
    # Validate share_types: reject invalid types rather than silently dropping them
    invalid_types = [t for t in share_types if t not in VALID_TYPES]
    if invalid_types:
        raise ValueError(
            f"Invalid share types: {', '.join(invalid_types)}. "
            f"Valid types: {', '.join(sorted(VALID_TYPES))}"
        )
    types = list(share_types) or ["full_summary"]
    # Validate PIN strength if provided
    if pin is not None and len(pin) < 4:
        raise ValueError("PIN must be 4+ characters")
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


def revoke_active_shares(user) -> int:
    """Revoke the user's active (non-expired, non-revoked) shares.

    Called when a review action (reject/edit/detach) changes the health record, so a
    link shared earlier can't keep exposing now-removed/changed data (the share PDFs
    are point-in-time snapshots). The user re-shares to send the corrected record.
    """
    active = list(SharePackage.objects.filter(
        owner=user, revoked=False, expires_at__gt=timezone.now()))
    for pkg in active:
        _delete_artifacts(pkg)
        pkg.revoked = True
        pkg.save(update_fields=["revoked"])
    return len(active)


def _delete_artifacts(package: SharePackage) -> None:
    for key in (package.payload_json or {}).get("pdfs", {}).values():
        storage.delete(key)
    package.artifacts_deleted_at = timezone.now()
    package.save(update_fields=["artifacts_deleted_at"])


def resolve_share(token: str, pin: str | None = None, client_ip: str = "0.0.0.0") -> dict:
    """Validate a share token and return signed artifact URLs, or an error dict.

    Uses select_for_update() inside a transaction to prevent TOCTOU races on
    max_views: only one concurrent request holds the row lock at a time.
    PIN lockout uses exponential backoff: 2^N seconds (capped at 3600 = 1 hour).
    All access attempts are logged to ShareAccessLog for forensic audit.
    """
    with transaction.atomic():
        package = SharePackage.objects.select_for_update().filter(
            token_hash=_hash(token)
        ).first()

        if package is None or package.revoked:
            log_share_access(package, "token_invalid", client_ip) if package else None
            return {"error": "Not found", "status": 404}

        if timezone.now() >= package.expires_at:
            if package.artifacts_deleted_at is None:
                _delete_artifacts(package)
            log_share_access(package, "expired", client_ip)
            return {"error": "This link has expired", "status": 410}

        # --- PIN checks (inside the lock) ---
        if package.pin_hash:
            now = timezone.now()

            # Check if lockout is still active
            if package.pin_locked_until and now < package.pin_locked_until:
                log_share_access(package, "pin_locked", client_ip, pin_attempt=package.pin_attempts)
                return {"error": "Too many attempts. Try again later.", "pinRequired": True, "status": 429}

            # Lockout expired: reset attempts
            if package.pin_locked_until and now >= package.pin_locked_until:
                package.pin_attempts = 0
                package.pin_locked_until = None
                package.save(update_fields=["pin_attempts", "pin_locked_until"])

            if not pin:
                return {"pinRequired": True, "status": 401}

            if not secrets.compare_digest(package.pin_hash, _hash(pin)):
                package.pin_attempts += 1
                # Exponential backoff: 2^N seconds, capped at 3600 (1 hour)
                backoff_seconds = min(2 ** package.pin_attempts, 3600)
                package.pin_locked_until = now + timedelta(seconds=backoff_seconds)
                package.save(update_fields=["pin_attempts", "pin_locked_until"])
                log_share_access(package, "pin_mismatch", client_ip, pin_attempt=package.pin_attempts)
                return {"error": "Wrong PIN", "pinRequired": True, "status": 401}

            # Correct PIN: reset attempts and lockout
            if package.pin_attempts > 0:
                package.pin_attempts = 0
                package.pin_locked_until = None
                package.save(update_fields=["pin_attempts", "pin_locked_until"])

        # --- Atomic max_views enforcement ---
        # Use conditional UPDATE (WHERE views_count < max_views) to prevent race
        # conditions: rows-affected == 0 means the limit was already reached.
        if package.max_views is not None:
            updated = SharePackage.objects.filter(
                id=package.id,
                views_count__lt=package.max_views,
            ).update(views_count=models.F("views_count") + 1)

            if updated == 0:
                # Re-read current count for the log (best-effort)
                package.refresh_from_db(fields=["views_count"])
                log_share_access(package, "view_limit_exceeded", client_ip, views_count=package.views_count)
                return {"error": "View limit reached", "status": 410}
        else:
            SharePackage.objects.filter(id=package.id).update(
                views_count=models.F("views_count") + 1
            )

        package.refresh_from_db(fields=["views_count"])

    log_share_access(package, "resolved", client_ip, views_count=package.views_count)

    items = [
        {
            "title": pdf.TITLES.get(t, t),
            "signedUrl": storage.signed_url(key, expire=60),
            "expiresIn": 60,
        }
        for t, key in (package.payload_json or {}).get("pdfs", {}).items()
    ]
    return {"items": items, "expiresAt": package.expires_at.isoformat(), "pinRequired": False}
