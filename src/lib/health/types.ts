// Shared, platform-neutral health types.
//
// The per-platform implementations all satisfy this same contract so the rest
// of the app stays platform-agnostic:
//   - healthkit.ios.ts      → Apple HealthKit (react-native-health)
//   - healthkit.android.ts  → Android Health Connect (react-native-health-connect)
//   - healthkit.ts          → web / unsupported fallback (and the TS resolution
//                             target for the extensionless `./healthkit` import)

export type HealthAvailabilityResult = { ok: boolean; error?: string };

export type HealthLinkResult = {
  ok: boolean;
  error?: string;
  // True when the failure is that the platform/device cannot provide health
  // data at all (no HealthKit / Health Connect unavailable), as opposed to the
  // user declining permission. Lets callers show an "unsupported" state instead
  // of a retryable "connect" prompt.
  unsupported?: boolean;
};

export type DailyDataPoint = {
  date: string; // YYYY-MM-DD
  value: number;
};

export type AppleHealthSnapshot = {
  fetchedAt: Date;
  heartRate: number | null; // integer bpm, latest
  sleepAvgMin: number | null; // minutes, 7-day average
  stepsAvg7d: number | null; // integer steps, 7-day average
  walkingRunningDistanceAvg7dMiles: number | null; // miles, 7-day average
  activeEnergyAvg7dKcal: number | null; // kcal, 7-day average
  hrvMsRecent: number | null; // milliseconds, latest (iOS: SDNN, Android: RMSSD)
  weightLbRecent: number | null; // pounds, latest
  bloodPressureRecent: { systolic: number; diastolic: number } | null; // mmHg
  stepsTrend7d: DailyDataPoint[]; // ascending by date
  sleepTrend7d: DailyDataPoint[]; // ascending by date
  heartRateTrend: DailyDataPoint[]; // chronological
};
