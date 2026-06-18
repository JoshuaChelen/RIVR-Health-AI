"""Tests for production settings validation (Phase 0 security hardening)."""
import os
import subprocess
import sys

import pytest
from django.test import override_settings


_CWD = "/Users/darwashi/Downloads/rivr/RIVR-Health-AI/backend"
_CMD = "from django.conf import settings; _ = settings.DEBUG"


def _minimal_prod_env(**overrides) -> dict:
    """Return a minimal subprocess env for testing prod settings.

    Starts from os.environ (needed for PATH/PYTHONPATH etc.) but strips any
    env vars that read_env may have injected into the parent process, then sets
    DJANGO_READ_DOT_ENV_FILE=false so base.py skips .env loading.
    Provides the minimum valid prod config; callers override to test failures.
    """
    env = os.environ.copy()
    # Strip vars read_env may have written into the parent process's os.environ
    for key in (
        "CORS_ALLOW_ALL_ORIGINS", "DJANGO_SECRET_KEY", "DJANGO_ALLOWED_HOSTS",
        "DATABASE_URL", "DJANGO_DEBUG", "DJANGO_SETTINGS_MODULE",
        "CELERY_BROKER_URL", "CELERY_RESULT_BACKEND",
    ):
        env.pop(key, None)
    # Sane valid prod baseline
    env["DJANGO_READ_DOT_ENV_FILE"] = "false"
    env["DJANGO_SETTINGS_MODULE"] = "config.settings.prod"
    env["DJANGO_SECRET_KEY"] = "x" * 60
    env["DJANGO_ALLOWED_HOSTS"] = "api.example.com"
    env["DATABASE_URL"] = "postgres://user:pass@localhost/db?sslmode=require"
    env["CORS_ALLOW_ALL_ORIGINS"] = "false"
    env.update(overrides)
    return env


def _run(cmd=_CMD, **env_overrides):
    return subprocess.run(
        [sys.executable, "-c", cmd],
        env=_minimal_prod_env(**env_overrides),
        cwd=_CWD,
        capture_output=True,
        text=True,
    )


# ── Task 1 ────────────────────────────────────────────────────────────────────

class TestCookieSecuritySettings:
    """Test that session and CSRF cookies have proper security flags."""

    def test_prod_enforces_session_cookie_security(self):
        """Prod must enforce HTTPONLY, SECURE, and SAMESITE=Strict on session cookies."""
        result = _run("""
from django.conf import settings
assert settings.SESSION_COOKIE_HTTPONLY == True, 'SESSION_COOKIE_HTTPONLY not True'
assert settings.SESSION_COOKIE_SAMESITE == 'Strict', f'SESSION_COOKIE_SAMESITE={settings.SESSION_COOKIE_SAMESITE}, not Strict'
assert settings.CSRF_COOKIE_SAMESITE == 'Strict', f'CSRF_COOKIE_SAMESITE={settings.CSRF_COOKIE_SAMESITE}, not Strict'
assert settings.CSRF_COOKIE_HTTPONLY == True, 'CSRF_COOKIE_HTTPONLY not True'
assert settings.SESSION_COOKIE_SECURE == True, 'SESSION_COOKIE_SECURE not True'
assert settings.CSRF_COOKIE_SECURE == True, 'CSRF_COOKIE_SECURE not True'
""")
        assert result.returncode == 0, f"Failed: {result.stderr}"


class TestCookieSecurityInTests:
    """Test that cookie flags are set correctly (base.py defaults, active in test settings)."""

    def test_session_cookie_httponly_set(self):
        """SESSION_COOKIE_HTTPONLY must be True to prevent XSS theft."""
        from django.conf import settings
        assert settings.SESSION_COOKIE_HTTPONLY == True

    def test_csrf_cookie_httponly_set(self):
        """CSRF_COOKIE_HTTPONLY must be True to prevent XSS theft."""
        from django.conf import settings
        assert settings.CSRF_COOKIE_HTTPONLY == True

    def test_csrf_cookie_samesite_set(self):
        """CSRF_COOKIE_SAMESITE must be set to prevent CSRF."""
        from django.conf import settings
        assert settings.CSRF_COOKIE_SAMESITE in ('Strict', 'Lax')

    def test_session_cookie_samesite_set(self):
        """SESSION_COOKIE_SAMESITE must be set to prevent CSRF."""
        from django.conf import settings
        assert settings.SESSION_COOKIE_SAMESITE in ('Strict', 'Lax')


# ── Task 2 ────────────────────────────────────────────────────────────────────

class TestSecretKeyValidation:
    """Test that prod.py enforces strict SECRET_KEY validation."""

    def test_prod_rejects_dev_hardcoded_key(self):
        """Prod settings must reject the hardcoded dev default SECRET_KEY."""
        result = _run(DJANGO_SECRET_KEY="dev-insecure-change-me-0123456789-abcdefghijklmnopqrstuvwxyz")
        assert result.returncode != 0
        assert "SECRET_KEY" in result.stderr or "insecure" in result.stderr.lower()

    def test_prod_rejects_missing_secret_key(self):
        """Prod settings must reject missing DJANGO_SECRET_KEY env."""
        env = _minimal_prod_env()
        env.pop("DJANGO_SECRET_KEY", None)
        result = subprocess.run([sys.executable, "-c", _CMD], env=env, cwd=_CWD,
                                capture_output=True, text=True)
        assert result.returncode != 0
        assert "SECRET_KEY" in result.stderr.upper()

    def test_prod_rejects_short_secret_key(self):
        """Prod settings must reject SECRET_KEY shorter than 50 chars."""
        result = _run(DJANGO_SECRET_KEY="short-key-xyz")
        assert result.returncode != 0
        assert "SECRET_KEY" in result.stderr.upper() and "50" in result.stderr


# ── Task 3 ────────────────────────────────────────────────────────────────────

class TestAllowedHostsValidation:
    """Test that ALLOWED_HOSTS is strictly validated in prod."""

    def test_prod_rejects_wildcard_allowed_hosts(self):
        """Prod must reject ALLOWED_HOSTS=['*'] and require explicit hosts."""
        result = _run(DJANGO_ALLOWED_HOSTS="*")
        assert result.returncode != 0
        assert "ALLOWED_HOSTS" in result.stderr.upper()

    def test_prod_rejects_missing_allowed_hosts(self):
        """Prod must reject empty DJANGO_ALLOWED_HOSTS."""
        env = _minimal_prod_env()
        env.pop("DJANGO_ALLOWED_HOSTS", None)
        result = subprocess.run([sys.executable, "-c", _CMD], env=env, cwd=_CWD,
                                capture_output=True, text=True)
        assert result.returncode != 0
        assert "ALLOWED_HOSTS" in result.stderr.upper()


# ── Task 4 ────────────────────────────────────────────────────────────────────

class TestCORSValidation:
    """Test that CORS_ALLOW_ALL_ORIGINS is rejected in prod."""

    def test_prod_rejects_cors_allow_all_true(self):
        """Prod must actively reject CORS_ALLOW_ALL_ORIGINS=true, not just default False."""
        result = _run(CORS_ALLOW_ALL_ORIGINS="true")
        assert result.returncode != 0
        assert "CORS" in result.stderr.upper()


# ── Task 5 ────────────────────────────────────────────────────────────────────

class TestDatabaseSSLValidation:
    """Test that database SSL/TLS is strictly enforced."""

    def test_prod_requires_database_ssl_require(self):
        """Prod database URL must include sslmode=require, reject allow/disable/prefer."""
        result = _run(DATABASE_URL="postgres://user:pass@db.example.com:5432/mydb")
        assert result.returncode != 0
        assert "SSL" in result.stderr.upper() or "SSLMODE" in result.stderr.upper()

    def test_prod_rejects_database_ssl_allow(self):
        """Prod must reject sslmode=allow (permits fallback to plaintext)."""
        result = _run(DATABASE_URL="postgres://user:pass@db.example.com:5432/mydb?sslmode=allow")
        assert result.returncode != 0

    def test_prod_rejects_database_ssl_disable(self):
        """Prod must reject sslmode=disable (no encryption)."""
        result = _run(DATABASE_URL="postgres://user:pass@db.example.com:5432/mydb?sslmode=disable")
        assert result.returncode != 0

    def test_prod_accepts_database_ssl_require(self):
        """Prod accepts sslmode=require (mandatory encryption)."""
        result = _run(DATABASE_URL="postgres://user:pass@db.example.com:5432/mydb?sslmode=require")
        assert result.returncode == 0


# ── Task 9 ────────────────────────────────────────────────────────────────────

class TestUploadLimits:
    """Test that upload size limits are enforced."""

    def test_file_upload_max_memory_size_set(self):
        """FILE_UPLOAD_MAX_MEMORY_SIZE must be set to prevent DoS."""
        from django.conf import settings
        assert hasattr(settings, 'FILE_UPLOAD_MAX_MEMORY_SIZE')
        assert settings.FILE_UPLOAD_MAX_MEMORY_SIZE is not None
        assert settings.FILE_UPLOAD_MAX_MEMORY_SIZE <= 50 * 1024 * 1024

    def test_data_upload_max_memory_size_set(self):
        """DATA_UPLOAD_MAX_MEMORY_SIZE must be set to prevent DoS."""
        from django.conf import settings
        assert hasattr(settings, 'DATA_UPLOAD_MAX_MEMORY_SIZE')
        assert settings.DATA_UPLOAD_MAX_MEMORY_SIZE is not None
        assert settings.DATA_UPLOAD_MAX_MEMORY_SIZE <= 10 * 1024 * 1024

    def test_data_upload_max_number_fields_set(self):
        """DATA_UPLOAD_MAX_NUMBER_FIELDS must be set to prevent DoS."""
        from django.conf import settings
        assert hasattr(settings, 'DATA_UPLOAD_MAX_NUMBER_FIELDS')
        assert settings.DATA_UPLOAD_MAX_NUMBER_FIELDS is not None
        assert settings.DATA_UPLOAD_MAX_NUMBER_FIELDS == 1000


# ── Task 10 ───────────────────────────────────────────────────────────────────

class TestBrowserSecurityHeaders:
    """Test that browser security headers are set in production."""

    def test_prod_sets_browser_xss_filter(self):
        """SECURE_BROWSER_XSS_FILTER must be True in production."""
        result = _run("""
from django.conf import settings
assert settings.SECURE_BROWSER_XSS_FILTER == True, 'SECURE_BROWSER_XSS_FILTER not True'
assert settings.SECURE_CONTENT_TYPE_NOSNIFF == True, 'SECURE_CONTENT_TYPE_NOSNIFF not True'
assert settings.SECURE_REFERRER_POLICY == 'strict-origin-when-cross-origin', 'SECURE_REFERRER_POLICY incorrect'
""")
        assert result.returncode == 0, f"Failed: {result.stderr}"


# ── Task 11 ───────────────────────────────────────────────────────────────────

class TestCSRFTrustedOrigins:
    """Test that CSRF_TRUSTED_ORIGINS is properly configured in production."""

    def test_csrf_trusted_origins_is_list(self):
        """Prod CSRF_TRUSTED_ORIGINS must be a non-empty list."""
        result = _run("""
from django.conf import settings
assert isinstance(settings.CSRF_TRUSTED_ORIGINS, (list, tuple, set)), 'CSRF_TRUSTED_ORIGINS not a list'
assert len(settings.CSRF_TRUSTED_ORIGINS) > 0, 'CSRF_TRUSTED_ORIGINS is empty'
""")
        assert result.returncode == 0, f"Failed: {result.stderr}"

    def test_csrf_trusted_origins_contains_https(self):
        """Prod CSRF_TRUSTED_ORIGINS entries should use https scheme."""
        result = _run("""
from django.conf import settings
for origin in settings.CSRF_TRUSTED_ORIGINS:
    assert origin.startswith('https://'), f'Origin {origin} should use https'
""")
        assert result.returncode == 0, f"Failed: {result.stderr}"
