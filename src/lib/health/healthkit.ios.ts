import { Platform } from "react-native";
import AppleHealthKit, { HealthKitPermissions } from "react-native-health";

export type HealthAvailabilityResult = {
  ok: boolean;
  error?: string;
};

export type DailyDataPoint = {
  date: string; // YYYY-MM-DD
  value: number;
};

export type AppleHealthSnapshot = {
  fetchedAt: Date;
  heartRate: number | null;
  sleepAvgMin: number | null;
  stepsAvg7d: number | null;
  walkingRunningDistanceAvg7dMiles: number | null;
  activeEnergyAvg7dKcal: number | null;
  // Trend arrays for charts
  stepsTrend7d: DailyDataPoint[];
  sleepTrend7d: DailyDataPoint[];
  heartRateTrend: DailyDataPoint[];
};

const permissions: HealthKitPermissions = {
  permissions: {
    read: [
      AppleHealthKit.Constants.Permissions.HeartRate,
      AppleHealthKit.Constants.Permissions.SleepAnalysis,
      AppleHealthKit.Constants.Permissions.StepCount,
      AppleHealthKit.Constants.Permissions.DistanceWalkingRunning,
      AppleHealthKit.Constants.Permissions.ActiveEnergyBurned,
    ],
    write: [],
  },
};

function hasHealthKitModule(): boolean {
  return (
    Platform.OS === "ios" &&
    AppleHealthKit != null &&
    typeof (AppleHealthKit as any).isAvailable === "function" &&
    typeof (AppleHealthKit as any).initHealthKit === "function"
  );
}

function extractNumericValues(input: unknown): number[] {
  if (input == null) return [];

  if (Array.isArray(input)) {
    return input.flatMap((item) => extractNumericValues(item));
  }

  if (typeof input === "object") {
    const maybeValue = (input as { value?: unknown }).value;
    if (maybeValue != null) {
      const n = Number(maybeValue);
      return Number.isFinite(n) ? [n] : [];
    }
    return [];
  }

  const n = Number(input);
  return Number.isFinite(n) ? [n] : [];
}

function daysAgo(count: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - count);
  return d;
}

export async function getHealthAvailability(): Promise<HealthAvailabilityResult> {
  if (Platform.OS !== "ios") {
    return { ok: false, error: "Apple Health is only available on iPhone." };
  }

  if (!hasHealthKitModule()) {
    return {
      ok: false,
      error:
        "HealthKit native module is missing from this build. Rebuild the iOS app with: npx expo prebuild -p ios && npx expo run:ios --device",
    };
  }

  return await new Promise<HealthAvailabilityResult>((resolve) => {
    AppleHealthKit.isAvailable((err: any, available: boolean) => {
      if (err) {
        resolve({
          ok: false,
          error: `HealthKit availability check failed: ${String(err)}`,
        });
        return;
      }

      if (!available) {
        resolve({
          ok: false,
          error:
            "HealthKit reported that it is unavailable on this device or build.",
        });
        return;
      }

      resolve({ ok: true });
    });
  });
}

export async function isHealthAvailable(): Promise<boolean> {
  const result = await getHealthAvailability();
  return result.ok;
}

export async function linkAppleHealth(): Promise<{ ok: boolean; error?: string }> {
  const availability = await getHealthAvailability();
  if (!availability.ok) {
    return { ok: false, error: availability.error };
  }

  return await new Promise((resolve) => {
    AppleHealthKit.initHealthKit(permissions, (err: any) => {
      if (err) {
        resolve({
          ok: false,
          error: `HealthKit authorization failed: ${String(err)}`,
        });
        return;
      }

      resolve({ ok: true });
    });
  });
}

export async function getLatestHeartRateBpm(): Promise<number | null> {
  if (!hasHealthKitModule()) return null;

  const endDate = new Date().toISOString();
  const startDate = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  return await new Promise((resolve) => {
    AppleHealthKit.getHeartRateSamples(
      { startDate, endDate, limit: 1, ascending: false },
      (err: any, results: any[]) => {
        if (err || !results?.length) return resolve(null);
        resolve(Math.round(Number(results[0].value)));
      }
    );
  });
}

export async function getSleepAvgLast7DaysMinutes(): Promise<number | null> {
  if (!hasHealthKitModule()) return null;

  const end = new Date();
  const start = new Date();
  start.setDate(end.getDate() - 7);

  return await new Promise((resolve) => {
    AppleHealthKit.getSleepSamples(
      { startDate: start.toISOString(), endDate: end.toISOString() },
      (err: any, results: any[]) => {
        if (err || !results?.length) return resolve(null);

        const asleep = results.filter((r: any) =>
          String(r.value || "").toLowerCase().includes("asleep")
        );
        const picked = asleep.length ? asleep : results;

        const totalMs = picked.reduce((sum: number, r: any) => {
          return (
            sum +
            (new Date(r.endDate).getTime() - new Date(r.startDate).getTime())
          );
        }, 0);

        resolve(Math.round(totalMs / 7 / 60000));
      }
    );
  });
}

export async function getStepsAvg7Days(): Promise<number | null> {
  if (!hasHealthKitModule()) return null;

  const startDate = daysAgo(6).toISOString();
  const endDate = new Date().toISOString();

  return await new Promise((resolve) => {
    AppleHealthKit.getDailyStepCountSamples(
      { startDate, endDate },
      (err: any, results: any[]) => {
        if (err || !results?.length) return resolve(null);

        const values = results
          .map((r: any) => Number(r?.value))
          .filter((n: number) => Number.isFinite(n));

        if (!values.length) return resolve(null);

        const avg = values.reduce((sum: number, n: number) => sum + n, 0) / values.length;
        resolve(Math.round(avg));
      }
    );
  });
}

export async function getWalkingRunningDistanceAvg7dMiles(): Promise<number | null> {
  if (!hasHealthKitModule()) return null;

  const startDate = daysAgo(6).toISOString();
  const endDate = new Date().toISOString();

  return await new Promise((resolve) => {
    AppleHealthKit.getDailyDistanceWalkingRunningSamples(
      {
        startDate,
        endDate,
        unit: AppleHealthKit.Constants.Units.mile,
        ascending: true,
        includeManuallyAdded: true,
      },
      (err: any, results: any) => {
        if (err) {
          return resolve(null);
        }

        const values = extractNumericValues(results);
        if (!values.length) {
          return resolve(null);
        }

        const totalMiles = values.reduce((sum, n) => sum + n, 0);
        const avgMilesPerDay = totalMiles / 7;

        resolve(Number(avgMilesPerDay.toFixed(2)));
      }
    );
  });
}



export async function getActiveEnergyAvg7dKcal(): Promise<number | null> {
  if (!hasHealthKitModule()) return null;

  const startDate = daysAgo(6).toISOString();
  const endDate = new Date().toISOString();

  return await new Promise((resolve) => {
    AppleHealthKit.getActiveEnergyBurned(
      {
        startDate,
        endDate,
        unit: AppleHealthKit.Constants.Units.kilocalorie,
        ascending: true,
        includeManuallyAdded: true,
      },
      (err: any, results: any) => {
        if (err) {
          return resolve(null);
        }

        const values = extractNumericValues(results);
        if (!values.length) {
          return resolve(null);
        }

        const totalKcal = values.reduce((sum, n) => sum + n, 0);
        const avgKcalPerDay = totalKcal / 7;

        resolve(Math.round(avgKcalPerDay));
      }
    );
  });
}


export async function getStepsTrend7Days(): Promise<DailyDataPoint[]> {
  if (!hasHealthKitModule()) return [];

  const startDate = daysAgo(6).toISOString();
  const endDate = new Date().toISOString();

  return await new Promise((resolve) => {
    AppleHealthKit.getDailyStepCountSamples(
      { startDate, endDate },
      (err: any, results: any[]) => {
        if (err || !results?.length) return resolve([]);

        const points: DailyDataPoint[] = results
          .map((r: any) => ({
            date: String(r.startDate ?? "").split("T")[0] ?? "",
            value: Math.round(Number(r.value) || 0),
          }))
          .filter((p) => p.date && Number.isFinite(p.value));

        resolve(points);
      }
    );
  });
}

export async function getSleepTrend7Days(): Promise<DailyDataPoint[]> {
  if (!hasHealthKitModule()) return [];

  const end = new Date();
  const start = daysAgo(7);

  return await new Promise((resolve) => {
    AppleHealthKit.getSleepSamples(
      { startDate: start.toISOString(), endDate: end.toISOString() },
      (err: any, results: any[]) => {
        if (err || !results?.length) return resolve([]);

        const asleep = results.filter((r: any) =>
          String(r.value || "").toLowerCase().includes("asleep")
        );
        const picked = asleep.length ? asleep : results;

        // Group by startDate night, sum durations in minutes
        const byDate: Record<string, number> = {};
        for (const r of picked) {
          const date = String(r.startDate ?? "").split("T")[0];
          if (!date) continue;
          const ms =
            new Date(r.endDate).getTime() - new Date(r.startDate).getTime();
          byDate[date] = (byDate[date] ?? 0) + ms / 60000;
        }

        const points: DailyDataPoint[] = Object.entries(byDate)
          .map(([date, value]) => ({ date, value: Math.round(value) }))
          .sort((a, b) => a.date.localeCompare(b.date));

        resolve(points);
      }
    );
  });
}

export async function getHeartRateTrend(): Promise<DailyDataPoint[]> {
  if (!hasHealthKitModule()) return [];

  const endDate = new Date().toISOString();
  const startDate = daysAgo(7).toISOString();

  return await new Promise((resolve) => {
    AppleHealthKit.getHeartRateSamples(
      { startDate, endDate, limit: 14, ascending: false },
      (err: any, results: any[]) => {
        if (err || !results?.length) return resolve([]);

        const points: DailyDataPoint[] = [...results]
          .reverse()
          .map((r: any) => ({
            date: String(r.startDate ?? "").split("T")[0] ?? "",
            value: Math.round(Number(r.value) || 0),
          }))
          .filter((p) => p.date && p.value > 0);

        resolve(points);
      }
    );
  });
}

export async function getAppleHealthSnapshot(): Promise<AppleHealthSnapshot> {
  const fetchedAt = new Date();

  const [
    heartRate,
    sleepAvgMin,
    stepsAvg7d,
    walkingRunningDistanceAvg7dMiles,
    activeEnergyAvg7dKcal,
    stepsTrend7d,
    sleepTrend7d,
    heartRateTrend,
  ] = await Promise.all([
    getLatestHeartRateBpm(),
    getSleepAvgLast7DaysMinutes(),
    getStepsAvg7Days(),
    getWalkingRunningDistanceAvg7dMiles(),
    getActiveEnergyAvg7dKcal(),
    getStepsTrend7Days(),
    getSleepTrend7Days(),
    getHeartRateTrend(),
  ]);


  return {
    fetchedAt,
    heartRate,
    sleepAvgMin,
    stepsAvg7d,
    walkingRunningDistanceAvg7dMiles,
    activeEnergyAvg7dKcal,
    stepsTrend7d,
    sleepTrend7d,
    heartRateTrend,
  };
}