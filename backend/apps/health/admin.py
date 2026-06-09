from django.contrib import admin

from .models import HealthEvaluation, HealthProfile


@admin.register(HealthProfile)
class HealthProfileAdmin(admin.ModelAdmin):
    list_display = ["user", "score", "score_label", "version", "updated_at"]
    search_fields = ["user__email"]
    raw_id_fields = ["user"]


@admin.register(HealthEvaluation)
class HealthEvaluationAdmin(admin.ModelAdmin):
    list_display = ["id", "user", "score", "created_at"]
    search_fields = ["user__email"]
    raw_id_fields = ["user"]
