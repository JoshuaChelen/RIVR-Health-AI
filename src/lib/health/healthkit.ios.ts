import { Platform } from "react-native";
import AppleHealthKit, { HealthKitPermissions } from "react-native-health";

const permissions: HealthKitPermissions = {
  permissions: {
    read: [
      AppleHealthKit.Constants.Permissions.HeartRate,
      AppleHealthKit.Constants.Permissions.SleepAnalysis,
    ],
    write: [],
  },
};

function hasHealthKitModule() {
  return (
    Platform.OS === "ios" &&
    !!AppleHealthKit &&
    typeof (AppleHealthKit as any).isAvailable === "function" &&
    typeof (AppleHealthKit as any).initHealthKit === "function"
  );
}

export async function isHealthAvailable(): Promise<boolean> {
  if (!hasHealthKitModule()) return false;

  return await new Promise<boolean>((resolve) => {
    // types expect (error: Object, results: boolean)
    AppleHealthKit.isAvailable((err: any, available: boolean) => {
      resolve(!err && !!available);
    });
  });
}

export async function linkAppleHealth(): Promise<{ ok: boolean; error?: string }> {
  if (!hasHealthKitModule()) {
    return { ok: false, error: "HealthKit module not available (needs an iOS native build)." };
  }

  return await new Promise((resolve) => {
    AppleHealthKit.initHealthKit(permissions, (err: any) => {
      if (err) return resolve({ ok: false, error: String(err) });
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

        const asleep = results.filter((r) =>
          String(r.value || "").toLowerCase().includes("asleep")
        );
        const picked = asleep.length ? asleep : results;

        const totalMs = picked.reduce((sum: number, r: any) => {
          return sum + (new Date(r.endDate).getTime() - new Date(r.startDate).getTime());
        }, 0);

        resolve(Math.round(totalMs / 7 / 60000));
      }
    );
  });
}
