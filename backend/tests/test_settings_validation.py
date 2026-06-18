"""Tests for production settings validation (Phase 0 security hardening)."""
import os
import subprocess
import sys

import pytest
from django.test import override_settings


class TestCookieSecuritySettings:
    """Test that session and CSRF cookies have proper security flags."""

    def test_prod_enforces_session_cookie_security(self):
        """Prod must enforce HTTPONLY, SECURE, and SAMESITE=Strict on session cookies."""
        env = os.environ.copy()
        env["DJANGO_SETTINGS_MODULE"] = "config.settings.prod"
        env["DJANGO_SECRET_KEY"] = "x" * 60
        env["DJANGO_ALLOWED_HOSTS"] = "api.example.com"
        env["DATABASE_URL"] = "postgres://user:pass@localhost/db?sslmode=require"
        env["DJANGO_READ_DOT_ENV_FILE"] = "false"

        result = subprocess.run(
            [sys.executable, "-c", """
import os
os.environ.update({
    'DJANGO_SETTINGS_MODULE': 'config.settings.prod',
    'DJANGO_SECRET_KEY': 'x' * 60,
    'DJANGO_ALLOWED_HOSTS': 'api.example.com',
    'DATABASE_URL': 'postgres://user:pass@localhost/db?sslmode=require',
    'DJANGO_READ_DOT_ENV_FILE': 'false',
})
from django.conf import settings
assert settings.SESSION_COOKIE_HTTPONLY == True, 'SESSION_COOKIE_HTTPONLY not True'
assert settings.SESSION_COOKIE_SAMESITE == 'Strict', f'SESSION_COOKIE_SAMESITE={settings.SESSION_COOKIE_SAMESITE}, not Strict'
assert settings.CSRF_COOKIE_SAMESITE == 'Strict', f'CSRF_COOKIE_SAMESITE={settings.CSRF_COOKIE_SAMESITE}, not Strict'
assert settings.CSRF_COOKIE_HTTPONLY == True, 'CSRF_COOKIE_HTTPONLY not True'
assert settings.SESSION_COOKIE_SECURE == True, 'SESSION_COOKIE_SECURE not True'
assert settings.CSRF_COOKIE_SECURE == True, 'CSRF_COOKIE_SECURE not True'
"""],
            env=env,
            cwd="/Users/darwashi/Downloads/rivr/RIVR-Health-AI/backend",
            capture_output=True,
            text=True,
        )

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


class TestSecretKeyValidation:
    """Test that prod.py enforces strict SECRET_KEY validation."""

    def test_prod_rejects_dev_hardcoded_key(self):
        """Prod settings must reject the hardcoded dev default SECRET_KEY."""
        env = os.environ.copy()
        env["DJANGO_SETTINGS_MODULE"] = "config.settings.prod"
        env["DJANGO_SECRET_KEY"] = "dev-insecure-change-me-0123456789-abcdefghijklmnopqrstuvwxyz"
        env["DJANGO_ALLOWED_HOSTS"] = "api.example.com"
        env["DATABASE_URL"] = "postgres://user:pass@localhost/db?sslmode=require"
        env["DJANGO_READ_DOT_ENV_FILE"] = "false"

        # Access settings.DEBUG to trigger lazy settings import
        result = subprocess.run(
            [sys.executable, "-c", "from django.conf import settings; _ = settings.DEBUG"],
            env=env,
            cwd="/Users/darwashi/Downloads/rivr/RIVR-Health-AI/backend",
            capture_output=True,
            text=True,
        )

        assert result.returncode != 0
        assert "SECRET_KEY" in result.stderr or "insecure" in result.stderr.lower()

    def test_prod_rejects_missing_secret_key(self):
        """Prod settings must reject missing DJANGO_SECRET_KEY env."""
        env = os.environ.copy()
        env.pop("DJANGO_SECRET_KEY", None)
        env["DJANGO_SETTINGS_MODULE"] = "config.settings.prod"
        env["DJANGO_ALLOWED_HOSTS"] = "api.example.com"
        env["DATABASE_URL"] = "postgres://user:pass@localhost/db?sslmode=require"
        env["DJANGO_READ_DOT_ENV_FILE"] = "false"

        result = subprocess.run(
            [sys.executable, "-c", "from django.conf import settings; _ = settings.DEBUG"],
            env=env,
            cwd="/Users/darwashi/Downloads/rivr/RIVR-Health-AI/backend",
            capture_output=True,
            text=True,
        )

        assert result.returncode != 0
        assert "SECRET_KEY" in result.stderr.upper()

    def test_prod_rejects_short_secret_key(self):
        """Prod settings must reject SECRET_KEY shorter than 50 chars."""
        env = os.environ.copy()
        env["DJANGO_SETTINGS_MODULE"] = "config.settings.prod"
        env["DJANGO_SECRET_KEY"] = "short-key-xyz"
        env["DJANGO_ALLOWED_HOSTS"] = "api.example.com"
        env["DATABASE_URL"] = "postgres://user:pass@localhost/db?sslmode=require"
        env["DJANGO_READ_DOT_ENV_FILE"] = "false"

        result = subprocess.run(
            [sys.executable, "-c", "from django.conf import settings; _ = settings.DEBUG"],
            env=env,
            cwd="/Users/darwashi/Downloads/rivr/RIVR-Health-AI/backend",
            capture_output=True,
            text=True,
        )

        assert result.returncode != 0
        assert "SECRET_KEY" in result.stderr.upper() and "50" in result.stderr


class TestAllowedHostsValidation:
    """Test that ALLOWED_HOSTS is strictly validated in prod."""

    def test_prod_rejects_wildcard_allowed_hosts(self):
        """Prod must reject ALLOWED_HOSTS=['*'] and require explicit hosts."""
        env = os.environ.copy()
        env["DJANGO_SETTINGS_MODULE"] = "config.settings.prod"
        env["DJANGO_SECRET_KEY"] = "x" * 60
        env["DJANGO_ALLOWED_HOSTS"] = "*"
        env["DATABASE_URL"] = "postgres://user:pass@localhost/db?sslmode=require"
        env["DJANGO_READ_DOT_ENV_FILE"] = "false"

        result = subprocess.run(
            [sys.executable, "-c", "from django.conf import settings; _ = settings.DEBUG"],
            env=env,
            cwd="/Users/darwashi/Downloads/rivr/RIVR-Health-AI/backend",
            capture_output=True,
            text=True,
        )

        assert result.returncode != 0
        assert "ALLOWED_HOSTS" in result.stderr.upper()

    def test_prod_rejects_missing_allowed_hosts(self):
        """Prod must reject empty DJANGO_ALLOWED_HOSTS."""
        env = os.environ.copy()
        env.pop("DJANGO_ALLOWED_HOSTS", None)
        env["DJANGO_SETTINGS_MODULE"] = "config.settings.prod"
        env["DJANGO_SECRET_KEY"] = "x" * 60
        env["DATABASE_URL"] = "postgres://user:pass@localhost/db?sslmode=require"
        env["DJANGO_READ_DOT_ENV_FILE"] = "false"

        result = subprocess.run(
            [sys.executable, "-c", "from django.conf import settings; _ = settings.DEBUG"],
            env=env,
            cwd="/Users/darwashi/Downloads/rivr/RIVR-Health-AI/backend",
            capture_output=True,
            text=True,
        )

        assert result.returncode != 0
        assert "ALLOWED_HOSTS" in result.stderr.upper()


class TestCORSValidation:
    """Test that CORS_ALLOW_ALL_ORIGINS is rejected in prod."""

    def test_prod_rejects_cors_allow_all_true(self):
        """Prod must actively reject CORS_ALLOW_ALL_ORIGINS=true, not just default False."""
        env = os.environ.copy()
        env["DJANGO_SETTINGS_MODULE"] = "config.settings.prod"
        env["DJANGO_SECRET_KEY"] = "x" * 60
        env["DJANGO_ALLOWED_HOSTS"] = "api.example.com"
        env["DATABASE_URL"] = "postgres://user:pass@localhost/db?sslmode=require"
        env["CORS_ALLOW_ALL_ORIGINS"] = "true"
        env["DJANGO_READ_DOT_ENV_FILE"] = "false"

        result = subprocess.run(
            [sys.executable, "-c", "from django.conf import settings; _ = settings.DEBUG"],
            env=env,
            cwd="/Users/darwashi/Downloads/rivr/RIVR-Health-AI/backend",
            capture_output=True,
            text=True,
        )

        assert result.returncode != 0
        assert "CORS" in result.stderr.upper()


class TestDatabaseSSLValidation:
    """Test that database SSL/TLS is strictly enforced."""

    def test_prod_requires_database_ssl_require(self):
        """Prod database URL must include sslmode=require, reject allow/disable/prefer."""
        env = os.environ.copy()
        env["DJANGO_SETTINGS_MODULE"] = "config.settings.prod"
        env["DJANGO_SECRET_KEY"] = "x" * 60
        env["DJANGO_ALLOWED_HOSTS"] = "api.example.com"
        env["DATABASE_URL"] = "postgres://user:pass@db.example.com:5432/mydb"
        env["DJANGO_READ_DOT_ENV_FILE"] = "false"

        result = subprocess.run(
            [sys.executable, "-c", "from django.conf import settings; _ = settings.DEBUG"],
            env=env,
            cwd="/Users/darwashi/Downloads/rivr/RIVR-Health-AI/backend",
            capture_output=True,
            text=True,
        )
        assert result.returncode != 0
        assert "SSL" in result.stderr.upper() or "SSLMODE" in result.stderr.upper()

    def test_prod_rejects_database_ssl_allow(self):
        """Prod must reject sslmode=allow (permits fallback to plaintext)."""
        env = os.environ.copy()
        env["DJANGO_SETTINGS_MODULE"] = "config.settings.prod"
        env["DJANGO_SECRET_KEY"] = "x" * 60
        env["DJANGO_ALLOWED_HOSTS"] = "api.example.com"
        env["DATABASE_URL"] = "postgres://user:pass@db.example.com:5432/mydb?sslmode=allow"
        env["DJANGO_READ_DOT_ENV_FILE"] = "false"

        result = subprocess.run(
            [sys.executable, "-c", "from django.conf import settings; _ = settings.DEBUG"],
            env=env,
            cwd="/Users/darwashi/Downloads/rivr/RIVR-Health-AI/backend",
            capture_output=True,
            text=True,
        )
        assert result.returncode != 0

    def test_prod_rejects_database_ssl_disable(self):
        """Prod must reject sslmode=disable (no encryption)."""
        env = os.environ.copy()
        env["DJANGO_SETTINGS_MODULE"] = "config.settings.prod"
        env["DJANGO_SECRET_KEY"] = "x" * 60
        env["DJANGO_ALLOWED_HOSTS"] = "api.example.com"
        env["DATABASE_URL"] = "postgres://user:pass@db.example.com:5432/mydb?sslmode=disable"
        env["DJANGO_READ_DOT_ENV_FILE"] = "false"

        result = subprocess.run(
            [sys.executable, "-c", "from django.conf import settings; _ = settings.DEBUG"],
            env=env,
            cwd="/Users/darwashi/Downloads/rivr/RIVR-Health-AI/backend",
            capture_output=True,
            text=True,
        )
        assert result.returncode != 0

    def test_prod_accepts_database_ssl_require(self):
        """Prod accepts sslmode=require (mandatory encryption)."""
        env = os.environ.copy()
        env["DJANGO_SETTINGS_MODULE"] = "config.settings.prod"
        env["DJANGO_SECRET_KEY"] = "x" * 60
        env["DJANGO_ALLOWED_HOSTS"] = "api.example.com"
        env["DATABASE_URL"] = "postgres://user:pass@db.example.com:5432/mydb?sslmode=require"
        env["DJANGO_READ_DOT_ENV_FILE"] = "false"

        result = subprocess.run(
            [sys.executable, "-c", "from django.conf import settings; _ = settings.DEBUG"],
            env=env,
            cwd="/Users/darwashi/Downloads/rivr/RIVR-Health-AI/backend",
            capture_output=True,
            text=True,
        )
        assert result.returncode == 0


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


class TestBrowserSecurityHeaders:
    """Test that browser security headers are set in production."""

    def test_prod_sets_browser_xss_filter(self):
        """SECURE_BROWSER_XSS_FILTER must be True in production."""
        env = os.environ.copy()
        env["DJANGO_SETTINGS_MODULE"] = "config.settings.prod"
        env["DJANGO_SECRET_KEY"] = "x" * 60
        env["DJANGO_ALLOWED_HOSTS"] = "api.example.com"
        env["DATABASE_URL"] = "postgres://user:pass@localhost/db?sslmode=require"
        env["DJANGO_READ_DOT_ENV_FILE"] = "false"

        result = subprocess.run(
            [sys.executable, "-c", """
import os
os.environ.update({
    'DJANGO_SETTINGS_MODULE': 'config.settings.prod',
    'DJANGO_SECRET_KEY': 'x' * 60,
    'DJANGO_ALLOWED_HOSTS': 'api.example.com',
    'DATABASE_URL': 'postgres://user:pass@localhost/db?sslmode=require',
    'DJANGO_READ_DOT_ENV_FILE': 'false',
})
from django.conf import settings
assert settings.SECURE_BROWSER_XSS_FILTER == True, 'SECURE_BROWSER_XSS_FILTER not True'
assert settings.SECURE_CONTENT_TYPE_NOSNIFF == True, 'SECURE_CONTENT_TYPE_NOSNIFF not True'
assert settings.SECURE_REFERRER_POLICY == 'strict-origin-when-cross-origin', 'SECURE_REFERRER_POLICY incorrect'
"""],
            env=env,
            cwd="/Users/darwashi/Downloads/rivr/RIVR-Health-AI/backend",
            capture_output=True,
            text=True,
        )

        assert result.returncode == 0, f"Failed: {result.stderr}"


class TestCSRFTrustedOrigins:
    """Test that CSRF_TRUSTED_ORIGINS is properly configured."""

    def test_csrf_trusted_origins_is_list(self):
        """CSRF_TRUSTED_ORIGINS must be a list/set."""
        from django.conf import settings
        assert isinstance(settings.CSRF_TRUSTED_ORIGINS, (list, tuple, set))
        assert len(settings.CSRF_TRUSTED_ORIGINS) > 0

    def test_csrf_trusted_origins_contains_https(self):
        """CSRF_TRUSTED_ORIGINS entries should use https scheme."""
        from django.conf import settings
        for origin in settings.CSRF_TRUSTED_ORIGINS:
            assert origin.startswith("https://"), f"Origin {origin} should use https"
