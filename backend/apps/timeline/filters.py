from django_filters import rest_framework as filters

from .models import TimelineEvent


class TimelineEventFilter(filters.FilterSet):
    source = filters.CharFilter(field_name="source", lookup_expr="iexact")
    exclude_source = filters.CharFilter(field_name="source", exclude=True)
    included_in_previsit = filters.BooleanFilter(field_name="included_in_previsit")
    document = filters.UUIDFilter(field_name="document_id")

    class Meta:
        model = TimelineEvent
        fields: list[str] = []
