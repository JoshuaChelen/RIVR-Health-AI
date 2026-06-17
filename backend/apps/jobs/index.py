"""Build + query the per-user pgvector Q&A index."""
import json

from django.core.files.storage import default_storage
from django.db.models import Q
from pgvector.django import CosineDistance

from . import embeddings
from .models import Embedding


def _fact_lines(key_facts: dict) -> list[str]:
    out: list[str] = []
    if key_facts.get("blood_type"):
        out.append(f"Blood type: {key_facts['blood_type']}")
    for a in key_facts.get("allergies", []) or []:
        sub = a.get("substance") or a.get("allergen")
        if sub:
            out.append(f"Allergy: {sub}" + (f" ({a['severity']})" if a.get("severity") else ""))
    for m in key_facts.get("medications", []) or []:
        if m.get("name"):
            out.append("Medication: " + " ".join(p for p in [m.get("name"), m.get("dose"), m.get("frequency")] if p))
    for c in key_facts.get("conditions", []) or []:
        if c.get("name"):
            out.append(f"Condition: {c['name']}")
    for s in key_facts.get("surgeries_procedures", []) or []:
        if s.get("name"):
            out.append(f"Surgery/procedure: {s['name']}" + (f" ({s['when']})" if s.get("when") else ""))
    for lv in key_facts.get("key_labs_vitals", []) or []:
        if lv.get("name"):
            out.append("Lab/vital: " + " ".join(p for p in [lv.get("name"), lv.get("value"), lv.get("when")] if p))
    for d in key_facts.get("implants_devices", []) or []:
        if d:
            out.append(f"Implant/device: {d}")
    return out


def reindex_document(doc, *, text: str | None = None) -> None:
    """Replace `doc`'s embeddings with fresh doc-chunk (if text given) + fact rows."""
    key_facts = {}
    if doc.summary_path:
        try:
            with default_storage.open(doc.summary_path) as fh:
                key_facts = (json.loads(fh.read()) or {}).get("key_facts", {}) or {}
        except Exception:
            key_facts = {}

    items: list[tuple[str, str]] = []  # (kind, content)
    if text:
        for chunk in embeddings.chunk_text(text):
            items.append(("doc_chunk", chunk))
    for line in _fact_lines(key_facts):
        items.append(("fact", line))

    Embedding.objects.filter(document=doc).delete()
    if not items:
        return
    vectors = embeddings.embed([c for _, c in items])
    rows = [Embedding(user=doc.user, document=doc, kind=kind, content=content, vector=vec)
            for (kind, content), vec in zip(items, vectors)]
    Embedding.objects.bulk_create(rows)


def search(user, query: str, k: int = 12) -> list[Embedding]:
    """Top-k user-scoped embeddings nearest the query (cosine)."""
    qvec = embeddings.embed([query], query=True)
    if not qvec:
        return []
    # Exclude embeddings tied to a detached document (its results were removed by
    # the user); keep document-less rows (e.g. timeline) and active-document rows.
    return list(
        Embedding.objects.filter(user=user)
        .select_related("document")  # avoid N+1 when callers read hit.document.title
        .filter(Q(document__isnull=True) | Q(document__detached_at__isnull=True))
        .order_by(CosineDistance("vector", qvec[0]))[:k]
    )
