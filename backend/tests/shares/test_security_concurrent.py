"""Concurrent max_views enforcement test (requires real transactions)."""
from concurrent.futures import ThreadPoolExecutor

import pytest
from django.utils import timezone

from apps.accounts.models import User
from apps.shares.models import SharePackage
from apps.shares.services import create_share, resolve_share


@pytest.mark.django_db(transaction=True)
def test_concurrent_max_views_atomic_enforcement():
    """Atomic conditional UPDATE prevents TOCTOU race on max_views.

    10 threads simultaneously resolve the same share with max_views=2.
    Exactly 2 should succeed; 8 should hit view_limit_exceeded (410).
    """
    user = User.objects.create_user(email="race@example.com", password="pw123")
    token, pkg = create_share(user, ["full_summary"])
    pkg.max_views = 2
    pkg.save()

    results = []

    def attempt():
        r = resolve_share(token, client_ip="1.1.1.1")
        results.append(r)

    with ThreadPoolExecutor(max_workers=10) as executor:
        futures = [executor.submit(attempt) for _ in range(10)]
        for f in futures:
            f.result()

    successful = [r for r in results if "items" in r]
    limited = [r for r in results if r.get("status") == 410]

    assert len(successful) == 2, f"Expected 2 successful, got {len(successful)}: {results}"
    assert len(limited) == 8, f"Expected 8 limited, got {len(limited)}"

    pkg.refresh_from_db()
    assert pkg.views_count == 2
