import { describe, expect, it } from "vitest";

import {
  buildHealthKitPermissions,
  hasRequiredHealthKitPermissionConstants,
} from "./healthkitPermissions";

describe("HealthKit permission helpers", () => {
  const constants = {
    Permissions: {
      HeartRate: "HeartRate",
      SleepAnalysis: "SleepAnalysis",
      StepCount: "StepCount",
      DistanceWalkingRunning: "DistanceWalkingRunning",
      ActiveEnergyBurned: "ActiveEnergyBurned",
    },
  };

  it("builds read-only HealthKit permissions lazily from native constants", () => {
    expect(buildHealthKitPermissions(constants)).toEqual({
      permissions: {
        read: [
          "HeartRate",
          "SleepAnalysis",
          "StepCount",
          "DistanceWalkingRunning",
          "ActiveEnergyBurned",
        ],
        write: [],
      },
    });
  });

  it("detects missing native HealthKit permission constants", () => {
    expect(hasRequiredHealthKitPermissionConstants(constants)).toBe(true);
    expect(hasRequiredHealthKitPermissionConstants(null)).toBe(false);
    expect(hasRequiredHealthKitPermissionConstants({ Permissions: {} })).toBe(false);
  });
});
