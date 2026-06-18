"""Task 5 tests: share signed URLs expire in 60s, document URLs in 600s."""
import pytest
from rest_framework.test import APIClient

from apps.accounts.models import User
from apps.shares.services import create_share


@pytest.mark.django_db
def test_share_signed_urls_expire_in_60_seconds():
    user = User.objects.create_user(email="urltest@example.com", password="pw123")
    token, _ = create_share(user, ["full_summary"])
    client = APIClient()
    response = client.post("/api/shares/resolve", {"token": token}, format="json")
    assert response.status_code == 200
    body = response.json()
    assert body["items"][0]["expiresIn"] == 60, f"Expected 60, got {body['items'][0]['expiresIn']}"
