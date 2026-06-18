import os

from celery import Celery
from django.core.exceptions import ImproperlyConfigured

# Fail-closed: require explicit DJANGO_SETTINGS_MODULE, never silently default to dev
if "DJANGO_SETTINGS_MODULE" not in os.environ:
    raise ImproperlyConfigured(
        "DJANGO_SETTINGS_MODULE must be explicitly set. "
        "In production, set to 'config.settings.prod'. "
        "In development, set to 'config.settings.dev'. "
        "Never silently default to dev settings in production."
    )

app = Celery("rivr")
app.config_from_object("django.conf:settings", namespace="CELERY")
app.autodiscover_tasks()
