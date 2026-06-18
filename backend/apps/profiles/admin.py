from django.contrib import admin

from .models import UserProfile


@admin.register(UserProfile)
class UserProfileAdmin(admin.ModelAdmin):
    # first_name/last_name removed from list_display and search_fields to prevent
    # bulk PHI enumeration. Names are accessible in the detail view via readonly_fields.
    list_display = ["user", "onboarding_completed_at"]
    search_fields = ["user__email"]
    raw_id_fields = ["user"]
    readonly_fields = ["first_name", "last_name"]
