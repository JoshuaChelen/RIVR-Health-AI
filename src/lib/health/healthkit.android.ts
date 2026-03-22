export type DailyDataPoint = { date: string; value: number };

export type AppleHealthSnapshot = {
  fetchedAt: Date;
  heartRate: number | null;
  sleepAvgMin: number | null;
  stepsAvg7d: number | null;
  walkingRunningDistanceAvg7dMiles: number | null;
  activeEnergyAvg7dKcal: number | null;
  stepsTrend7d: DailyDataPoint[];
  sleepTrend7d: DailyDataPoint[];
  heartRateTrend: DailyDataPoint[];
};

export async function isHealthAvailable(): Promise<boolean> { return false; }
export async function linkAppleHealth(): Promise<{ ok: boolean; error?: string }> { return { ok: false, error: "HealthKit is iOS only" }; }
export async function getLatestHeartRateBpm(): Promise<number | null> { return null; }
export async function getSleepAvgLast7DaysMinutes(): Promise<number | null> { return null; }
export async function getStepsAvg7Days(): Promise<number | null> { return null; }
export async function getWalkingRunningDistanceAvg7dMiles(): Promise<number | null> { return null; }
export async function getActiveEnergyAvg7dKcal(): Promise<number | null> { return null; }
export async function getStepsTrend7Days(): Promise<DailyDataPoint[]> { return []; }
export async function getSleepTrend7Days(): Promise<DailyDataPoint[]> { return []; }
export async function getHeartRateTrend(): Promise<DailyDataPoint[]> { return []; }
export async function getAppleHealthSnapshot(): Promise<AppleHealthSnapshot> {
  return {
    fetchedAt: new Date(),
    heartRate: null,
    sleepAvgMin: null,
    stepsAvg7d: null,
    walkingRunningDistanceAvg7dMiles: null,
    activeEnergyAvg7dKcal: null,
    stepsTrend7d: [],
    sleepTrend7d: [],
    heartRateTrend: [],
  };
}
