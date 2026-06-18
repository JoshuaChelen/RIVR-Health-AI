"""Custom JWT authentication that checks a cache-based access-token denylist."""
from django.core.cache import cache
from rest_framework_simplejwt.authentication import JWTAuthentication as _JWTAuthentication
from rest_framework_simplejwt.exceptions import InvalidToken


class JWTAuthentication(_JWTAuthentication):
    """Drop-in replacement that rejects tokens whose JTI is in the denylist cache."""

    def get_validated_token(self, raw_token):
        token = super().get_validated_token(raw_token)
        jti = token.get("jti")
        if jti and cache.get(f"jwt_denylist:{jti}"):
            raise InvalidToken("Token has been revoked.")
        return token
