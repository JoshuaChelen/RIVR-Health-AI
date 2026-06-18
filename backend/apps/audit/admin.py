from django.contrib import admin

from .models import AuditLog


@admin.register(AuditLog)
class AuditLogAdmin(admin.ModelAdmin):
    list_display = ["created_at", "action", "resource_type", "resource_id", "user_email_snapshot", "ip_address"]
    list_filter = ["action", "resource_type"]
    search_fields = ["resource_id", "user_email_snapshot", "ip_address"]
    readonly_fields = [f.name for f in AuditLog._meta.get_fields()]
    ordering = ["-created_at"]

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False

    def has_delete_permission(self, request, obj=None):
        return False
