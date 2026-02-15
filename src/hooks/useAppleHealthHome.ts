import { useCallback, useEffect, useState } from "react";
import { useFocusEffect } from "@react-navigation/native";
import { supabase } from "../lib/supabase";

import {
  isHealthAvailable,
  linkAppleHealth,
  getLatestHeartRateBpm,
  getSleepAvgLast7DaysMinutes,
} from "../lib/health/healthkit.ios";
import { Platform } from "react-native";

type HealthStatus = "loading" | "unlinked" | "linked" | "unsupported";

function fmtSleep(minutes: number | null) {
  if (minutes == null) return "--";
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h}h ${String(m).padStart(2, "0")}m`;
}

export function useAppleHealthHome() {
  const [status, setStatus] = useState<HealthStatus>("loading");
  const [refreshing, setRefreshing] = useState(false);

  const [heartRate, setHeartRate] = useState<number | null>(null);
  const [sleepAvgMin, setSleepAvgMin] = useState<number | null>(null);
  const [lastSync, setLastSync] = useState<Date | null>(null);

const refresh = useCallback(async () => {
  try {
    if (Platform.OS !== "ios") {
      setStatus("unsupported");
      return;
    }

    const available = await isHealthAvailable();
    if (!available) {
      setStatus("unsupported");
      return;
    }

    const hr = await getLatestHeartRateBpm();
    const sl = await getSleepAvgLast7DaysMinutes();

    if (hr === null && sl === null) {
      setStatus("unlinked");
      return;
    }

    setHeartRate(hr);
    setSleepAvgMin(sl);
    setLastSync(new Date());
    setStatus("linked");
  } catch (e) {
    setStatus("unlinked");
  }
}, []);


  const link = useCallback(async () => {
    const res = await linkAppleHealth();

    if (!res.ok) {
      setStatus("unlinked");
      return;
    }

    // Optional: store a flag, only if you actually have profiles(id)
    const { data: auth } = await supabase.auth.getUser();
    const userId = auth.user?.id;

    if (userId) {
      await supabase
        .from("profiles")
        .update({ health_linked_at: new Date().toISOString() })
        .eq("id", userId);
    }

    await refresh();
  }, [refresh]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useFocusEffect(
    useCallback(() => {
      refresh();
      const id = setInterval(() => refresh(), 60_000);
      return () => clearInterval(id);
    }, [refresh])
  );

  return {
    status,
    refreshing,
    heartRate,
    sleepAvgText: fmtSleep(sleepAvgMin),
    lastSync,
    link,
    refresh,
  };
}
