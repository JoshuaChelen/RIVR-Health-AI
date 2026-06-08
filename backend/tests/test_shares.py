"""Share-link security tests (token, expiry, view-limit, PIN lockout, ownership)."""
from datetime import timedelta
from urllib.parse import parse_qs, urlparse

import pytest
from django.contrib.auth import get_user_model
from django.core.files.storage import default_storage
from django.utils import timezone

from apps.shares.models import SharePackage
from apps.shares.services import cleanup_expired_artifacts, create_share, resolve_share

User = get_user_model()


@pytest.fixture
def user(db):
    return User.objects.create_user(email="a@example.com", password="pw")


@pytest.fixture
def client(api_client, user):
    api_client.force_authenticate(user=user)
    return api_client


def _token(url):
    return parse_qs(urlparse(url).query)["token"][0]


def test_create_share_returns_url_and_stores_pdfs(client, user):
    resp = client.post("/api/shares", {"shareTypes": ["card_3x5", "full_summary"]}, format="json")
    assert resp.status_code == 201
    assert "token=" in resp.json()["shareUrl"]
    pkg = SharePackage.objects.get(owner=user)
    assert len(pkg.payload_json["pdfs"]) == 2
    for key in pkg.payload_json["pdfs"].values():
        assert default_storage.exists(key)
    assert pkg.token_hash and len(pkg.token_hash) == 64  # only the hash is stored


def test_resolve_valid_returns_signed_items(client, api_client):
    url = client.post("/api/shares", {"shareTypes": ["card_3x5"]}, format="json").json()["shareUrl"]
    api_client.force_authenticate(user=None)  # public
    resp = api_client.post("/api/shares/resolve", {"token": _token(url)}, format="json")
    assert resp.status_code == 200
    body = resp.json()
    assert body["pinRequired"] is False and len(body["items"]) == 1 and body["items"][0]["signedUrl"]


def test_resolve_expired(user):
    token, pkg = create_share(user, ["card_3x5"])
    SharePackage.objects.filter(pk=pkg.pk).update(expires_at=timezone.now() - timedelta(minutes=5))
    assert resolve_share(token)["status"] == 410


def test_resolve_view_limit(user, settings):
    settings.SHARE_MAX_VIEWS = 1
    token, _ = create_share(user, ["card_3x5"])
    assert "items" in resolve_share(token)       # 1st view ok
    assert resolve_share(token)["status"] == 410  # 2nd over limit


def test_resolve_pin_flow(user):
    token, _ = create_share(user, ["card_3x5"], pin="1234")
    assert resolve_share(token)["pinRequired"] is True            # missing pin
    wrong = resolve_share(token, pin="0000")
    assert wrong["status"] == 401 and wrong["error"] == "Wrong PIN"
    assert resolve_share(token, pin="1234")["pinRequired"] is False  # correct pin


def test_resolve_pin_lockout(user, settings):
    settings.SHARE_MAX_PIN_ATTEMPTS = 2
    token, _ = create_share(user, ["card_3x5"], pin="1234")
    resolve_share(token, pin="x")
    resolve_share(token, pin="y")
    locked = resolve_share(token, pin="1234")  # correct, but locked out
    assert locked["status"] == 429


def test_resolve_revoked_and_unknown(user):
    token, pkg = create_share(user, ["card_3x5"])
    SharePackage.objects.filter(pk=pkg.pk).update(revoked=True)
    assert resolve_share(token)["status"] == 404
    assert resolve_share("not-a-real-token")["status"] == 404


def test_create_requires_auth(api_client):
    assert api_client.post("/api/shares", {}, format="json").status_code == 401


def test_cleanup_expired_artifacts(user):
    token, pkg = create_share(user, ["card_3x5"])
    keys = list(pkg.payload_json["pdfs"].values())
    SharePackage.objects.filter(pk=pkg.pk).update(expires_at=timezone.now() - timedelta(minutes=5))
    assert cleanup_expired_artifacts() == 1
    pkg.refresh_from_db()
    assert pkg.artifacts_deleted_at is not None
    assert not default_storage.exists(keys[0])
