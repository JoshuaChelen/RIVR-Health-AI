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
