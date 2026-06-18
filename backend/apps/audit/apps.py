from django.apps import AppConfig


class AuditConfig(AppConfig):
    name = "apps.audit"
    label = "audit"

    def ready(self):
        import apps.audit.signals  # noqa: F401
