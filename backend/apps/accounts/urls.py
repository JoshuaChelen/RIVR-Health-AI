from django.urls import path
from rest_framework_simplejwt.views import TokenRefreshView

from . import views
from .consent_views import ConsentStatusView, ConsentWithdrawView
from .export_views import (
    AccountDeletionConfirmView,
    AccountDeletionRequestView,
    DataExportRequestView,
    DataExportStatusView,
)

urlpatterns = [
    path("register", views.RegisterView.as_view(), name="register"),
    path("login", views.LoginView.as_view(), name="login"),
    path("token/refresh", TokenRefreshView.as_view(), name="token-refresh"),
    path("logout", views.LogoutView.as_view(), name="logout"),
    path("me", views.MeView.as_view(), name="me"),
    path("verify-email", views.VerifyEmailView.as_view(), name="verify-email"),
    path("verify-email/resend", views.ResendVerificationView.as_view(), name="verify-email-resend"),
    path("password/forgot", views.PasswordForgotView.as_view(), name="password-forgot"),
    path("password/reset", views.PasswordResetView.as_view(), name="password-reset"),
    path("password/change", views.PasswordChangeView.as_view(), name="password-change"),
    # Consent (GDPR/CCPA) — Task 5
    path("consent/status", ConsentStatusView.as_view(), name="consent-status"),
    path("consent/withdraw", ConsentWithdrawView.as_view(), name="consent-withdraw"),
    # Data export — Task 6
    path("me/export/request", DataExportRequestView.as_view(), name="export-request"),
    path("me/export/status/<uuid:export_id>", DataExportStatusView.as_view(), name="export-status"),
    # Account deletion with 7-day cooldown — Task 6
    path("me/delete/request", AccountDeletionRequestView.as_view(), name="deletion-request"),
    path("me/delete/confirm", AccountDeletionConfirmView.as_view(), name="deletion-confirm"),
]
