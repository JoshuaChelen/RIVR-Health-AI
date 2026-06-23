"""End-to-end auth flow tests."""
import pytest
from django.contrib.auth import get_user_model

from apps.accounts.tokens import make_email_verify_token, make_password_reset_tokens

User = get_user_model()

REGISTER = "/api/auth/register"
LOGIN = "/api/auth/login"
REFRESH = "/api/auth/token/refresh"
LOGOUT = "/api/auth/logout"
ME = "/api/auth/me"
VERIFY = "/api/auth/verify-email"
FORGOT = "/api/auth/password/forgot"
RESET = "/api/auth/password/reset"
CHANGE = "/api/auth/password/change"

PW = "Str0ngPass!23"
NEW_PW = "Even-Str0nger!45"


@pytest.fixture
def make_user(db):
    def _make(email="user@example.com", password=PW):
        return User.objects.create_user(email=email, password=password)

    return _make


def auth(client, access):
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {access}")


def login(api_client, email="user@example.com", password=PW):
    return api_client.post(LOGIN, {"email": email, "password": password}, format="json")


@pytest.mark.django_db
def test_register_creates_user_and_sends_verification(api_client, mailoutbox):
    resp = api_client.post(REGISTER, {"email": "new@example.com", "password": PW}, format="json")
    assert resp.status_code == 201
    body = resp.json()
    assert body["user"]["email"] == "new@example.com"
    assert body["user"]["is_email_verified"] is False
    assert body["access"] and body["refresh"]
    assert User.objects.filter(email="new@example.com").exists()
    assert len(mailoutbox) == 1
    assert "Verify" in mailoutbox[0].subject


@pytest.mark.django_db
def test_register_rejects_duplicate(api_client, make_user):
    make_user(email="dup@example.com")
    resp = api_client.post(REGISTER, {"email": "dup@example.com", "password": PW}, format="json")
    assert resp.status_code == 400


@pytest.mark.django_db
def test_register_after_soft_delete_reuses_email(api_client, make_user, mailoutbox):
    """A soft-deleted account's email can be re-registered (regression: this 500'd
    before the partial unique index — the active manager hid the deleted row from
    validation, but the old full unique constraint blocked the insert)."""
    u = make_user(email="redeleted@example.com")
    u.soft_delete(reason="test")
    resp = api_client.post(REGISTER, {"email": "redeleted@example.com", "password": PW}, format="json")
    assert resp.status_code == 201, resp.content
    assert resp.json()["user"]["email"] == "redeleted@example.com"
    # active + soft-deleted rows coexist under the partial unique constraint
    assert User.objects.filter(email="redeleted@example.com").count() == 1
    assert User.all_objects.filter(email="redeleted@example.com").count() == 2


@pytest.mark.django_db
def test_register_rejects_weak_password(api_client):
    resp = api_client.post(REGISTER, {"email": "weak@example.com", "password": "123"}, format="json")
    assert resp.status_code == 400


@pytest.mark.django_db
def test_login_returns_tokens_and_user(api_client, make_user):
    make_user()
    resp = login(api_client)
    assert resp.status_code == 200
    body = resp.json()
    assert body["access"] and body["refresh"]
    assert body["user"]["email"] == "user@example.com"


@pytest.mark.django_db
def test_login_wrong_password(api_client, make_user):
    make_user()
    resp = api_client.post(LOGIN, {"email": "user@example.com", "password": "nope"}, format="json")
    assert resp.status_code == 401


@pytest.mark.django_db
def test_me_requires_auth(api_client, make_user):
    make_user()
    assert api_client.get(ME).status_code == 401
    access = login(api_client).json()["access"]
    auth(api_client, access)
    resp = api_client.get(ME)
    assert resp.status_code == 200 and resp.json()["email"] == "user@example.com"


@pytest.mark.django_db
def test_token_refresh(api_client, make_user):
    make_user()
    refresh = login(api_client).json()["refresh"]
    resp = api_client.post(REFRESH, {"refresh": refresh}, format="json")
    assert resp.status_code == 200 and resp.json()["access"]


@pytest.mark.django_db
def test_logout_blacklists_refresh(api_client, make_user):
    make_user()
    tokens = login(api_client).json()
    auth(api_client, tokens["access"])
    assert api_client.post(LOGOUT, {"refresh": tokens["refresh"]}, format="json").status_code == 205
    api_client.credentials()  # clear
    # The blacklisted refresh can no longer be used.
    assert api_client.post(REFRESH, {"refresh": tokens["refresh"]}, format="json").status_code == 401


@pytest.mark.django_db
def test_verify_email(api_client, make_user):
    user = make_user()
    token = make_email_verify_token(user)
    resp = api_client.post(VERIFY, {"token": token}, format="json")
    assert resp.status_code == 200
    user.refresh_from_db()
    assert user.is_email_verified is True


@pytest.mark.django_db
def test_verify_email_invalid(api_client):
    assert api_client.post(VERIFY, {"token": "garbage"}, format="json").status_code == 400


@pytest.mark.django_db
def test_password_forgot_existing_vs_unknown(api_client, make_user, mailoutbox):
    make_user(email="known@example.com")
    assert api_client.post(FORGOT, {"email": "known@example.com"}, format="json").status_code == 200
    assert len(mailoutbox) == 1
    # Unknown email: still 200 (no enumeration), no email sent.
    assert api_client.post(FORGOT, {"email": "ghost@example.com"}, format="json").status_code == 200
    assert len(mailoutbox) == 1


@pytest.mark.django_db
def test_password_reset_flow(api_client, make_user):
    user = make_user()
    uid, token = make_password_reset_tokens(user)
    resp = api_client.post(RESET, {"uid": uid, "token": token, "password": NEW_PW}, format="json")
    assert resp.status_code == 200
    assert login(api_client, password=NEW_PW).status_code == 200
    assert login(api_client, password=PW).status_code == 401


@pytest.mark.django_db
def test_password_reset_invalid_token(api_client, make_user):
    user = make_user()
    uid, _ = make_password_reset_tokens(user)
    resp = api_client.post(RESET, {"uid": uid, "token": "bad-token", "password": NEW_PW}, format="json")
    assert resp.status_code == 400


@pytest.mark.django_db
def test_password_change(api_client, make_user):
    make_user()
    access = login(api_client).json()["access"]
    auth(api_client, access)
    assert api_client.post(CHANGE, {"current_password": PW, "new_password": NEW_PW}, format="json").status_code == 200
    api_client.credentials()
    assert login(api_client, password=NEW_PW).status_code == 200


@pytest.mark.django_db
def test_password_change_wrong_current(api_client, make_user):
    make_user()
    access = login(api_client).json()["access"]
    auth(api_client, access)
    resp = api_client.post(CHANGE, {"current_password": "wrong", "new_password": NEW_PW}, format="json")
    assert resp.status_code == 400
