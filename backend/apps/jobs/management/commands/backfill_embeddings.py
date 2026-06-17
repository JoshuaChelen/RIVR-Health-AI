from django.core.management.base import BaseCommand

from apps.documents.models import Document
from apps.jobs import index


class Command(BaseCommand):
    help = "Reindex embeddings for processed documents (facts-only; raw chunks only on reprocess)."

    def add_arguments(self, parser):
        parser.add_argument("--user", default=None, help="Only this user id")

    def handle(self, *args, **opts):
        qs = Document.objects.filter(
            status=Document.Status.PROCESSED, summary_path__gt="",
            detached_at__isnull=True,
        ).exclude(source_type=Document.SourceType.MANUAL_INPUT)
        if opts["user"]:
            qs = qs.filter(user_id=opts["user"])
        n = 0
        for doc in qs.iterator():
            try:
                index.reindex_document(doc)
                n += 1
            except Exception as exc:
                self.stderr.write(f"skip {doc.id}: {exc}")
        self.stdout.write(self.style.SUCCESS(f"reindexed {n} documents"))
