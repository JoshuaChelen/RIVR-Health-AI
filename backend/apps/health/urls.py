from django.urls import path
from rest_framework.routers import SimpleRouter

from .views import HealthEvaluationViewSet, MyHealthProfileView

router = SimpleRouter()
router.register("health-evaluations", HealthEvaluationViewSet, basename="health-evaluation")

urlpatterns = [
    path("health-profile", MyHealthProfileView.as_view(), name="my-health-profile"),
    *router.urls,
]
