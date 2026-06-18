"""Test that verifies the empty type bug"""
import pytest
from django.contrib.auth import get_user_model
from django.utils import timezone
from apps.profiles.models import UserProfile

User = get_user_model()
PW = "Str0ngPass!23"

@pytest.fixture
def user(db):
    return User.objects.create_user(email="item@example.com", password=PW, email_verified_at=timezone.now())

@pytest.fixture
def client(api_client, user):
    api_client.force_authenticate(user=user)
    return api_client

@pytest.fixture
def profile_with_allergy(user):
    p = UserProfile.for_user(user)
    # Allergy without a type field (type is missing)
    p.allergies = [{"id": "ai_a1", "allergen": "Peanut", "reaction": "Hives"}]
    p.ai_backfill_meta = {"fields": {"allergies": {"added_keys": ["peanut"],
        "current_item_ids": ["ai_a1"]}}, "last_backfill_at": ""}
    p.save()
    return p

def test_edit_with_empty_type_string_should_fail(client, user, profile_with_allergy):
    """Reproduces the bug: sending type: '' should fail validation"""
    resp = client.patch("/api/profile/ai-items/ai_a1", 
                       {"reaction": "Urticaria", "type": ""}, 
                       format="json")
    assert resp.status_code == 400, f"Expected 400 but got {resp.status_code}: {resp.json()}"

def test_edit_with_valid_type_should_succeed(client, user, profile_with_allergy):
    """Control test: sending valid type should succeed"""
    resp = client.patch("/api/profile/ai-items/ai_a1", 
                       {"reaction": "Urticaria", "type": "allergy"}, 
                       format="json")
    assert resp.status_code == 200, f"Expected 200 but got {resp.status_code}: {resp.json()}"
