from django.urls import path
from rest_framework.routers import SimpleRouter

from .qa_views import QAView
from .views import HealthEvaluationViewSet, MyHealthProfileView

router = SimpleRouter()
router.register("health-evaluations", HealthEvaluationViewSet, basename="health-evaluation")

urlpatterns = [
    path("health-profile", MyHealthProfileView.as_view(), name="my-health-profile"),
    path("qa", QAView.as_view(), name="qa"),
    *router.urls,
]
