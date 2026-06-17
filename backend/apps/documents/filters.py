from django_filters import rest_framework as filters

from .models import Document


class DocumentFilter(filters.FilterSet):
    status = filters.CharFilter(field_name="status", lookup_expr="iexact")
    title = filters.CharFilter(field_name="title", lookup_expr="iexact")
    status__in = filters.BaseInFilter(field_name="status", lookup_expr="in")
    exclude_status = filters.CharFilter(field_name="status", exclude=True)
    source_type = filters.CharFilter(field_name="source_type", lookup_expr="iexact")
    has_processed_at = filters.BooleanFilter(
        field_name="processed_at", lookup_expr="isnull", exclude=True
    )
    detached = filters.BooleanFilter(field_name="detached_at", lookup_expr="isnull", exclude=True)

    class Meta:
        model = Document
        fields: list[str] = []
