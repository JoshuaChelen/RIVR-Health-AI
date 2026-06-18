"""Embedding interface (OpenAI-compatible) + text chunking for the Q&A index."""
from django.conf import settings

EMBEDDING_DIM = 768


def chunk_text(text, *, target_chars: int = 2400, overlap_chars: int = 300) -> list[str]:
    """Split text into overlapping ~600-token windows on whitespace boundaries."""
    text = (text or "").strip()
    if not text:
        return []
    if len(text) <= target_chars:
        return [text]
    chunks: list[str] = []
    start = 0
    n = len(text)
    while start < n:
        end = min(start + target_chars, n)
        if end < n:
            sp = text.rfind(" ", start, end)
            if sp > start:
                end = sp
        piece = text[start:end].strip()
        if piece:
            chunks.append(piece)
        if end >= n:
            break
        start = max(end - overlap_chars, start + 1)
    return chunks


def embed(texts: list[str], *, query: bool = False) -> list[list[float]]:
    """Embed texts via the configured OpenAI-compatible endpoint. nomic task prefixes applied."""
    if not texts:
        return []
    from openai import OpenAI

    from .error_sanitizer import sanitize_error_message

    prefix = "search_query: " if query else "search_document: "
    try:
        client = OpenAI(api_key=settings.EMBEDDING_API_KEY, base_url=settings.EMBEDDING_BASE_URL)
        resp = client.embeddings.create(model=settings.EMBEDDING_MODEL, input=[prefix + t for t in texts])
        return [d.embedding for d in sorted(resp.data, key=lambda d: d.index)]
    except Exception as exc:  # strip any leaked api key/credential before it propagates
        raise RuntimeError(sanitize_error_message(str(exc))) from None
