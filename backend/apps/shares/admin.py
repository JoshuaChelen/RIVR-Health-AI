from django.contrib import admin

from .models import SharePackage, SharePackageItem


@admin.register(SharePackage)
class SharePackageAdmin(admin.ModelAdmin):
    list_display = ["id", "owner", "file_type", "expires_at", "views_count", "revoked"]
    list_filter = ["file_type", "revoked"]
    search_fields = ["owner__email"]
    raw_id_fields = ["owner"]


@admin.register(SharePackageItem)
class SharePackageItemAdmin(admin.ModelAdmin):
    list_display = ["id", "package", "document"]
    raw_id_fields = ["package", "document"]
