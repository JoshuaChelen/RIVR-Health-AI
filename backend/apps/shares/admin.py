from django.contrib import admin

from .models import SharePackage


@admin.register(SharePackage)
class SharePackageAdmin(admin.ModelAdmin):
    list_display = ["id", "owner", "file_type", "expires_at", "views_count", "revoked"]
    list_filter = ["file_type", "revoked"]
    search_fields = ["owner__email"]
    raw_id_fields = ["owner"]
