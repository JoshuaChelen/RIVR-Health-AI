from django.contrib import admin

from .models import ShareAccessLog, SharePackage


@admin.register(SharePackage)
class SharePackageAdmin(admin.ModelAdmin):
    list_display = ["id", "owner", "file_type", "expires_at", "views_count", "max_views", "revoked", "created_at"]
    list_filter = ["file_type", "revoked", "created_at"]
    search_fields = ["owner__email"]
    raw_id_fields = ["owner"]
    readonly_fields = ["token_hash", "pin_hash", "created_at", "updated_at", "artifacts_deleted_at"]
    # Exclude PHI payload from admin view
    exclude = ["payload_json"]

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False

    def has_delete_permission(self, request, obj=None):
        # Only superusers can delete (for rare data corrections)
        return request.user.is_superuser if request else False


@admin.register(ShareAccessLog)
class ShareAccessLogAdmin(admin.ModelAdmin):
    list_display = ["id", "share_package", "action", "client_ip", "pin_attempt", "created_at"]
    list_filter = ["action", "created_at"]
    search_fields = ["client_ip"]
    date_hierarchy = "created_at"
    readonly_fields = ["share_package", "action", "client_ip", "pin_attempt", "views_count", "created_at"]

    # Audit logs are immutable — no add, change, or delete
    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False

    def has_delete_permission(self, request, obj=None):
        return False
