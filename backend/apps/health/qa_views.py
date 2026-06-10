import json

from django.conf import settings
from django.core.files.storage import default_storage
from rest_framework import status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.documents.models import Document
from apps.jobs import ai_client, index
from apps.timeline.models import TimelineEvent

from .models import HealthProfile

MAX_QUESTION = 500


def _static_qa_context(user) -> str:
    parts: list[str] = []
    hp = HealthProfile.objects.filter(user=user).first()
    if hp:
        summary = (hp.summary_json or {}).get("full_summary_markdown") or ""
        parts.append(f"HEALTH_SUMMARY (score {hp.score} {hp.score_label}):\n{summary[:8000]}")
    docs = Document.objects.filter(
        user=user, status=Document.Status.PROCESSED, summary_path__gt=""
    ).exclude(source_type=Document.SourceType.MANUAL_INPUT)[:12]
    for doc in docs:
        try:
            with default_storage.open(doc.summary_path) as fh:
                facts = json.loads(fh.read())
            parts.append(f"DOCUMENT [{doc.title}]: {json.dumps(facts.get('key_facts', {}))[:1500]}")
        except Exception:
            continue
    events = TimelineEvent.objects.filter(user=user).exclude(source="apple_health").order_by("-occurred_at")[:80]
    if events:
        lines = [f"- {e.occurred_at or 'undated'}: {e.title}" for e in events]
        parts.append("TIMELINE:\n" + "\n".join(lines)[:9000])
    return "\n\n".join(parts)[:30000]


def build_qa_context(user, question: str):
    """Return (context_str, sources). Retrieval-based; falls back to the static slice on any error."""
    try:
        hits = index.search(user, question, k=12)
    except Exception:
        return _static_qa_context(user), []

    parts: list[str] = []
    sources: list[dict] = []
    hp = HealthProfile.objects.filter(user=user).first()
    if hp:
        summary = (hp.summary_json or {}).get("full_summary_markdown") or ""
        if summary:
            parts.append(f"HEALTH_SUMMARY (score {hp.score} {hp.score_label}):\n{summary[:8000]}")
    for h in hits:
        parts.append(f"RECORD: {h.content}")
        sources.append({
            "title": (h.document.title if h.document_id and h.document else "Record"),
            "type": ("timeline" if h.kind == "timeline" else "document"),
            "detail": h.content[:160],
        })
    # keep the timeline slice so timeline coverage isn't regressed (timeline embedding is a follow-up)
    events = TimelineEvent.objects.filter(user=user).exclude(source="apple_health").order_by("-occurred_at")[:80]
    if events:
        lines = [f"- {e.occurred_at or 'undated'}: {e.title}" for e in events]
        parts.append("TIMELINE:\n" + "\n".join(lines)[:9000])
    return "\n\n".join(parts)[:30000], sources


class QAView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        question = (request.data.get("question") or "").strip()
        if not question:
            return Response({"detail": "question required"}, status=status.HTTP_400_BAD_REQUEST)
        if not settings.OPENAI_API_KEY:
            return Response({"detail": "AI search is not configured."}, status=status.HTTP_503_SERVICE_UNAVAILABLE)
        context, _sources = build_qa_context(request.user, question[:MAX_QUESTION])
        result = ai_client.answer_health_question(question[:MAX_QUESTION], context)
        return Response(result.model_dump())
