"""Phase 2 security hardening tests."""
import pytest
from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.test import override_settings
from django.utils import timezone

User = get_user_model()

REGISTER = "/api/auth/register"
LOGIN = "/api/auth/login"
REFRESH = "/api/auth/token/refresh"
LOGOUT = "/api/auth/logout"
ME = "/api/auth/me"
RESET = "/api/auth/password/reset"
FORGOT = "/api/auth/password/forgot"

PW = "Str0ngPass!23"
NEW_PW = "Even-Str0nger!45"


def auth(client, access):
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {access}")


def login(api_client, email="sec@example.com", password=PW):
    return api_client.post(LOGIN, {"email": email, "password": password}, format="json")


@pytest.fixture(autouse=True)
def clear_cache():
    """Flush the cache before each test so lockout/denylist state doesn't bleed."""
    cache.clear()
    yield
    cache.clear()


@pytest.fixture
def make_user(db):
    def _make(email="sec@example.com", password=PW):
        return User.objects.create_user(email=email, password=password)
    return _make


# ── Task 8+config: TOKEN TIMEOUTS ────────────────────────────────────────────

class TestTokenTimeouts:
    def test_email_verify_max_age_is_one_day(self):
        from apps.accounts.tokens import EMAIL_VERIFY_MAX_AGE
        assert EMAIL_VERIFY_MAX_AGE == 60 * 60 * 24  # 1 day, not 7

    def test_password_reset_timeout_setting_is_one_hour(self):
        from django.conf import settings
        assert settings.PASSWORD_RESET_TIMEOUT == 3600  # 1 hour


# ── Task 2: SINGLE-USE PASSWORD RESET TOKENS ─────────────────────────────────

@pytest.mark.django_db
class TestSingleUsePasswordReset:
    def test_reset_token_rejected_on_second_use(self, make_user, api_client):
        user = make_user()
        from apps.accounts.tokens import make_password_reset_tokens
        uid, token = make_password_reset_tokens(user)

        # First use succeeds.
        resp = api_client.post(RESET, {"uid": uid, "token": token, "password": NEW_PW}, format="json")
        assert resp.status_code == 200

        # Second use with the same token must fail.
        resp2 = api_client.post(RESET, {"uid": uid, "token": token, "password": "AnotherPass!99"}, format="json")
        assert resp2.status_code == 400

    def test_password_reset_token_used_at_set_after_reset(self, make_user, api_client):
        user = make_user()
        from apps.accounts.tokens import make_password_reset_tokens
        uid, token = make_password_reset_tokens(user)

        assert user.password_reset_token_used_at is None
        api_client.post(RESET, {"uid": uid, "token": token, "password": NEW_PW}, format="json")
        user.refresh_from_db()
        assert user.password_reset_token_used_at is not None

    def test_read_password_reset_returns_none_if_token_used(self, make_user):
        user = make_user()
        from apps.accounts.tokens import make_password_reset_tokens, read_password_reset
        uid, token = make_password_reset_tokens(user)

        # Mark as used.
        user.password_reset_token_used_at = timezone.now()
        user.save(update_fields=["password_reset_token_used_at"])

        assert read_password_reset(uid, token) is None

    def test_concurrent_reset_second_request_rejected(self, make_user, api_client):
        """TOCTOU: two requests pass the read check, but only one can claim the token.

        Simulates the race by having a competing request claim the token (atomic
        UPDATE) after `read_password_reset` returns a valid user but before the
        view's own claim. The view's claim must then fail → 400, and the second
        request must NOT have changed the password.
        """
        user = make_user(email="toctou@example.com")
        from apps.accounts.tokens import make_password_reset_tokens
        uid, token = make_password_reset_tokens(user)

        from unittest.mock import patch
        import apps.accounts.views as views_mod

        real_read = views_mod.read_password_reset

        def racing_read(u, t):
            result = real_read(u, t)
            if result is not None:
                # A concurrent request wins the claim first.
                User.objects.filter(
                    pk=result.pk, password_reset_token_used_at__isnull=True
                ).update(password_reset_token_used_at=timezone.now())
            return result

        with patch.object(views_mod, "read_password_reset", side_effect=racing_read):
            resp = api_client.post(
                RESET, {"uid": uid, "token": token, "password": NEW_PW}, format="json"
            )
        assert resp.status_code == 400  # lost the race → token already claimed

        # The losing request must not have set the new password.
        user.refresh_from_db()
        assert not user.check_password(NEW_PW)


# ── Task 4: LOGIN LOCKOUT ─────────────────────────────────────────────────────

@pytest.mark.django_db
class TestLoginLockout:
    IP = "203.0.113.10"  # consistent client IP so the email+IP lockout key is stable

    def test_lockout_after_five_failures(self, make_user, api_client):
        make_user(email="lockout@example.com")
        # 5 wrong-password attempts.
        for _ in range(5):
            r = api_client.post(LOGIN, {"email": "lockout@example.com", "password": "wrong"}, format="json", REMOTE_ADDR=self.IP)
            assert r.status_code == 401

        # 6th attempt must be locked out.
        r = api_client.post(LOGIN, {"email": "lockout@example.com", "password": "wrong"}, format="json", REMOTE_ADDR=self.IP)
        assert r.status_code == 423

    def test_lockout_blocks_correct_password_too(self, make_user, api_client):
        make_user(email="lockout2@example.com")
        for _ in range(5):
            api_client.post(LOGIN, {"email": "lockout2@example.com", "password": "wrong"}, format="json", REMOTE_ADDR=self.IP)

        # Even the correct password is blocked while locked out.
        r = api_client.post(LOGIN, {"email": "lockout2@example.com", "password": PW}, format="json", REMOTE_ADDR=self.IP)
        assert r.status_code == 423

    def test_lockout_clears_on_success(self, make_user, api_client):
        make_user(email="lockout3@example.com")
        # 4 failures (not yet locked).
        for _ in range(4):
            api_client.post(LOGIN, {"email": "lockout3@example.com", "password": "wrong"}, format="json", REMOTE_ADDR=self.IP)

        # Correct password clears the failure counter.
        r = api_client.post(LOGIN, {"email": "lockout3@example.com", "password": PW}, format="json", REMOTE_ADDR=self.IP)
        assert r.status_code == 200

        # Counter is reset — subsequent wrong attempts restart the window.
        r2 = api_client.post(LOGIN, {"email": "lockout3@example.com", "password": "wrong"}, format="json", REMOTE_ADDR=self.IP)
        assert r2.status_code == 401  # not 423

    def test_lockout_is_per_email(self, make_user, api_client):
        make_user(email="lockout4a@example.com")
        make_user(email="lockout4b@example.com")
        # Exhaust lockout for lockout4a.
        for _ in range(5):
            api_client.post(LOGIN, {"email": "lockout4a@example.com", "password": "wrong"}, format="json", REMOTE_ADDR=self.IP)

        # lockout4b should still be able to log in.
        r = api_client.post(LOGIN, {"email": "lockout4b@example.com", "password": PW}, format="json", REMOTE_ADDR=self.IP)
        assert r.status_code == 200

    def test_lockout_is_per_ip_no_victim_dos(self, make_user, api_client):
        """An attacker locking an email from their IP must NOT lock the victim's own IP."""
        make_user(email="victim@example.com")
        attacker_ip = "198.51.100.5"
        victim_ip = "203.0.113.99"

        # Attacker exhausts the lockout for the victim's email from the attacker IP.
        for _ in range(5):
            api_client.post(LOGIN, {"email": "victim@example.com", "password": "wrong"}, format="json", REMOTE_ADDR=attacker_ip)
        r_attacker = api_client.post(LOGIN, {"email": "victim@example.com", "password": "wrong"}, format="json", REMOTE_ADDR=attacker_ip)
        assert r_attacker.status_code == 423  # attacker's IP is locked

        # The victim, from their own IP, can still log in with correct credentials.
        r_victim = api_client.post(LOGIN, {"email": "victim@example.com", "password": PW}, format="json", REMOTE_ADDR=victim_ip)
        assert r_victim.status_code == 200

    def test_lockout_uses_x_forwarded_for(self, make_user, api_client):
        """Behind Caddy (trusted proxy), the lockout key uses the XFF client IP.

        Caddy appends the real client as the RIGHTMOST XFF entry, so the
        client IP is the last one. The leftmost entry is attacker-supplied.
        """
        make_user(email="xff@example.com")
        # Same REMOTE_ADDR (the proxy), but different real client IPs (rightmost).
        with override_settings(TRUSTED_PROXIES=["10.0.0.1"]):
            for _ in range(5):
                api_client.post(
                    LOGIN, {"email": "xff@example.com", "password": "wrong"}, format="json",
                    REMOTE_ADDR="10.0.0.1", HTTP_X_FORWARDED_FOR="1.1.1.1, 198.51.100.7",
                )
            # Locked for the real (rightmost) client 198.51.100.7.
            r_locked = api_client.post(
                LOGIN, {"email": "xff@example.com", "password": "wrong"}, format="json",
                REMOTE_ADDR="10.0.0.1", HTTP_X_FORWARDED_FOR="1.1.1.1, 198.51.100.7",
            )
            assert r_locked.status_code == 423
            # A different real client through the same proxy is NOT locked,
            # even if it forges the same leftmost entry as the locked client.
            r_other = api_client.post(
                LOGIN, {"email": "xff@example.com", "password": PW}, format="json",
                REMOTE_ADDR="10.0.0.1", HTTP_X_FORWARDED_FOR="1.1.1.1, 198.51.100.250",
            )
            assert r_other.status_code == 200


# ── Task 5: CONSTANT-TIME VERIFY ─────────────────────────────────────────────

class TestConstantTimeVerify:
    def test_invalid_token_returns_same_message_as_missing_user(self, api_client):
        """Both paths return the same 400 detail — no enumeration leak in body."""
        resp = api_client.post("/api/auth/verify-email", {"token": "garbage-token"}, format="json")
        assert resp.status_code == 400
        assert resp.json()["detail"] == "Invalid or expired token."


# ── Task 6: FRONTEND_URL VALIDATION ──────────────────────────────────────────

class TestFrontendUrlValidation:
    def test_get_safe_frontend_url_allows_localhost_in_non_debug(self, settings):
        settings.DEBUG = False
        settings.FRONTEND_URL = "http://localhost:3000"
        from apps.accounts.emails import _get_safe_frontend_url
        # Should not raise for localhost even in non-debug mode.
        assert _get_safe_frontend_url() == "http://localhost:3000"

    def test_get_safe_frontend_url_rejects_http_non_localhost_in_prod(self, settings):
        from django.core.exceptions import ImproperlyConfigured
        settings.DEBUG = False
        settings.FRONTEND_URL = "http://evil.example.com"
        from apps.accounts.emails import _get_safe_frontend_url
        with pytest.raises(ImproperlyConfigured):
            _get_safe_frontend_url()

    def test_get_safe_frontend_url_rejects_url_with_credentials(self, settings):
        from django.core.exceptions import ImproperlyConfigured
        settings.DEBUG = False
        settings.FRONTEND_URL = "https://user:pass@app.rivrhealth.com"
        from apps.accounts.emails import _get_safe_frontend_url
        with pytest.raises(ImproperlyConfigured):
            _get_safe_frontend_url()

    def test_get_safe_frontend_url_accepts_https_in_prod(self, settings):
        settings.DEBUG = False
        settings.FRONTEND_URL = "https://app.rivrhealth.com"
        from apps.accounts.emails import _get_safe_frontend_url
        assert _get_safe_frontend_url() == "https://app.rivrhealth.com"

    def test_get_safe_frontend_url_allows_http_in_debug(self, settings):
        settings.DEBUG = True
        settings.FRONTEND_URL = "http://any.host.com"
        from apps.accounts.emails import _get_safe_frontend_url
        assert _get_safe_frontend_url() == "http://any.host.com"


# ── Task 7: LOGOUT REVOKES ACCESS TOKEN ──────────────────────────────────────

@pytest.mark.django_db
class TestLogoutRevokesAccessToken:
    def test_access_token_rejected_after_logout_with_access(self, make_user, api_client):
        make_user(email="logout_revoke@example.com")
        tokens = login(api_client, email="logout_revoke@example.com").json()
        access = tokens["access"]
        refresh = tokens["refresh"]

        auth(api_client, access)
        # Logout passing both tokens.
        resp = api_client.post(LOGOUT, {"refresh": refresh, "access": access}, format="json")
        assert resp.status_code == 205

        # The access token must now be rejected.
        auth(api_client, access)
        resp2 = api_client.get(ME)
        assert resp2.status_code == 401

    def test_logout_without_access_field_still_works(self, make_user, api_client):
        """Backward-compat: logout with only refresh token still succeeds."""
        make_user(email="logout_compat@example.com")
        tokens = login(api_client, email="logout_compat@example.com").json()
        auth(api_client, tokens["access"])
        resp = api_client.post(LOGOUT, {"refresh": tokens["refresh"]}, format="json")
        assert resp.status_code == 205


# ── Task 10: QA MAX_QUESTION ENFORCEMENT ─────────────────────────────────────

@pytest.mark.django_db
class TestQAMaxQuestion:
    def test_question_over_500_chars_rejected(self, api_client, db):
        user = User.objects.create_user(
            email="qa_max@example.com", password=PW, email_verified_at=timezone.now()
        )
        api_client.force_authenticate(user=user)
        long_q = "x" * 501
        resp = api_client.post("/api/qa", {"question": long_q}, format="json")
        assert resp.status_code == 400
        assert "500" in resp.json()["detail"]

    def test_question_at_500_chars_is_allowed(self, api_client, db, settings):
        """At exactly MAX_QUESTION, the request passes the length check (may 503 without key)."""
        settings.OPENAI_API_KEY = ""
        user = User.objects.create_user(
            email="qa_max2@example.com", password=PW, email_verified_at=timezone.now()
        )
        api_client.force_authenticate(user=user)
        exact_q = "x" * 500
        resp = api_client.post("/api/qa", {"question": exact_q}, format="json")
        # Passes validation, fails on missing OPENAI_API_KEY → 503
        assert resp.status_code == 503


# ── INTEGRATION: Full security flow ──────────────────────────────────────────

@pytest.mark.django_db
class TestSecurityIntegration:
    def test_full_reset_flow_single_use(self, make_user, api_client):
        """Register → forgot → reset (success) → reset again (blocked)."""
        user = make_user(email="integration@example.com")
        from apps.accounts.tokens import make_password_reset_tokens
        uid, token = make_password_reset_tokens(user)

        r1 = api_client.post(RESET, {"uid": uid, "token": token, "password": NEW_PW}, format="json")
        assert r1.status_code == 200

        r2 = api_client.post(RESET, {"uid": uid, "token": token, "password": "AnotherPass!99"}, format="json")
        assert r2.status_code == 400

    def test_login_lockout_and_access_denylist(self, make_user, api_client):
        """Login → logout (denylist access) → verify access rejected; then lockout."""
        user = make_user(email="full_flow@example.com")
        tokens = login(api_client, email="full_flow@example.com").json()

        auth(api_client, tokens["access"])
        api_client.post(LOGOUT, {"refresh": tokens["refresh"], "access": tokens["access"]}, format="json")

        # Access token now denied.
        auth(api_client, tokens["access"])
        assert api_client.get(ME).status_code == 401

        # Login again, then exhaust lockout from another client.
        from rest_framework.test import APIClient
        attacker = APIClient()
        for _ in range(5):
            attacker.post(LOGIN, {"email": "full_flow@example.com", "password": "wrong"}, format="json")

        r = attacker.post(LOGIN, {"email": "full_flow@example.com", "password": PW}, format="json")
        assert r.status_code == 423
