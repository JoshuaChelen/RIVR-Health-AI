from django.contrib import admin

from .models import AiJob, AiJobEvent


@admin.register(AiJob)
class AiJobAdmin(admin.ModelAdmin):
    list_display = ["id", "user", "job_type", "status", "stage", "created_at"]
    list_filter = ["job_type", "status"]
    search_fields = ["user__email"]
    raw_id_fields = ["user"]


@admin.register(AiJobEvent)
class AiJobEventAdmin(admin.ModelAdmin):
    list_display = ["id", "job", "level", "message", "at"]
    list_filter = ["level"]
    raw_id_fields = ["job"]
