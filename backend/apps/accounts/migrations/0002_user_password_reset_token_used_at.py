from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('accounts', '0001_initial'),
    ]

    operations = [
        migrations.AddField(
            model_name='user',
            name='password_reset_token_used_at',
            field=models.DateTimeField(blank=True, null=True),
        ),
    ]
