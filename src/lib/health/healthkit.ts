// Platform fallback for health data (web and any non-iOS/Android target).
//
// This file is what Metro resolves for `import ... from "./healthkit"` only
// when there is no platform-specific match, and — importantly — it is the
// module TypeScript resolves for the extensionless import, so its signatures
// define the shared contract. healthkit.ios.ts / healthkit.android.ts override
// it at runtime on their platforms.
import type {
  AppleHealthSnapshot,
  HealthAvailabilityResult,
  HealthLinkResult,
} from "./types";

export type {
  AppleHealthSnapshot,
  DailyDataPoint,
  HealthAvailabilityResult,
  HealthLinkResult,
} from "./types";

const UNSUPPORTED = "Health data isn't available on this platform.";

export async function getHealthAvailability(): Promise<HealthAvailabilityResult> {
  return { ok: false, error: UNSUPPORTED };
}

export async function linkAppleHealth(): Promise<HealthLinkResult> {
  return { ok: false, unsupported: true, error: UNSUPPORTED };
}

export async function getAppleHealthSnapshot(): Promise<AppleHealthSnapshot> {
  return {
    fetchedAt: new Date(),
    heartRate: null,
    sleepAvgMin: null,
    stepsAvg7d: null,
    walkingRunningDistanceAvg7dMiles: null,
    activeEnergyAvg7dKcal: null,
    hrvMsRecent: null,
    weightLbRecent: null,
    bloodPressureRecent: null,
    stepsTrend7d: [],
    sleepTrend7d: [],
    heartRateTrend: [],
  };
}

export async function openHealthSettings(): Promise<void> {
  // no-op on unsupported platforms
}
