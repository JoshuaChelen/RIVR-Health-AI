"""Per-item review actions on AI-backfilled profile items (ai_-id items only).

Items are addressed by their unique ai_ id; the server locates the item across
the four backfilled array fields. All actions are owner-scoped via the JWT user.
"""
import logging

from django.utils import timezone as djtz
from rest_framework import status
from rest_framework.permissions import IsAuthenticated

from apps.common.permissions import IsEmailVerified
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.jobs import profile_logic as pl

from .models import UserProfile

logger = logging.getLogger(__name__)

AI_FIELDS = ["allergies", "medications", "medical_history", "surgical_history"]


def _propagate_review_change(user, action: str) -> None:
    """After a data-changing review action (reject/edit/un-reject/detach): regenerate
    the derived health profile and revoke now-stale shares. Observable for cost/volume."""
    from apps.jobs.services import trigger_profile_evaluation
    from apps.shares.services import revoke_active_shares

    trigger_profile_evaluation(user)
    revoked = revoke_active_shares(user)
    logger.info("review_change action=%s user=%s shares_revoked=%s", action, user.id, revoked)

# Detail (non-key) fields editable per array field. The first tuple element is
# the normalized-key field, which may NOT be edited here.
KEY_FIELD = {"allergies": "allergen", "medications": "name",
             "medical_history": "condition", "surgical_history": "procedure"}
DETAIL_FIELDS = {
    "allergies": {"reaction", "severity", "type"},
    "medications": {"dose", "frequency"},
    "medical_history": {"year", "notes"},
    "surgical_history": {"year", "notes"},
}


def _find(profile, item_id):
    for field in AI_FIELDS:
        arr = getattr(profile, field) or []
        for idx, it in enumerate(arr):
            if isinstance(it, dict) and it.get("id") == item_id:
                return field, idx, it
    return None, None, None


class _ItemBase(APIView):
    permission_classes = [IsAuthenticated, IsEmailVerified]

    def get_profile_and_item(self, request, item_id):
        if not pl.is_ai_backfilled(item_id):
            return None, None, None, None
        profile = UserProfile.for_user(request.user)
        field, idx, item = _find(profile, item_id)
        return profile, field, idx, item


class AiItemConfirmView(_ItemBase):
    def post(self, request, item_id):
        profile, field, idx, item = self.get_profile_and_item(request, item_id)
        if item is None:
            return Response({"detail": "Not found."}, status=status.HTTP_404_NOT_FOUND)
        item["review_status"] = "confirmed"
        item["reviewed_at"] = djtz.now().isoformat()
        getattr(profile, field)[idx] = item
        profile.save(update_fields=[field, "updated_at"])
        return Response({"id": item_id, "review_status": "confirmed"})


class AiItemRejectView(_ItemBase):
    def post(self, request, item_id):
        profile, field, idx, item = self.get_profile_and_item(request, item_id)
        if item is None:
            return Response({"detail": "Not found."}, status=status.HTTP_404_NOT_FOUND)
        arr = getattr(profile, field)
        rejected = arr.pop(idx)  # leave added_keys intact -> suppression prevents resurfacing
        # Drop the rejected id from current_item_ids bookkeeping (keep added_keys).
        meta = profile.ai_backfill_meta or {}
        fm = (meta.get("fields") or {}).get(field)
        if fm and item_id in (fm.get("current_item_ids") or []):
            fm["current_item_ids"] = [i for i in fm["current_item_ids"] if i != item_id]
            profile.ai_backfill_meta = meta
            profile.save(update_fields=[field, "ai_backfill_meta", "updated_at"])
        else:
            profile.save(update_fields=[field, "updated_at"])
        # Remove the matching timeline event(s) and regenerate the derived health
        # profile (3x5 card, summary, score) so the rejection shows up everywhere.
        from apps.documents.provenance import delete_timeline_for_item
        delete_timeline_for_item(request.user, field, rejected)
        _propagate_review_change(request.user, "reject")
        return Response({"id": item_id, "rejected": True})


class AiItemEditView(_ItemBase):
    def patch(self, request, item_id):
        profile, field, idx, item = self.get_profile_and_item(request, item_id)
        if item is None:
            return Response({"detail": "Not found."}, status=status.HTTP_404_NOT_FOUND)
        incoming = {k: v for k, v in request.data.items() if k not in ("id",)}
        if KEY_FIELD[field] in incoming:
            return Response(
                {"detail": "Renaming is not supported; reject this item and add it manually."},
                status=status.HTTP_400_BAD_REQUEST)
        allowed = DETAIL_FIELDS[field]
        bad = set(incoming) - allowed
        if bad:
            return Response({"detail": f"Cannot edit: {', '.join(sorted(bad))}."},
                            status=status.HTTP_400_BAD_REQUEST)
        import json
        try:
            payload_json = json.dumps(incoming)
            if len(payload_json) > 5000:
                return Response(
                    {"detail": "Edit payload exceeds 5KB limit."},
                    status=status.HTTP_400_BAD_REQUEST,
                )
        except (TypeError, ValueError):
            return Response(
                {"detail": "Invalid payload."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if "type" in incoming and incoming["type"] not in ("allergy", "intolerance"):
            return Response({"detail": "type must be 'allergy' or 'intolerance'."},
                            status=status.HTTP_400_BAD_REQUEST)
        # Content-gate edited values with the same calibrated rules as AI backfill /
        # manual edits (no HTML/control-chars/injection); legit clinical values pass.
        from apps.jobs.output_validator import OutputValidationError, validate_text_value
        for k, v in incoming.items():
            if isinstance(v, str):
                try:
                    validate_text_value(k, v)
                except OutputValidationError as exc:
                    return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        if "ai_original" not in item:
            item["ai_original"] = {k: item.get(k) for k in ({KEY_FIELD[field]} | allowed)}
        item.update(incoming)
        item["review_status"] = "edited"
        item["reviewed_at"] = djtz.now().isoformat()
        getattr(profile, field)[idx] = item
        profile.save(update_fields=[field, "updated_at"])
        # Regenerate the derived health profile so the corrected value (e.g. dose)
        # shows on the 3x5 card / summary.
        _propagate_review_change(request.user, "edit")
        return Response(item)


class AiItemSourcesView(_ItemBase):
    def get(self, request, item_id):
        from apps.documents.models import Document
        from apps.documents import provenance
        profile, field, idx, item = self.get_profile_and_item(request, item_id)
        if item is None:
            return Response({"detail": "Not found."}, status=status.HTTP_404_NOT_FOUND)
        cfg = next(c for c in provenance.FIELD_MAP if c.profile_field == field)
        key = cfg.profile_key(item)
        sources = []
        docs = (Document.objects.filter(user=request.user, status=Document.Status.PROCESSED,
                detached_at__isnull=True).exclude(source_type=Document.SourceType.MANUAL_INPUT)
                .order_by("-created_at")[:provenance.DOC_SCAN_CAP])
        for d in docs:
            summary = provenance.read_summary(d.summary_path)
            if not summary:
                continue
            facts = (summary.get("key_facts", {}) or {}).get(cfg.doc_field) or []
            if any(isinstance(f, dict) and cfg.doc_key(f) == key for f in facts):
                sources.append({"document_id": str(d.id), "title": d.title})
        return Response({"sources": sources})


class AiItemUnrejectView(APIView):
    """Undo a rejection: un-suppress the key and restore the item from document facts.

    Body: {field, key}. The key is what compute_suppressed_keys tracks (added_keys
    minus current array). After un-suppressing, the item is rebuilt from the latest
    active document that still reports it.
    """
    permission_classes = [IsAuthenticated, IsEmailVerified]

    def post(self, request):
        field = request.data.get("field")
        key = request.data.get("key")
        if field not in AI_FIELDS or not key:
            return Response({"detail": "field and key are required."},
                            status=status.HTTP_400_BAD_REQUEST)
        profile = UserProfile.for_user(request.user)
        meta = profile.ai_backfill_meta or {"fields": {}, "last_backfill_at": ""}
        fm = meta.setdefault("fields", {}).setdefault(field, {"added_keys": [], "current_item_ids": []})

        from apps.documents.provenance import restore_item_from_docs
        item = restore_item_from_docs(request.user, field, key)
        restored = False
        if item is not None:
            arr = getattr(profile, field) or []
            arr.append(item)
            setattr(profile, field, arr)
            # Only un-suppress once we've actually restored it; otherwise leave the key
            # suppressed so it can't silently resurface from a future re-process.
            fm["added_keys"] = [k for k in fm.get("added_keys", []) if k != key]
            # Rebuild current_item_ids from the live array (no stale ids).
            fm["current_item_ids"] = [
                it["id"] for it in arr
                if isinstance(it, dict) and pl.is_ai_backfilled(it.get("id"))
            ]
            restored = True

        profile.ai_backfill_meta = meta
        profile.save(update_fields=[field, "ai_backfill_meta", "updated_at"])
        if restored:
            _propagate_review_change(request.user, "unreject")
        return Response({"field": field, "key": key, "restored": restored})
