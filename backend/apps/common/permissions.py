from rest_framework.permissions import BasePermission


class IsOwner(BasePermission):
    """Object-level ownership check (defence in depth on top of queryset scoping)."""

    owner_field = "user"

    def has_object_permission(self, request, view, obj) -> bool:
        owner_field = getattr(view, "owner_field", self.owner_field)
        return getattr(obj, f"{owner_field}_id", None) == request.user.id
