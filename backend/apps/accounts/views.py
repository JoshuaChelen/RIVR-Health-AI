import hashlib

from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.utils import timezone
from rest_framework import status
from rest_framework.exceptions import APIException
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework_simplejwt.exceptions import TokenError
from rest_framework_simplejwt.tokens import AccessToken, RefreshToken
from rest_framework_simplejwt.views import TokenObtainPairView

from .emails import send_password_reset_email, send_verification_email
from .serializers import (
    EmailVerifySerializer,
    LoginSerializer,
    LogoutSerializer,
    PasswordChangeSerializer,
    PasswordForgotSerializer,
    PasswordResetSerializer,
    RegisterSerializer,
    UserSerializer,
)
from .tokens import read_email_verify_token, read_password_reset
from apps.common.ip import get_client_ip
from apps.common.throttles import LoginThrottle, PasswordResetThrottle, RegisterThrottle

User = get_user_model()

_LOGIN_MAX_FAILURES = 5
_LOGIN_LOCKOUT_DURATION = 60 * 15  # 15 min


def _login_cache_keys(email: str, client_ip: str) -> tuple[str, str]:
    h = hashlib.sha256(f"{email}:{client_ip}".encode()).hexdigest()
    return f"login_lock:{h}", f"login_fail:{h}"


def _tokens_for(user) -> dict:
    refresh = RefreshToken.for_user(user)
    return {"refresh": str(refresh), "access": str(refresh.access_token)}


class RegisterView(APIView):
    permission_classes = [AllowAny]
    throttle_classes = [RegisterThrottle]

    def post(self, request):
        serializer = RegisterSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        user = serializer.save()
        send_verification_email(user)
        return Response(
            {"user": UserSerializer(user).data, **_tokens_for(user)},
            status=status.HTTP_201_CREATED,
        )


class LoginView(TokenObtainPairView):
    permission_classes = [AllowAny]
    throttle_classes = [LoginThrottle]
    serializer_class = LoginSerializer

    def post(self, request, *args, **kwargs):
        email = (request.data.get("email") or "").strip().lower()
        lock_key, fail_key = _login_cache_keys(email, get_client_ip(request))

        if cache.get(lock_key):
            return Response(
                {"detail": "Account temporarily locked. Try again later."},
                status=status.HTTP_423_LOCKED,
            )

        try:
            response = super().post(request, *args, **kwargs)
        except APIException:
            failures = cache.get(fail_key, 0) + 1
            if failures >= _LOGIN_MAX_FAILURES:
                cache.set(lock_key, True, _LOGIN_LOCKOUT_DURATION)
                cache.delete(fail_key)
            else:
                cache.set(fail_key, failures, _LOGIN_LOCKOUT_DURATION)
            raise

        # Success — clear lockout state.
        cache.delete(lock_key)
        cache.delete(fail_key)
        return response


class MeView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        return Response(UserSerializer(request.user).data)


class LogoutView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        serializer = LogoutSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            RefreshToken(serializer.validated_data["refresh"]).blacklist()
        except TokenError:
            return Response({"detail": "Invalid token."}, status=status.HTTP_400_BAD_REQUEST)

        # Denylist the access token by JTI so it can't be used after logout.
        access_raw = serializer.validated_data.get("access")
        if access_raw:
            try:
                access = AccessToken(access_raw)
                jti = access["jti"]
                exp = access["exp"]
                ttl = max(0, exp - int(timezone.now().timestamp()))
                if ttl > 0:
                    cache.set(f"jwt_denylist:{jti}", True, ttl)
            except TokenError:
                pass  # Don't fail logout if access token is invalid

        return Response(status=status.HTTP_205_RESET_CONTENT)


class VerifyEmailView(APIView):
    permission_classes = [AllowAny]

    def post(self, request):
        serializer = EmailVerifySerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        user = read_email_verify_token(serializer.validated_data["token"])
        if user is None:
            return Response(
                {"detail": "Invalid or expired token."}, status=status.HTTP_400_BAD_REQUEST
            )
        if user.email_verified_at is None:
            user.email_verified_at = timezone.now()
            user.save(update_fields=["email_verified_at"])
        return Response({"detail": "Email verified."})


class PasswordForgotView(APIView):
    permission_classes = [AllowAny]
    throttle_classes = [PasswordResetThrottle]

    def post(self, request):
        serializer = PasswordForgotSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        email = serializer.validated_data["email"].strip().lower()
        user = User.objects.filter(email__iexact=email).first()
        if user is not None:
            # Re-arm the single-use marker so a user who already reset once can
            # reset again — read_password_reset() rejects any token while
            # password_reset_token_used_at is set.
            User.objects.filter(pk=user.pk).update(password_reset_token_used_at=None)
            send_password_reset_email(user)
        # Always 200 — never reveal whether the email is registered.
        return Response({"detail": "If that email exists, a reset link has been sent."})


class PasswordResetView(APIView):
    permission_classes = [AllowAny]
    throttle_classes = [PasswordResetThrottle]

    def post(self, request):
        serializer = PasswordResetSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        user = read_password_reset(
            serializer.validated_data["uid"], serializer.validated_data["token"]
        )
        if user is None:
            return Response(
                {"detail": "Invalid or expired token."}, status=status.HTTP_400_BAD_REQUEST
            )
        # Atomically claim the token BEFORE changing the password so two
        # concurrent requests with the same token can't both reset it (TOCTOU).
        claimed = User.objects.filter(
            pk=user.pk, password_reset_token_used_at__isnull=True
        ).update(password_reset_token_used_at=timezone.now())
        if claimed != 1:
            return Response(
                {"detail": "Invalid or expired token."}, status=status.HTTP_400_BAD_REQUEST
            )
        user.set_password(serializer.validated_data["password"])
        user.save(update_fields=["password"])
        return Response({"detail": "Password updated."})


class PasswordChangeView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        serializer = PasswordChangeSerializer(
            data=request.data, context={"request": request}
        )
        serializer.is_valid(raise_exception=True)
        request.user.set_password(serializer.validated_data["new_password"])
        request.user.save(update_fields=["password"])
        return Response({"detail": "Password changed."})


class ResendVerificationView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        if request.user.email_verified_at is not None:
            return Response({"detail": "Email already verified."})
        send_verification_email(request.user)
        return Response({"detail": "Verification email sent."})
