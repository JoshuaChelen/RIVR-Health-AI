import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { useSession } from "./SessionContext";
import { linkHealth, unlinkHealth, getProfile } from "../lib/api/data";
import {
  getHealthAvailability,
  linkAppleHealth,
  getAppleHealthSnapshot,
} from "../lib/health/healthkit";
import type { DailyDataPoint } from "../lib/health/types";
import { syncAppleHealthToTimeline } from "../lib/health/syncAppleHealth";

// ─── Types ────────────────────────────────────────────────────────────────────

export type AppleHealthStatus =
  | "loading"
  | "unsupported"
  | "unlinked"
  | "disconnected"
  | "linked";

export type { DailyDataPoint };

export type AppleHealthContextValue = {
  status: AppleHealthStatus;
  refreshing: boolean;
  heartRate: number | null;
  sleepAvgMin: number | null;
  sleepAvgText: string;
  stepsAvg7d: number | null;
  walkingRunningDistanceAvg7dMiles: number | null;
  activeEnergyAvg7dKcal: number | null;
  stepsTrend7d: DailyDataPoint[];
  sleepTrend7d: DailyDataPoint[];
  heartRateTrend: DailyDataPoint[];
  lastSync: Date | null;
  errorText: string | null;
  link: () => Promise<void>;
  refresh: () => Promise<void>;
  disconnect: () => Promise<void>;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtSleep(minutes: number | null): string {
  if (minutes == null) return "--";
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h}h ${String(m).padStart(2, "0")}m`;
}

// ─── Context ──────────────────────────────────────────────────────────────────

const AppleHealthContext = createContext<AppleHealthContextValue>({
  status: "loading",
  refreshing: false,
  heartRate: null,
  sleepAvgMin: null,
  sleepAvgText: "--",
  stepsAvg7d: null,
  walkingRunningDistanceAvg7dMiles: null,
  activeEnergyAvg7dKcal: null,
  stepsTrend7d: [],
  sleepTrend7d: [],
  heartRateTrend: [],
  lastSync: null,
  errorText: null,
  link: async () => {},
  refresh: async () => {},
  disconnect: async () => {},
});

// ─── Provider ─────────────────────────────────────────────────────────────────

export function AppleHealthProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [status, setStatus] = useState<AppleHealthStatus>("loading");
  const [refreshing, setRefreshing] = useState(false);
  const [heartRate, setHeartRate] = useState<number | null>(null);
  const [sleepAvgMin, setSleepAvgMin] = useState<number | null>(null);
  const [stepsAvg7d, setStepsAvg7d] = useState<number | null>(null);
  const [walkingRunningDistanceAvg7dMiles, setWalkingRunningDistanceAvg7dMiles] =
    useState<number | null>(null);
  const [activeEnergyAvg7dKcal, setActiveEnergyAvg7dKcal] = useState<number | null>(null);
  const [stepsTrend7d, setStepsTrend7d] = useState<DailyDataPoint[]>([]);
  const [sleepTrend7d, setSleepTrend7d] = useState<DailyDataPoint[]>([]);
  const [heartRateTrend, setHeartRateTrend] = useState<DailyDataPoint[]>([]);
  const [lastSync, setLastSync] = useState<Date | null>(null);
  const [errorText, setErrorText] = useState<string | null>(null);

  // profileLinkedRef gates HealthKit reads.
  // true  = user has an active health_linked_at in their profile (connected or reconnected).
  // false = user has never connected, or explicitly disconnected.
  // Using a ref so refresh() reads the current value without becoming a stale closure.
  const profileLinkedRef = useRef<boolean>(false);

  const clearHealthData = useCallback(() => {
    setHeartRate(null);
    setSleepAvgMin(null);
    setStepsAvg7d(null);
    setWalkingRunningDistanceAvg7dMiles(null);
    setActiveEnergyAvg7dKcal(null);
    setStepsTrend7d([]);
    setSleepTrend7d([]);
    setHeartRateTrend([]);
    setLastSync(null);
    setErrorText(null);
  }, []);

  // ── refresh ────────────────────────────────────────────────────────────────

  const { user } = useSession();

  const refresh = useCallback(async () => {
    // If user has not connected (or has disconnected), never attempt HealthKit reads.
    if (!profileLinkedRef.current) {
      setStatus((prev) =>
        prev === "disconnected" ? "disconnected" : "unlinked"
      );
      return;
    }

    setRefreshing(true);

    try {
      const availability = await getHealthAvailability();
      if (!availability.ok) {
        setStatus("unsupported");
        setErrorText(availability.error ?? "Health data is unavailable.");
        return;
      }

      const snap = await getAppleHealthSnapshot();


      setHeartRate(snap.heartRate);
      setSleepAvgMin(snap.sleepAvgMin);
      setStepsAvg7d(snap.stepsAvg7d);
      setWalkingRunningDistanceAvg7dMiles(snap.walkingRunningDistanceAvg7dMiles);
      setActiveEnergyAvg7dKcal(snap.activeEnergyAvg7dKcal);
      setStepsTrend7d(snap.stepsTrend7d);
      setSleepTrend7d(snap.sleepTrend7d);
      setHeartRateTrend(snap.heartRateTrend);

      const hasAnyData =
        snap.heartRate !== null ||
        snap.sleepAvgMin !== null ||
        snap.stepsAvg7d !== null ||
        snap.walkingRunningDistanceAvg7dMiles !== null ||
        snap.activeEnergyAvg7dKcal !== null;


      // Always mark as linked once HealthKit is authorized and responsive.
      // errorText below communicates when samples are absent.
      setStatus("linked");

      if (!hasAnyData) {
        setErrorText(
          "Apple Health is authorized, but no readable samples were found yet. " +
            "Try opening the Health app or syncing your Apple Watch, then refresh."
        );
        return;
      }

      setErrorText(null);

      if (user?.id) {
        const syncResult = await syncAppleHealthToTimeline(user.id, snap);
        if (!syncResult.ok) {
          setErrorText(
            syncResult.error ?? "Data read OK, but timeline sync failed."
          );
        }
      }

      setLastSync(new Date());
    } catch (e: any) {
      // A read error should not bounce the user back to the "Connect" flow
      // if they were already linked. Only go to unlinked when we haven't
      // established a linked state yet.
      setStatus((prev) => (prev === "linked" ? "linked" : "unlinked"));
      setErrorText(e?.message ?? "Unknown Apple Health error.");
    } finally {
      setRefreshing(false);
    }
  }, []);

  // ── link ───────────────────────────────────────────────────────────────────

  const link = useCallback(async () => {
    setRefreshing(true);
    setErrorText(null);

    try {
      const res = await linkAppleHealth();
      if (!res.ok) {
        setErrorText(res.error ?? "Could not connect health data.");
        setStatus(res.unsupported ? "unsupported" : "unlinked");
        return;
      }

      // Authorization granted — mark as linked so refresh() proceeds.
      profileLinkedRef.current = true;

      if (user?.id) {
        await linkHealth();
      }

      await refresh();
    } catch (e: any) {
      profileLinkedRef.current = false;
      setStatus("unlinked");
      setErrorText(e?.message ?? "Failed to connect Apple Health.");
    } finally {
      setRefreshing(false);
    }
  }, [refresh]);

  // ── disconnect ─────────────────────────────────────────────────────────────

  const disconnect = useCallback(async () => {
    // Immediately update local state so UI reflects disconnect at once.
    profileLinkedRef.current = false;
    clearHealthData();
    setStatus("disconnected");

    // Persist disconnect in profile so it survives an app restart.
    // health_linked_at = null signals "not connected" on next cold start.
    try {
      if (user?.id) {
        await unlinkHealth();
      }
    } catch {
      // Local state is already cleared. DB update is best-effort.
    }
  }, [clearHealthData, user?.id]);

  // ── mount: check profile then conditionally refresh ────────────────────────

  useEffect(() => {
    (async () => {
      try {
        if (user?.id) {
          const profile = await getProfile();

          // health_linked_at is set iff the user has previously authorized.
          // null means never connected or explicitly disconnected.
          if (profile?.health_linked_at) {
            profileLinkedRef.current = true;
          }
        }
      } catch {
        // If profile fetch fails, proceed with ref = false → shows unlinked state.
      }

      await refresh();
    })();
    // refresh is stable (useCallback with [] deps). Safe to omit from dep array.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, refresh]);

  return (
    <AppleHealthContext.Provider
      value={{
        status,
        refreshing,
        heartRate,
        sleepAvgMin,
        sleepAvgText: fmtSleep(sleepAvgMin),
        stepsAvg7d,
        walkingRunningDistanceAvg7dMiles,
        activeEnergyAvg7dKcal,
        stepsTrend7d,
        sleepTrend7d,
        heartRateTrend,
        lastSync,
        errorText,
        link,
        refresh,
        disconnect,
      }}
    >
      {children}
    </AppleHealthContext.Provider>
  );
}

// ─── Consumer hook ────────────────────────────────────────────────────────────

export function useAppleHealth(): AppleHealthContextValue {
  return useContext(AppleHealthContext);
}
