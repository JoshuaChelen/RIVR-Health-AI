from django.contrib import admin
from django.contrib.auth.admin import UserAdmin as DjangoUserAdmin

from .models import User


@admin.register(User)
class UserAdmin(DjangoUserAdmin):
    ordering = ["-date_joined"]
    list_display = ["email", "is_active", "is_staff", "email_verified_at", "date_joined"]
    search_fields = ["email"]
    readonly_fields = ["id", "date_joined", "last_login"]
    fieldsets = (
        (None, {"fields": ("id", "email", "password")}),
        ("Status", {"fields": ("is_active", "email_verified_at")}),
        ("Permissions", {"fields": ("is_staff", "is_superuser", "groups", "user_permissions")}),
        ("Dates", {"fields": ("last_login", "date_joined")}),
    )
    add_fieldsets = (
        (None, {"classes": ("wide",), "fields": ("email", "password1", "password2")}),
    )
