from django.contrib import admin

from .models import TimelineEvent


@admin.register(TimelineEvent)
class TimelineEventAdmin(admin.ModelAdmin):
    # title removed from list_display and search_fields — it is a medical event name (PHI).
    # Access it in the detail view via readonly_fields.
    list_display = ["id", "user", "occurred_at", "source", "included_in_previsit"]
    list_filter = ["source", "included_in_previsit"]
    search_fields = ["user__email"]
    raw_id_fields = ["user", "document"]
    readonly_fields = ["title", "data"]
