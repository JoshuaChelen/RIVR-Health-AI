from django.urls import path
from rest_framework_simplejwt.views import TokenRefreshView

from . import views

urlpatterns = [
    path("register", views.RegisterView.as_view(), name="register"),
    path("login", views.LoginView.as_view(), name="login"),
    path("token/refresh", TokenRefreshView.as_view(), name="token-refresh"),
    path("logout", views.LogoutView.as_view(), name="logout"),
    path("me", views.MeView.as_view(), name="me"),
    path("verify-email", views.VerifyEmailView.as_view(), name="verify-email"),
    path("password/forgot", views.PasswordForgotView.as_view(), name="password-forgot"),
    path("password/reset", views.PasswordResetView.as_view(), name="password-reset"),
    path("password/change", views.PasswordChangeView.as_view(), name="password-change"),
]
