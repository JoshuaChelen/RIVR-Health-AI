from django.contrib import admin

from .models import Document


@admin.register(Document)
class DocumentAdmin(admin.ModelAdmin):
    list_display = ["id", "user", "title", "status", "source_type", "created_at"]
    list_filter = ["status", "source_type"]
    search_fields = ["title", "user__email"]
    raw_id_fields = ["user"]
