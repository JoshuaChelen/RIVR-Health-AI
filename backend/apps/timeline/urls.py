from rest_framework.routers import SimpleRouter

from .views import TimelineEventViewSet

router = SimpleRouter()
router.register("timeline-events", TimelineEventViewSet, basename="timeline-event")

urlpatterns = router.urls
