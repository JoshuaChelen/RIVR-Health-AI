"""Rate limiting throttles for abuse prevention."""
from rest_framework.throttling import AnonRateThrottle, UserRateThrottle


class RegisterThrottle(AnonRateThrottle):
    scope = 'register'


class LoginThrottle(AnonRateThrottle):
    scope = 'login'


class PasswordResetThrottle(AnonRateThrottle):
    scope = 'password_reset'


class UploadThrottle(UserRateThrottle):
    scope = 'upload'


class QAThrottle(UserRateThrottle):
    scope = 'qa_calls'
