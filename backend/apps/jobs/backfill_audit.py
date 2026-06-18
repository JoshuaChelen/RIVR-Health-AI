"""Helper to create BackfillAuditLog entries without boilerplate."""
from __future__ import annotations


def log_backfill(
    user,
    field_name: str,
    new_value,
    source: str,
    old_value=None,
    evaluation_id: str | None = None,
    document_id: str | None = None,
    approved_by=None,
) -> None:
    """Create an immutable BackfillAuditLog entry. Silently no-ops on failure."""
    try:
        from .models import BackfillAuditLog
        BackfillAuditLog.objects.create(
            user=user,
            evaluation_id=str(evaluation_id) if evaluation_id else None,
            document_id=str(document_id) if document_id else None,
            field_name=field_name,
            old_value=old_value,
            new_value=new_value,
            source=source,
            approved_by=approved_by,
        )
    except Exception:
        pass
