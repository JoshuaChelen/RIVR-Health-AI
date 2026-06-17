"""Per-item review actions on AI-backfilled profile items (ai_-id items only).

Items are addressed by their unique ai_ id; the server locates the item across
the four backfilled array fields. All actions are owner-scoped via the JWT user.
"""
from django.utils import timezone as djtz
from rest_framework import status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.jobs import profile_logic as pl

from .models import UserProfile

AI_FIELDS = ["allergies", "medications", "medical_history", "surgical_history"]

# Detail (non-key) fields editable per array field. The first tuple element is
# the normalized-key field, which may NOT be edited here.
KEY_FIELD = {"allergies": "allergen", "medications": "name",
             "medical_history": "condition", "surgical_history": "procedure"}
DETAIL_FIELDS = {
    "allergies": {"reaction", "severity"},
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
    permission_classes = [IsAuthenticated]

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
        arr.pop(idx)  # leave added_keys intact -> suppression prevents resurfacing
        profile.save(update_fields=[field, "updated_at"])
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
        if "ai_original" not in item:
            item["ai_original"] = {k: item.get(k) for k in ({KEY_FIELD[field]} | allowed)}
        item.update(incoming)
        item["review_status"] = "edited"
        item["reviewed_at"] = djtz.now().isoformat()
        getattr(profile, field)[idx] = item
        profile.save(update_fields=[field, "updated_at"])
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
                detached_at__isnull=True).exclude(source_type=Document.SourceType.MANUAL_INPUT))
        for d in docs:
            summary = provenance.read_summary(d.summary_path)
            if not summary:
                continue
            facts = (summary.get("key_facts", {}) or {}).get(cfg.doc_field) or []
            if any(isinstance(f, dict) and cfg.doc_key(f) == key for f in facts):
                sources.append({"document_id": str(d.id), "title": d.title})
        return Response({"sources": sources})
