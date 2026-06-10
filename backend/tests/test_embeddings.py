from apps.jobs import embeddings


def test_chunk_text_short_returns_single():
    assert embeddings.chunk_text("short text") == ["short text"]


def test_chunk_text_empty_returns_empty():
    assert embeddings.chunk_text("") == []
    assert embeddings.chunk_text(None) == []


def test_chunk_text_long_splits_with_overlap():
    text = " ".join(f"word{i}" for i in range(2000))  # well over target
    chunks = embeddings.chunk_text(text, target_chars=2400, overlap_chars=300)
    assert len(chunks) >= 2
    assert all(len(c) <= 2400 for c in chunks)


class _FakeEmb:
    def __init__(self, vec, index):
        self.embedding = vec
        self.index = index


class _FakeResp:
    def __init__(self, vecs):
        self.data = [_FakeEmb(v, i) for i, v in enumerate(vecs)]


def test_embed_applies_prefix_and_returns_vectors(monkeypatch):
    captured = {}

    class _Embeddings:
        def create(self, **kw):
            captured.update(kw)
            return _FakeResp([[0.1] * 768 for _ in kw["input"]])

    class _Client:
        embeddings = _Embeddings()

    import openai
    monkeypatch.setattr(openai, "OpenAI", lambda **kw: _Client())
    out = embeddings.embed(["a", "b"], query=False)
    assert len(out) == 2 and len(out[0]) == 768
    assert captured["input"] == ["search_document: a", "search_document: b"]
    embeddings.embed(["q"], query=True)
    assert captured["input"] == ["search_query: q"]


def test_embed_sorts_by_response_index(monkeypatch):
    class _Embeddings:
        def create(self, **kw):
            class _R: pass
            r = _R()
            r.data = [_FakeEmb([0.1] * 768, 1), _FakeEmb([0.2] * 768, 0)]  # returned out of order
            return r

    class _Client:
        embeddings = _Embeddings()

    import openai
    monkeypatch.setattr(openai, "OpenAI", lambda **kw: _Client())
    out = embeddings.embed(["x", "y"])
    assert out == [[0.2] * 768, [0.1] * 768]  # reordered to index 0, then 1


def test_embed_empty_returns_empty():
    assert embeddings.embed([]) == []
