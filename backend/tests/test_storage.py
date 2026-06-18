"""File upload / storage / account-deletion tests (in-memory storage)."""
import io

import pytest
from django.contrib.auth import get_user_model
from django.core.files.storage import default_storage
from django.core.files.uploadedfile import SimpleUploadedFile
from django.utils import timezone
from PIL import Image

from apps.documents.models import Document

User = get_user_model()
PW = "Str0ngPass!23"


@pytest.fixture
def user(db):
    return User.objects.create_user(email="a@example.com", password=PW, email_verified_at=timezone.now())


@pytest.fixture
def client(api_client, user):
    api_client.force_authenticate(user=user)
    return api_client


def png(name="x.png", size=(100, 120)):
    buf = io.BytesIO()
    Image.new("RGB", size, "red").save(buf, format="PNG")
    buf.seek(0)
    return SimpleUploadedFile(name, buf.read(), content_type="image/png")


def test_document_upload_stores_file_and_row(client, user):
    resp = client.post(
        "/api/documents/upload/",
        {"file": png("scan.png"), "title": "Scan", "source_type": "image"},
        format="multipart",
    )
    assert resp.status_code == 201
    doc = Document.objects.get(id=resp.json()["id"])
    assert doc.user_id == user.id
    assert doc.pdf_path.startswith(f"documents/{user.id}/medical-images/")
    assert doc.size_bytes > 0 and len(doc.sha256) == 64
    assert default_storage.exists(doc.pdf_path)


def test_document_upload_requires_file(client):
    assert client.post("/api/documents/upload/", {}, format="multipart").status_code == 400


def test_document_delete_removes_file(client):
    doc_id = client.post(
        "/api/documents/upload/", {"file": png(), "source_type": "image"}, format="multipart"
    ).json()["id"]
    key = Document.objects.get(id=doc_id).pdf_path
    assert default_storage.exists(key)
    assert client.delete(f"/api/documents/{doc_id}/").status_code == 204
    assert not Document.objects.filter(id=doc_id).exists()
    assert not default_storage.exists(key)


def test_document_file_url(client):
    doc_id = client.post(
        "/api/documents/upload/", {"file": png(), "source_type": "image"}, format="multipart"
    ).json()["id"]
    resp = client.get(f"/api/documents/{doc_id}/file/")
    assert resp.status_code == 200 and resp.json()["url"]


def test_avatar_upload_is_processed_512_jpeg(client, user):
    resp = client.post("/api/profile/avatar", {"image": png(size=(800, 600))}, format="multipart")
    assert resp.status_code == 201
    key = resp.json()["avatar_path"]
    assert key == f"avatars/{user.id}/avatar.jpg"
    with default_storage.open(key) as fh:
        img = Image.open(fh)
        assert img.size == (512, 512)
        assert img.format == "JPEG"


def test_account_delete_removes_user_and_files(client, user):
    client.post("/api/documents/upload/", {"file": png(), "source_type": "image"}, format="multipart")
    client.post("/api/profile/avatar", {"image": png()}, format="multipart")
    assert Document.objects.filter(user=user).count() == 1
    assert client.delete("/api/account").status_code == 204
    assert not User.objects.filter(id=user.id).exists()
    assert Document.objects.filter(user_id=user.id).count() == 0
