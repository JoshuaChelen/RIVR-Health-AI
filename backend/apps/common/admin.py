"""Reusable admin mixins for PHI access control and read-only models."""


class PHIAccessControlMixin:
    """Restrict admin access to PHI-bearing models by user group.

    superuser and the "clinician" group get full access; "auditor", "support",
    and any unrecognized group get an empty queryset and no write permissions.
    """

    def _has_phi_access(self, request) -> bool:
        user = request.user
        if user.is_superuser:
            return True
        return user.groups.filter(name="clinician").exists()

    def get_queryset(self, request):
        qs = super().get_queryset(request)
        if self._has_phi_access(request):
            return qs
        return qs.none()

    def has_add_permission(self, request):
        return self._has_phi_access(request)

    def has_change_permission(self, request, obj=None):
        return self._has_phi_access(request)

    def has_delete_permission(self, request, obj=None):
        return self._has_phi_access(request)


class ReadOnlyMixin:
    """Block all write operations in the admin (view-only model)."""

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False

    def has_delete_permission(self, request, obj=None):
        return False
