import { describe, expect, it } from "vitest";

import {
  buildHealthKitPermissions,
  formatHealthKitError,
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

  it("formats object-shaped native errors without exposing object placeholders", () => {
    expect(formatHealthKitError({ message: "Authorization denied" })).toBe(
      "Authorization denied"
    );
    expect(formatHealthKitError({ code: "HKDenied", domain: "HealthKit" })).toBe(
      "HealthKit HKDenied"
    );
    expect(formatHealthKitError({})).toBe("Unknown HealthKit error");
  });

  it("extracts localized HealthKit descriptions from native error strings", () => {
    expect(
      formatHealthKitError(
        'Error with HealthKit authorization: Error Domain=com.apple.healthkit Code=4 ""Missing com.apple.developer.healthkit entitlement."" UserInfo={NSLocalizedDescription=Missing com.apple.developer.healthkit entitlement.}'
      )
    ).toBe("Missing com.apple.developer.healthkit entitlement.");
  });
});
