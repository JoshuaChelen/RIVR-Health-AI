const READ_PERMISSION_KEYS = [
  "HeartRate",
  "SleepAnalysis",
  "StepCount",
  "DistanceWalkingRunning",
  "ActiveEnergyBurned",
] as const;

type HealthKitConstantsLike = {
  Permissions?: Partial<Record<(typeof READ_PERMISSION_KEYS)[number], string>>;
} | null | undefined;

export type HealthKitPermissionsPayload = {
  permissions: {
    read: string[];
    write: string[];
  };
};

export function hasRequiredHealthKitPermissionConstants(
  constants: HealthKitConstantsLike
): boolean {
  return READ_PERMISSION_KEYS.every((key) => {
    const value = constants?.Permissions?.[key];
    return typeof value === "string" && value.length > 0;
  });
}

export function buildHealthKitPermissions(
  constants: HealthKitConstantsLike
): HealthKitPermissionsPayload {
  return {
    permissions: {
      read: READ_PERMISSION_KEYS
        .map((key) => constants?.Permissions?.[key])
        .filter((value): value is string => typeof value === "string" && value.length > 0),
      write: [],
    },
  };
}

export function formatHealthKitError(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return conciseHealthKitMessage(error.message);
  }

  if (typeof error === "string") {
    return conciseHealthKitMessage(error);
  }

  if (error && typeof error === "object") {
    const { message, localizedDescription, domain, code } = error as {
      message?: unknown;
      localizedDescription?: unknown;
      domain?: unknown;
      code?: unknown;
    };
    const nativeMessage = [message, localizedDescription].find(
      (value): value is string => typeof value === "string" && value.trim().length > 0
    );
    if (nativeMessage) return conciseHealthKitMessage(nativeMessage);

    const details = [domain, code]
      .filter((value): value is string | number => {
        return (
          (typeof value === "string" && value.trim().length > 0) ||
          typeof value === "number"
        );
      })
      .map((value) => String(value).trim())
      .join(" ");
    if (details.length > 0) return details;
  }

  return "Unknown HealthKit error";
}

function conciseHealthKitMessage(message: string): string {
  const trimmed = message.trim();
  if (trimmed.length === 0) return "Unknown HealthKit error";

  const localized = trimmed.match(/NSLocalizedDescription=([^}]+)/);
  if (localized?.[1]) return localized[1].trim();

  return trimmed;
}
