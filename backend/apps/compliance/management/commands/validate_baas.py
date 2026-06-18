from django.core.management.base import BaseCommand
from django.utils import timezone


class Command(BaseCommand):
    help = "Warn on expired or expiring-soon subprocessor BAAs."

    def add_arguments(self, parser):
        parser.add_argument(
            "--warn-days",
            type=int,
            default=30,
            help="Warn when BAA expires within this many days (default: 30).",
        )

    def handle(self, *args, **options):
        from apps.compliance.models import SubprocessorBAA

        warn_days = options["warn_days"]
        today = timezone.now().date()
        issues = 0

        for baa in SubprocessorBAA.objects.all():
            if baa.is_expired():
                self.stderr.write(
                    self.style.ERROR(f"EXPIRED: {baa.vendor_name} expired {baa.baa_expires_at}")
                )
                issues += 1
            elif baa.days_until_expiry() <= warn_days:
                self.stderr.write(
                    self.style.WARNING(
                        f"EXPIRING SOON: {baa.vendor_name} expires in {baa.days_until_expiry()} days ({baa.baa_expires_at})"
                    )
                )
                issues += 1

        if issues == 0:
            self.stdout.write(self.style.SUCCESS("All BAAs are current."))
        else:
            self.stdout.write(self.style.WARNING(f"{issues} BAA(s) require attention."))
