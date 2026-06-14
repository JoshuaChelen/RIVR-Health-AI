"""Object-storage helpers (S3/MinIO in prod, in-memory in tests).

Single bucket, prefixed by domain:
    documents/{user_id}/{kind}/{uuid}_{name}
    avatars/{user_id}/avatar.jpg
    share-artifacts/{uuid}/{file_type}.pdf
"""
import hashlib
import io
import uuid

from django.conf import settings
from django.core.files.base import ContentFile
from django.core.files.storage import default_storage
from PIL import Image


def document_kind(content_type: str | None, source_type: str | None) -> str:
    ct = (content_type or "").lower()
    if source_type == "voice_note" or ct.startswith("audio"):
        return "voice-notes"
    if source_type == "image" or ct.startswith("image"):
        return "medical-images"
    return "medical-documents"


def document_key(user_id, filename: str, kind: str) -> str:
    safe = filename.replace("/", "_")
    return f"documents/{user_id}/{kind}/{uuid.uuid4().hex}_{safe}"


def avatar_key(user_id) -> str:
    return f"avatars/{user_id}/avatar.jpg"


def sha256_of(file_obj) -> str:
    file_obj.seek(0)
    digest = hashlib.sha256(file_obj.read()).hexdigest()
    file_obj.seek(0)
    return digest


def save(key: str, file_obj) -> str:
    return default_storage.save(key, file_obj)


def signed_url(key: str, expire: int = 600) -> str | None:
    if not key:
        return None
    try:
        url = default_storage.url(key, expire=expire)
    except TypeError:
        url = default_storage.url(key)
    # Local dev: signed URLs point at the internal MinIO host (minio:9000),
    # which devices/simulators can't reach. Rewrite to the public endpoint.
    internal = getattr(settings, "AWS_S3_ENDPOINT_URL", "") or ""
    public = getattr(settings, "AWS_S3_PUBLIC_ENDPOINT_URL", "") or ""
    if url and internal and public and url.startswith(internal):
        url = public + url[len(internal):]
    return url


def delete(key: str) -> None:
    if key and default_storage.exists(key):
        default_storage.delete(key)


def delete_prefix(prefix: str) -> None:
    """Recursively delete everything under a prefix (best-effort)."""
    try:
        dirs, files = default_storage.listdir(prefix)
    except (NotImplementedError, FileNotFoundError):
        return
    for name in files:
        delete(f"{prefix}/{name}")
    for name in dirs:
        delete_prefix(f"{prefix}/{name}")


def process_avatar(uploaded_file) -> ContentFile:
    """Center-crop to a 512x512 JPEG and strip metadata (re-encode)."""
    image = Image.open(uploaded_file).convert("RGB")
    width, height = image.size
    side = min(width, height)
    left = (width - side) // 2
    top = (height - side) // 2
    image = image.crop((left, top, left + side, top + side)).resize((512, 512))
    buffer = io.BytesIO()
    image.save(buffer, format="JPEG", quality=85)
    buffer.seek(0)
    return ContentFile(buffer.read(), name="avatar.jpg")
