from django.urls import path
from rest_framework.routers import SimpleRouter

from .views import AiJobViewSet, EnqueueView

router = SimpleRouter()
router.register("ai-jobs", AiJobViewSet, basename="ai-job")

urlpatterns = [
    path("jobs/enqueue", EnqueueView.as_view(), name="enqueue"),
    *router.urls,
]
