"""Minimal branded PDF builders for shared health artifacts (reportlab)."""
import io

from apps.health.models import HealthProfile
from apps.profiles.models import UserProfile

TITLES = {
    "full_summary": "RIVR Health Summary",
    "card_3x5": "RIVR Emergency Card",
    "pre_visit_note": "RIVR Pre-Visit Note",
    "full_timeline": "RIVR Health Timeline",
}


def _lines_for(share_type: str, user_id) -> list[str]:
    hp = HealthProfile.objects.filter(user_id=user_id).first()
    profile = UserProfile.objects.filter(user_id=user_id).first()
    card = (hp.card_json if hp else {}) or {}
    summary = (hp.summary_json if hp else {}) or {}
    lines: list[str] = []
    if share_type == "card_3x5":
        lines.append(f"Blood type: {card.get('blood_type') or 'Unknown'}")
        lines.append("Allergies: " + (", ".join(card.get("allergies", [])) or "None listed"))
        lines.append("Medications: " + (", ".join(card.get("current_meds", [])) or "None listed"))
        lines.append("Conditions: " + (", ".join(card.get("major_conditions", [])) or "None listed"))
        ec = card.get("emergency_contact") or {}
        lines.append(f"Emergency contact: {ec.get('name') or '-'} {ec.get('phone') or ''}".strip())
        if card.get("one_line_summary"):
            lines.append("")
            lines.append(card["one_line_summary"])
    elif share_type == "full_summary":
        if hp:
            lines.append(f"Health score: {hp.score} ({hp.score_label})")
        lines.append("")
        for para in (summary.get("full_summary_markdown") or "No summary available.").split("\n"):
            lines.append(para)
    elif share_type == "pre_visit_note":
        from apps.timeline.models import TimelineEvent

        lines.append("Events selected for this visit:")
        for ev in TimelineEvent.objects.filter(user_id=user_id, included_in_previsit=True).order_by("-occurred_at")[:50]:
            lines.append(f"- {ev.occurred_at or 'Undated'}: {ev.title}")
    elif share_type == "full_timeline":
        from apps.timeline.models import TimelineEvent

        for ev in TimelineEvent.objects.filter(user_id=user_id).exclude(source="apple_health").order_by("-occurred_at")[:200]:
            lines.append(f"- {ev.occurred_at or 'Undated'}: {ev.title}")
    name = f"{profile.first_name} {profile.last_name}".strip() if profile else ""
    header = [TITLES.get(share_type, "RIVR"), name, ""] if name else [TITLES.get(share_type, "RIVR"), ""]
    return header + lines


def build_pdf(share_type: str, user_id) -> bytes:
    from reportlab.lib.pagesizes import letter
    from reportlab.lib.units import inch
    from reportlab.pdfgen import canvas

    buf = io.BytesIO()
    c = canvas.Canvas(buf, pagesize=letter)
    width, height = letter
    y = height - inch
    for i, line in enumerate(_lines_for(share_type, user_id)):
        c.setFont("Helvetica-Bold" if i == 0 else "Helvetica", 16 if i == 0 else 11)
        for chunk in [line[j:j + 95] for j in range(0, max(len(line), 1), 95)]:
            if y < inch:
                c.showPage()
                y = height - inch
            c.drawString(inch, y, chunk)
            y -= 18
    c.showPage()
    c.save()
    return buf.getvalue()
