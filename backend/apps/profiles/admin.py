from django.contrib import admin

from .models import UserProfile


@admin.register(UserProfile)
class UserProfileAdmin(admin.ModelAdmin):
    list_display = ["user", "first_name", "last_name", "onboarding_completed_at"]
    search_fields = ["user__email", "first_name", "last_name"]
    raw_id_fields = ["user"]
