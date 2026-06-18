from django.contrib import admin

from apps.jobs.error_sanitizer import sanitize_log_message

from .models import AiJob, AiJobEvent


@admin.register(AiJob)
class AiJobAdmin(admin.ModelAdmin):
    list_display = ["id", "user", "job_type", "status", "stage", "created_at"]
    list_filter = ["job_type", "status"]
    search_fields = ["user__email"]
    raw_id_fields = ["user"]


@admin.register(AiJobEvent)
class AiJobEventAdmin(admin.ModelAdmin):
    # message is NOT in list_display — it may contain exception text with PHI.
    # Access it via the detail view (readonly_fields) where it is sanitized.
    list_display = ["id", "job", "level", "at"]
    list_filter = ["level"]
    raw_id_fields = ["job"]
    readonly_fields = ["sanitized_message", "data"]

    @admin.display(description="message")
    def sanitized_message(self, obj):
        return sanitize_log_message(obj.message, max_length=1000)
