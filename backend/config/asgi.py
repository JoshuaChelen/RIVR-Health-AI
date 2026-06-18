import os

from django.core.exceptions import ImproperlyConfigured
from django.core.asgi import get_asgi_application

# Fail-closed: require explicit DJANGO_SETTINGS_MODULE, never silently default to dev
if "DJANGO_SETTINGS_MODULE" not in os.environ:
    raise ImproperlyConfigured(
        "DJANGO_SETTINGS_MODULE must be explicitly set (prod or dev). "
        "Production must set DJANGO_SETTINGS_MODULE=config.settings.prod."
    )

application = get_asgi_application()
