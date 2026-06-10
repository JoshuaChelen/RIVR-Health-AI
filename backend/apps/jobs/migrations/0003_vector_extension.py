from django.db import migrations
from pgvector.django import VectorExtension


class Migration(migrations.Migration):
    dependencies = [("jobs", "0002_alter_aijob_status")]
    operations = [VectorExtension()]
