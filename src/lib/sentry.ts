import * as Sentry from "@sentry/react-native";

const dsn = process.env.EXPO_PUBLIC_SENTRY_DSN || "";
if (dsn) {
  Sentry.init({
    dsn,
    enabled: !__DEV__,
    tracesSampleRate: 0.2,
    environment: __DEV__ ? "development" : "production",
  });
}

export function captureException(error: unknown) {
  Sentry.captureException(error);
}

export function captureMessage(message: string, level?: "fatal" | "error" | "warning" | "log" | "debug" | "info") {
  Sentry.captureMessage(message, level);
}

export function setUser(user: { id: string; email?: string } | null) {
  Sentry.setUser(user);
}

export { Sentry };