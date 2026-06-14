// Android health implementation via Android Health Connect.
//
// Samsung Health (and Fitbit, Google Fit, etc.) sync their data into Health
// Connect, so reading from here surfaces the user's Samsung Health vitals.
// This file satisfies the same contract as healthkit.ios.ts (see ./types) and
// is the module Metro resolves for `import ... from "../lib/health/healthkit"`
// on Android. The react-native-health-connect import only loads on Android.
import {
  aggregateGroupByDuration,
  getSdkStatus,
  initialize,
  openHealthConnectSettings,
  readRecords,
  requestPermission,
  SdkAvailabilityStatus,
  type Permission,
} from "react-native-health-connect";

import { formatHealthKitError } from "./healthkitPermissions";
import type {
  AppleHealthSnapshot,
  DailyDataPoint,
  HealthAvailabilityResult,
  HealthLinkResult,
} from "./types";

export type {
  AppleHealthSnapshot,
  DailyDataPoint,
  HealthAvailabilityResult,
  HealthLinkResult,
} from "./types";

const METERS_PER_MILE = 1609.344;
const KG_TO_LB = 2.2046226218;

// Read-only access to the metrics that map onto AppleHealthSnapshot.
const READ_PERMISSIONS: Permission[] = [
  "HeartRate",
  "SleepSession",
  "Steps",
  "Distance",
  "ActiveCaloriesBurned",
  "HeartRateVariabilityRmssd",
  "Weight",
  "BloodPressure",
].map((recordType) => ({ accessType: "read", recordType }) as Permission);

function nowIso(): string {
  return new Date().toISOString();
}

function daysAgoIso(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString();
}

// "between" window ending now, starting `days` ago.
function window(days: number) {
  return { operator: "between" as const, startTime: daysAgoIso(days), endTime: nowIso() };
}

// Run a read and swallow per-metric failures (e.g. a single permission the user
// declined) so one missing metric never blanks the whole snapshot.
async function safe<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn();
  } catch {
    return fallback;
  }
}

// ─── Availability & permissions ────────────────────────────────────────────

export async function getHealthAvailability(): Promise<HealthAvailabilityResult> {
  try {
    const status = await getSdkStatus();
    if (status === SdkAvailabilityStatus.SDK_UNAVAILABLE_PROVIDER_UPDATE_REQUIRED) {
      return {
        ok: false,
        error: "Health Connect needs to be updated in the Play Store before RIVR can read your data.",
      };
    }
    if (status !== SdkAvailabilityStatus.SDK_AVAILABLE) {
      return {
        ok: false,
        error:
          "Health Connect isn't available on this device. On Android 13 and below, install it from the Play Store.",
      };
    }
    const ready = await initialize();
    if (!ready) {
      return { ok: false, error: "Health Connect could not be initialized on this device." };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: formatHealthKitError(e) };
  }
}

export async function linkAppleHealth(): Promise<HealthLinkResult> {
  const availability = await getHealthAvailability();
  if (!availability.ok) {
    // Device/platform can't provide the data at all → unsupported, not retryable.
    return { ok: false, unsupported: true, error: availability.error };
  }

  try {
    // requestPermission shows the system Health Connect consent UI and resolves
    // to the subset actually granted.
    const granted = await requestPermission(READ_PERMISSIONS);
    if (!granted || granted.length === 0) {
      return {
        ok: false,
        error: "Health Connect access wasn't granted. Allow RIVR to read your health data to continue.",
      };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: formatHealthKitError(e) };
  }
}

export async function openHealthSettings(): Promise<void> {
  try {
    await openHealthConnectSettings();
  } catch {
    // best-effort
  }
}

// ─── Per-metric reads ───────────────────────────────────────────────────────

async function getHeartRate(): Promise<{ latest: number | null; trend: DailyDataPoint[] }> {
  const latest = await safe(async () => {
    const { records } = await readRecords("HeartRate", {
      timeRangeFilter: window(7),
      ascendingOrder: false,
      pageSize: 100,
    });
    let best: { time: string; bpm: number } | null = null;
    for (const r of records) {
      for (const s of r.samples ?? []) {
        if (!best || s.time > best.time) best = { time: s.time, bpm: s.beatsPerMinute };
      }
    }
    return best ? Math.round(best.bpm) : null;
  }, null as number | null);

  const trend = await safe(async () => {
    const groups = await aggregateGroupByDuration({
      recordType: "HeartRate",
      timeRangeFilter: window(7),
      timeRangeSlicer: { duration: "DAYS", length: 1 },
    });
    return groups
      .map((g) => ({ date: g.startTime.slice(0, 10), value: Math.round(g.result.BPM_AVG ?? 0) }))
      .filter((p) => p.value > 0);
  }, [] as DailyDataPoint[]);

  return { latest, trend };
}

async function getSteps(): Promise<{ avg: number | null; trend: DailyDataPoint[] }> {
  const trend = await safe(async () => {
    const groups = await aggregateGroupByDuration({
      recordType: "Steps",
      timeRangeFilter: window(7),
      timeRangeSlicer: { duration: "DAYS", length: 1 },
    });
    return groups
      .map((g) => ({ date: g.startTime.slice(0, 10), value: Math.round(g.result.COUNT_TOTAL ?? 0) }))
      .filter((p) => p.value > 0);
  }, [] as DailyDataPoint[]);
  const avg = trend.length
    ? Math.round(trend.reduce((s, p) => s + p.value, 0) / trend.length)
    : null;
  return { avg, trend };
}

async function getSleep(): Promise<{ avgMin: number | null; trend: DailyDataPoint[] }> {
  const trend = await safe(async () => {
    const groups = await aggregateGroupByDuration({
      recordType: "SleepSession",
      timeRangeFilter: window(7),
      timeRangeSlicer: { duration: "DAYS", length: 1 },
    });
    // SLEEP_DURATION_TOTAL is in seconds.
    return groups
      .map((g) => ({ date: g.startTime.slice(0, 10), value: Math.round((g.result.SLEEP_DURATION_TOTAL ?? 0) / 60) }))
      .filter((p) => p.value > 0);
  }, [] as DailyDataPoint[]);
  const avgMin = trend.length
    ? Math.round(trend.reduce((s, p) => s + p.value, 0) / trend.length)
    : null;
  return { avgMin, trend };
}

async function getDistanceAvgMiles(): Promise<number | null> {
  return safe(async () => {
    const groups = await aggregateGroupByDuration({
      recordType: "Distance",
      timeRangeFilter: window(7),
      timeRangeSlicer: { duration: "DAYS", length: 1 },
    });
    const perDayMiles = groups
      .map((g) => (g.result.DISTANCE?.inMeters ?? 0) / METERS_PER_MILE)
      .filter((m) => m > 0);
    if (!perDayMiles.length) return null;
    return Number((perDayMiles.reduce((s, m) => s + m, 0) / perDayMiles.length).toFixed(2));
  }, null as number | null);
}

async function getActiveEnergyAvgKcal(): Promise<number | null> {
  return safe(async () => {
    const groups = await aggregateGroupByDuration({
      recordType: "ActiveCaloriesBurned",
      timeRangeFilter: window(7),
      timeRangeSlicer: { duration: "DAYS", length: 1 },
    });
    const perDayKcal = groups
      .map((g) => g.result.ACTIVE_CALORIES_TOTAL?.inKilocalories ?? 0)
      .filter((k) => k > 0);
    if (!perDayKcal.length) return null;
    return Math.round(perDayKcal.reduce((s, k) => s + k, 0) / perDayKcal.length);
  }, null as number | null);
}

// HRV: Health Connect exposes RMSSD only and it is NOT aggregatable, so read the
// latest raw record. heartRateVariabilityMillis is already in ms (do not ×1000).
// Note: iOS reports SDNN, Android RMSSD — same field, different HRV metric.
async function getHrvMsRecent(): Promise<number | null> {
  return safe(async () => {
    const { records } = await readRecords("HeartRateVariabilityRmssd", {
      timeRangeFilter: window(7),
      ascendingOrder: false,
      pageSize: 1,
    });
    const r = records[0];
    return r ? Math.round(r.heartRateVariabilityMillis) : null;
  }, null as number | null);
}

async function getWeightLbRecent(): Promise<number | null> {
  return safe(async () => {
    const { records } = await readRecords("Weight", {
      timeRangeFilter: window(365),
      ascendingOrder: false,
      pageSize: 1,
    });
    const r = records[0];
    return r ? Number((r.weight.inKilograms * KG_TO_LB).toFixed(1)) : null;
  }, null as number | null);
}

async function getBloodPressureRecent(): Promise<{ systolic: number; diastolic: number } | null> {
  return safe(async () => {
    const { records } = await readRecords("BloodPressure", {
      timeRangeFilter: window(90),
      ascendingOrder: false,
      pageSize: 1,
    });
    const r = records[0];
    if (!r) return null;
    return {
      systolic: Math.round(r.systolic.inMillimetersOfMercury),
      diastolic: Math.round(r.diastolic.inMillimetersOfMercury),
    };
  }, null as { systolic: number; diastolic: number } | null);
}

// ─── Snapshot ─────────────────────────────────────────────────────────────

export async function getAppleHealthSnapshot(): Promise<AppleHealthSnapshot> {
  const fetchedAt = new Date();

  const [hr, steps, sleep, distance, energy, hrv, weight, bp] = await Promise.all([
    getHeartRate(),
    getSteps(),
    getSleep(),
    getDistanceAvgMiles(),
    getActiveEnergyAvgKcal(),
    getHrvMsRecent(),
    getWeightLbRecent(),
    getBloodPressureRecent(),
  ]);

  return {
    fetchedAt,
    heartRate: hr.latest,
    sleepAvgMin: sleep.avgMin,
    stepsAvg7d: steps.avg,
    walkingRunningDistanceAvg7dMiles: distance,
    activeEnergyAvg7dKcal: energy,
    hrvMsRecent: hrv,
    weightLbRecent: weight,
    bloodPressureRecent: bp,
    stepsTrend7d: steps.trend,
    sleepTrend7d: sleep.trend,
    heartRateTrend: hr.trend,
  };
}
