import json

from django.conf import settings
from django.core.files.storage import default_storage
from rest_framework import status
from rest_framework.permissions import IsAuthenticated

from apps.common.permissions import IsEmailVerified
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.common.throttles import QAThrottle
from apps.documents.models import Document
from apps.jobs import ai_client, index, profile_logic
from apps.profiles.models import UserProfile
from apps.timeline.models import TimelineEvent

from .models import HealthProfile

MAX_QUESTION = 500
MAX_HISTORY_TURNS = 8


def _suppression(user):
    """(suppressed-keys dict, flat set of all suppressed normalized keys) for a user.

    Keeps items the user has rejected out of the QA context / retrieval results.
    """
    prof = UserProfile.objects.filter(user=user).first()
    if prof is None:
        empty = {"allergies": set(), "medications": set(), "conditions": set(), "surgeries": set()}
        return empty, set()
    pdict = {
        "allergies": prof.allergies, "medications": prof.medications,
        "medical_history": prof.medical_history, "surgical_history": prof.surgical_history,
        "ai_backfill_meta": prof.ai_backfill_meta,
    }
    sup = profile_logic.compute_suppressed_keys(pdict)
    flat = set().union(*sup.values())
    return sup, flat


# Phrases that signal an attempt to override the assistant's instructions. A turn
# is dropped only when it carries 2+ of these, so ordinary medical language (a lone
# "ignore", "rules", etc.) is never discarded. Stored in normalized form (alnum +
# single spaces) so they match the bypass-resistant normalized content.
_HISTORY_INJECTION_KEYWORDS = (
    "ignore previous", "ignore all", "ignore safety", "disregard previous",
    "disregard all", "override", "new instructions", "new rules", "new prompt",
    "previous instructions", "forget previous", "forget everything",
    "stop following", "do not follow", "dont follow", "system prompt",
    "you are now", "act as", "jailbreak",
)


def _has_history_injection(content: str) -> bool:
    # Normalize first so "ignore/previous", "ignore  previous", soft-hyphen, and
    # zero-width separators can't slip a phrase past substring matching.
    from apps.jobs.output_validator import normalize_for_phrase_match

    norm = " " + normalize_for_phrase_match(content) + " "
    return sum(1 for kw in _HISTORY_INJECTION_KEYWORDS if f" {kw} " in norm) >= 2


def _sanitize_history(raw) -> list[dict]:
    """Keep only well-formed user/assistant turns; cap count/length and drop turns
    that look like prompt-injection priming (2+ override phrases)."""
    out: list[dict] = []
    if isinstance(raw, list):
        for turn in raw[-MAX_HISTORY_TURNS:]:
            if not isinstance(turn, dict):
                continue
            role = turn.get("role")
            content = turn.get("content")
            if role in ("user", "assistant") and isinstance(content, str) and content.strip():
                if _has_history_injection(content):
                    continue  # attacker-controlled history priming — drop silently
                out.append({"role": role, "content": content.strip()[:4000]})
    return out


def _static_qa_context(user) -> str:
    parts: list[str] = []
    hp = HealthProfile.objects.filter(user=user).first()
    if hp:
        summary = (hp.summary_json or {}).get("full_summary_markdown") or ""
        parts.append(f"HEALTH_SUMMARY (score {hp.score} {hp.score_label}):\n{summary[:8000]}")
    suppressed, _flat = _suppression(user)
    docs = Document.objects.filter(
        user=user, status=Document.Status.PROCESSED, summary_path__gt="",
        detached_at__isnull=True,
    ).exclude(source_type=Document.SourceType.MANUAL_INPUT)[:12]
    for doc in docs:
        try:
            with default_storage.open(doc.summary_path) as fh:
                facts = json.loads(fh.read())
            # Drop facts the user has rejected so they can't be cited in answers.
            facts = profile_logic.filter_doc_facts_by_suppression([facts], suppressed)[0]
            parts.append(f"DOCUMENT [{doc.title}]: {json.dumps(facts.get('key_facts', {}))[:1500]}")
        except Exception:
            continue
    events = TimelineEvent.objects.filter(user=user).exclude(source="apple_health").order_by("-occurred_at")[:80]
    if events:
        lines = [f"- {e.occurred_at or 'undated'}: {e.title}" for e in events]
        parts.append("TIMELINE:\n" + "\n".join(lines)[:9000])
    return "\n\n".join(parts)[:30000]


def build_qa_context(user, question: str, prior_question: str = ""):
    """Return (context_str, sources). Retrieval-based; falls back to the static slice on any error.

    `prior_question` (the previous user turn) is folded into the retrieval query
    so follow-ups like "is it getting worse?" still pull the right records.
    """
    retrieval_query = (f"{prior_question} {question}".strip() if prior_question else question)[:1000]
    try:
        hits = index.search(user, retrieval_query, k=12)
    except Exception:
        return _static_qa_context(user), []

    parts: list[str] = []
    sources: list[dict] = []
    hp = HealthProfile.objects.filter(user=user).first()
    if hp:
        summary = (hp.summary_json or {}).get("full_summary_markdown") or ""
        if summary:
            parts.append(f"HEALTH_SUMMARY (score {hp.score} {hp.score_label}):\n{summary[:8000]}")
    _suppressed, flat = _suppression(user)
    for h in hits:
        content_norm = profile_logic.norm(h.content or "")
        if any(k and k in content_norm for k in flat):
            continue  # rejected item — don't let it be retrieved/cited
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
    permission_classes = [IsAuthenticated, IsEmailVerified]
    throttle_classes = [QAThrottle]

    def post(self, request):
        question = (request.data.get("question") or "").strip()
        if not question:
            return Response({"detail": "question required"}, status=status.HTTP_400_BAD_REQUEST)
        if len(question) > MAX_QUESTION:
            return Response(
                {"detail": f"Question too long (max {MAX_QUESTION} characters)."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if not settings.OPENAI_API_KEY:
            return Response({"detail": "AI search is not configured."}, status=status.HTTP_503_SERVICE_UNAVAILABLE)
        history = _sanitize_history(request.data.get("history"))
        prior_question = next(
            (t["content"] for t in reversed(history) if t["role"] == "user"), ""
        )
        context, _sources = build_qa_context(request.user, question, prior_question)
        result = ai_client.answer_health_question(
            question, context, history=history
        )
        return Response(result.model_dump())
