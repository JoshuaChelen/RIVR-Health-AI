from django.contrib import admin

from .models import SubprocessorBAA


@admin.register(SubprocessorBAA)
class SubprocessorBAAAdmin(admin.ModelAdmin):
    list_display = ["vendor_name", "service", "status", "baa_signed_date", "baa_expires_at"]
    list_filter = ["status"]
    search_fields = ["vendor_name", "service"]
    ordering = ["vendor_name"]
