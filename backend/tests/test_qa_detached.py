"""Test to verify that _static_qa_context includes detached documents (BUG)."""
import pytest
from django.contrib.auth import get_user_model
from django.core.files.base import ContentFile
from django.core.files.storage import default_storage
from django.utils import timezone
import json

from apps.documents.models import Document
from apps.health import qa_views

User = get_user_model()

@pytest.fixture
def user(db):
    return User.objects.create_user(email='qa_detach_test@example.com', password='pw')

def test_static_qa_context_includes_detached_documents(user):
    """_static_qa_context should NOT include detached documents, but currently does."""
    
    # Create an active document with summary
    active_doc = Document.objects.create(
        user=user, 
        source_type='pdf', 
        status='processed',
        title='Active Document'
    )
    active_summary = {'key_facts': {'allergies': [{'substance': 'Penicillin'}]}}
    active_path = default_storage.save(
        f'documents/{user.id}/active_summary.json', 
        ContentFile(json.dumps(active_summary).encode())
    )
    active_doc.summary_path = active_path
    active_doc.save()
    
    # Create a detached document with summary (this SHOULD be filtered out)
    detached_doc = Document.objects.create(
        user=user, 
        source_type='pdf', 
        status='processed',
        title='Detached Document',
        detached_at=timezone.now()  # This marks it as detached
    )
    detached_summary = {'key_facts': {'allergies': [{'substance': 'Aspirin'}]}}
    detached_path = default_storage.save(
        f'documents/{user.id}/detached_summary.json', 
        ContentFile(json.dumps(detached_summary).encode())
    )
    detached_doc.summary_path = detached_path
    detached_doc.save()
    
    # Get context from _static_qa_context
    ctx = qa_views._static_qa_context(user)
    
    # The active document should be included
    assert 'Active Document' in ctx, "Active document should be in context"
    assert 'Penicillin' in ctx, "Penicillin from active doc should be in context"
    
    # The detached document should NOT be included (but the bug means it will be)
    assert 'Detached Document' not in ctx, "Detached document should NOT be in context"
    assert 'Aspirin' not in ctx, "Aspirin from detached doc should NOT be in context"
