from uuid import UUID

from django_filters import rest_framework as filters

from .models import AiJob


class AiJobFilter(filters.FilterSet):
    status = filters.CharFilter(field_name="status", lookup_expr="iexact")
    status__in = filters.BaseInFilter(field_name="status", lookup_expr="in")
    job_type = filters.CharFilter(field_name="job_type", lookup_expr="iexact")
    contains_document_id = filters.CharFilter(method="filter_contains_document")

    class Meta:
        model = AiJob
        fields: list[str] = []

    def filter_contains_document(self, queryset, name, value):
        try:
            doc_id = UUID(str(value))
        except (TypeError, ValueError):
            return queryset.none()
        return queryset.filter(document_ids__contains=[doc_id])
