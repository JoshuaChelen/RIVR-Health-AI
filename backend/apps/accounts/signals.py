"""Signal handlers for the accounts app."""
from django.db.models.signals import post_save
from django.dispatch import receiver
from django.utils import timezone


def connect_signals():
    """Connect all account signals. Called from AccountsConfig.ready()."""
    # Import lazily to avoid circular imports at module load time.
    from django.conf import settings

    from django.db.models.signals import post_save

    # Use settings.AUTH_USER_MODEL string to get the sender model lazily
    from django.apps import apps
    User = apps.get_model(settings.AUTH_USER_MODEL)

    def _create_initial_consents(sender, instance, created, **kwargs):
        if not created:
            return
        from .models import ConsentRecord
        ConsentRecord.objects.create(
            user=instance,
            consent_type=ConsentRecord.ConsentType.PRIVACY_POLICY,
            accepted_at=timezone.now(),
        )
        ConsentRecord.objects.create(
            user=instance,
            consent_type=ConsentRecord.ConsentType.TERMS_OF_SERVICE,
            accepted_at=timezone.now(),
        )

    post_save.connect(
        _create_initial_consents,
        sender=User,
        dispatch_uid="accounts.create_initial_consents",
        weak=False,
    )
