"""Tests for Celery/WSGI/ASGI entry-point fail-closed validation (Phase 0)."""
import os
import subprocess
import sys


class TestSettingsModuleValidation:
    """Test that celery/wsgi/asgi fail-closed when DJANGO_SETTINGS_MODULE is unset."""

    def test_celery_requires_explicit_settings_module(self):
        """Celery must reject missing DJANGO_SETTINGS_MODULE, not default to dev."""
        env = os.environ.copy()
        env.pop("DJANGO_SETTINGS_MODULE", None)
        env.pop("DJANGO_SECRET_KEY", None)
        env["DJANGO_READ_DOT_ENV_FILE"] = "false"

        result = subprocess.run(
            [sys.executable, "-c", "from config.celery import app"],
            env=env,
            cwd="/Users/darwashi/Downloads/rivr/RIVR-Health-AI/backend",
            capture_output=True,
            text=True,
        )

        assert result.returncode != 0
        assert "DJANGO_SETTINGS_MODULE" in result.stderr.upper()

    def test_wsgi_requires_explicit_settings_module(self):
        """WSGI must reject missing DJANGO_SETTINGS_MODULE, not default to dev."""
        env = os.environ.copy()
        env.pop("DJANGO_SETTINGS_MODULE", None)
        env.pop("DJANGO_SECRET_KEY", None)
        env["DJANGO_READ_DOT_ENV_FILE"] = "false"

        result = subprocess.run(
            [sys.executable, "-c", "from config.wsgi import application"],
            env=env,
            cwd="/Users/darwashi/Downloads/rivr/RIVR-Health-AI/backend",
            capture_output=True,
            text=True,
        )

        assert result.returncode != 0
        assert "DJANGO_SETTINGS_MODULE" in result.stderr.upper()

    def test_asgi_requires_explicit_settings_module(self):
        """ASGI must reject missing DJANGO_SETTINGS_MODULE, not default to dev."""
        env = os.environ.copy()
        env.pop("DJANGO_SETTINGS_MODULE", None)
        env.pop("DJANGO_SECRET_KEY", None)
        env["DJANGO_READ_DOT_ENV_FILE"] = "false"

        result = subprocess.run(
            [sys.executable, "-c", "from config.asgi import application"],
            env=env,
            cwd="/Users/darwashi/Downloads/rivr/RIVR-Health-AI/backend",
            capture_output=True,
            text=True,
        )

        assert result.returncode != 0
        assert "DJANGO_SETTINGS_MODULE" in result.stderr.upper()
