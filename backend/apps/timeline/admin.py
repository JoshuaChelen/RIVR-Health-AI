from django.contrib import admin

from .models import TimelineEvent


@admin.register(TimelineEvent)
class TimelineEventAdmin(admin.ModelAdmin):
    list_display = ["id", "user", "title", "occurred_at", "source", "included_in_previsit"]
    list_filter = ["source", "included_in_previsit"]
    search_fields = ["title", "user__email"]
    raw_id_fields = ["user", "document"]
