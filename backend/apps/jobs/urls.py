from rest_framework.routers import SimpleRouter

from .views import AiJobViewSet

router = SimpleRouter()
router.register("ai-jobs", AiJobViewSet, basename="ai-job")

urlpatterns = router.urls
