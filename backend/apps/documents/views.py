from django.db import transaction
from django.utils import timezone as djtz
from rest_framework import status
from rest_framework.decorators import action
from rest_framework.parsers import FormParser, MultiPartParser
from rest_framework.response import Response

from apps.common import storage
from apps.common.throttles import UploadThrottle
from apps.common.viewsets import OwnedModelViewSet

from .filters import DocumentFilter
from .models import Document
from .serializers import DocumentSerializer

PROCESS_TASK = "apps.jobs.tasks.process_documents_task"


class DocumentViewSet(OwnedModelViewSet):
    queryset = Document.objects.all()
    serializer_class = DocumentSerializer
    filterset_class = DocumentFilter
    ordering_fields = ["created_at", "processed_at"]
    ordering = ["-created_at"]

    def perform_destroy(self, instance: Document) -> None:
        # Detach contributions first (idempotent) so deleting a processed doc
        # doesn't orphan AI items, then remove BOTH stored objects. Storage and
        # detach are best-effort: a transient storage/IO error must NOT leave the
        # DB row orphaned, so the row delete always proceeds.
        if instance.source_type != Document.SourceType.MANUAL_INPUT and instance.summary_path:
            try:
                from .provenance import detach_document
                detach_document(self.request.user, instance)
            except Exception:
                pass
            try:
                storage.delete(instance.summary_path)
            except Exception:
                pass
        try:
            storage.delete(instance.pdf_path)
        except Exception:
            pass
        super().perform_destroy(instance)

    @action(detail=False, methods=["post"], parser_classes=[MultiPartParser, FormParser],
            throttle_classes=[UploadThrottle])
    def upload(self, request):
        upload = request.FILES.get("file")
        if upload is None:
            return Response({"detail": "No file provided."}, status=status.HTTP_400_BAD_REQUEST)
        from .validation import validate_file_size, validate_file_magic_bytes
        is_valid, error_msg = validate_file_size(upload)
        if not is_valid:
            return Response({"detail": error_msg}, status=413)
        is_valid, error_msg = validate_file_magic_bytes(upload)
        if not is_valid:
            return Response({"detail": error_msg}, status=status.HTTP_400_BAD_REQUEST)
        # Only the document kinds we can actually process (PDFs, images for OCR, audio
        # for transcription). content_type is client-supplied so this isn't a security
        # boundary, but it rejects obviously-wrong uploads (executables, archives, html).
        ct = (upload.content_type or "").lower()
        if not ct.startswith(("application/pdf", "image/", "audio/")):
            return Response({"detail": "Unsupported file type. Upload a PDF, image, or audio file."},
                            status=status.HTTP_400_BAD_REQUEST)
        source_type = request.data.get("source_type", Document.SourceType.FILE)
        kind = storage.document_kind(upload.content_type, source_type)
        key = storage.document_key(request.user.id, upload.name, kind)
        saved = storage.save(key, upload)
        doc = Document.objects.create(
            user=request.user,
            title=request.data.get("title", "") or upload.name,
            source_type=source_type,
            status=Document.Status.UPLOADED,
            pdf_path=saved,
            mime_type=upload.content_type or "",
            size_bytes=upload.size,
            sha256=storage.sha256_of(upload),
        )
        return Response(DocumentSerializer(doc).data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=["get"])
    def file(self, request, pk=None):
        doc = self.get_object()
        return Response({"url": storage.signed_url(doc.pdf_path)})

    @action(detail=True, methods=["get"])
    def analysis(self, request, pk=None):
        doc = self.get_object()
        if (doc.source_type == Document.SourceType.MANUAL_INPUT
                or doc.status != Document.Status.PROCESSED or not doc.summary_path):
            return Response({"detail": "No analysis available."}, status=status.HTTP_404_NOT_FOUND)
        from .provenance import build_analysis
        return Response(build_analysis(request.user, doc))

    @action(detail=True, methods=["post"])
    def detach(self, request, pk=None):
        doc = self.get_object()
        if doc.source_type == Document.SourceType.MANUAL_INPUT:
            return Response({"detail": "Manual records have no detachable results."},
                            status=status.HTTP_400_BAD_REQUEST)
        from .provenance import detach_document
        result = detach_document(request.user, doc)
        # Regenerate the derived health profile (card/summary/score) without the
        # detached document's contributions, and revoke now-stale shares.
        from apps.jobs.services import trigger_profile_evaluation
        from apps.shares.services import revoke_active_shares
        trigger_profile_evaluation(request.user)
        revoke_active_shares(request.user)
        return Response(result)

    @action(detail=True, methods=["post"], url_path="confirm-all")
    def confirm_all(self, request, pk=None):
        doc = self.get_object()
        if doc.source_type == Document.SourceType.MANUAL_INPUT or not doc.summary_path:
            return Response({"detail": "No findings to confirm."}, status=status.HTTP_400_BAD_REQUEST)
        from .provenance import build_analysis
        from apps.profiles.models import UserProfile
        ids = {
            c["profile_item_id"] for c in build_analysis(request.user, doc)["contributions"]
            if c.get("origin") == "ai" and c.get("state") == "unreviewed" and c.get("profile_item_id")
        }
        if not ids:
            return Response({"confirmed": 0})
        profile = UserProfile.for_user(request.user)
        now = djtz.now().isoformat()
        changed = []
        confirmed = 0
        for field in ("allergies", "medications", "medical_history", "surgical_history"):
            arr = getattr(profile, field) or []
            touched = False
            for it in arr:
                if isinstance(it, dict) and it.get("id") in ids:
                    it["review_status"] = "confirmed"
                    it["reviewed_at"] = now
                    confirmed += 1
                    touched = True
            if touched:
                changed.append(field)
        if changed:
            profile.save(update_fields=[*changed, "updated_at"])
        # Confirm does not change derived data, so no re-eval needed.
        return Response({"confirmed": confirmed})

    @action(detail=True, methods=["post"])
    def reprocess(self, request, pk=None):
        doc = self.get_object()
        if doc.source_type == Document.SourceType.MANUAL_INPUT:
            return Response({"detail": "Manual records cannot be reprocessed."},
                            status=status.HTTP_400_BAD_REQUEST)
        from apps.jobs.services import enqueue_processing
        from config import celery_app
        # Clear detached state and mark PROCESSING up front, so the state is
        # consistent even when enqueue reuses an already-active job (which only
        # sets PROCESSING when it creates a NEW job).
        Document.objects.filter(id=doc.id).update(
            detached_at=None, status=Document.Status.PROCESSING)
        job, reused = enqueue_processing(request.user, [doc.id])
        if job is None:
            return Response({"detail": "Nothing to process."}, status=status.HTTP_400_BAD_REQUEST)
        if not reused:
            transaction.on_commit(
                lambda: celery_app.send_task(PROCESS_TASK, args=[str(job.id)]))
        return Response({"jobId": str(job.id), "reused": reused},
                        status=status.HTTP_202_ACCEPTED)
