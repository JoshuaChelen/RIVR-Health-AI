import { supabase } from "../supabase";
import type { AppleHealthSnapshot } from "./healthkit.ios";

export type AppleHealthSyncResult = {
  ok: boolean;
  wrote: number;
  error?: string;
};

export async function syncAppleHealthToTimeline(
  userId: string,
  snap: AppleHealthSnapshot
): Promise<AppleHealthSyncResult> {
  const today = snap.fetchedAt.toISOString().slice(0, 10);

  type InsertRow = {
    user_id: string;
    occurred_at: string;
    date_precision: "day";
    title: string;
    event_type: string;
    category: string;
    source: "apple_health";
    summary: string;
    data: Record<string, unknown>;
    included_in_previsit: boolean;
    tags: string[];
  };

  const rows: InsertRow[] = [];

  if (snap.stepsAvg7d != null) {
    const steps = Math.round(snap.stepsAvg7d);
    rows.push({
      user_id: userId,
      occurred_at: today,
      date_precision: "day",
      title: "Steps (7-day average)",
      event_type: "apple_health_steps_avg_7d",
      category: "activity",
      source: "apple_health",
      summary: `${steps.toLocaleString()} steps/day (7d avg)`,
      data: { steps, window: "7d_avg", origin: "healthkit" },
      included_in_previsit: false,
      tags: ["steps", "activity"],
    });
  }

  if (snap.sleepAvgMin != null) {
    const minutes = Math.round(snap.sleepAvgMin);
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    rows.push({
      user_id: userId,
      occurred_at: today,
      date_precision: "day",
      title: "Sleep (7-day average)",
      event_type: "apple_health_sleep_avg_7d",
      category: "sleep",
      source: "apple_health",
      summary: `${h}h ${String(m).padStart(2, "0")}m avg/night (7d)`,
      data: { minutes, window: "7d_avg", origin: "healthkit" },
      included_in_previsit: false,
      tags: ["sleep"],
    });
  }

  if (snap.heartRate != null) {
    rows.push({
      user_id: userId,
      occurred_at: today,
      date_precision: "day",
      title: "Heart rate (recent)",
      event_type: "apple_health_heart_rate_recent",
      category: "vitals",
      source: "apple_health",
      summary: `${snap.heartRate} bpm (latest reading)`,
      data: { bpm: snap.heartRate, origin: "healthkit" },
      included_in_previsit: false,
      tags: ["heart_rate", "vitals"],
    });
  }

  if (snap.walkingRunningDistanceAvg7dMiles != null) {
    const miles = Number(snap.walkingRunningDistanceAvg7dMiles.toFixed(2));
    rows.push({
      user_id: userId,
      occurred_at: today,
      date_precision: "day",
      title: "Walking/running distance (7-day average)",
      event_type: "apple_health_distance_avg_7d",
      category: "activity",
      source: "apple_health",
      summary: `${miles} mi/day (7d avg)`,
      data: { miles, window: "7d_avg", origin: "healthkit" },
      included_in_previsit: false,
      tags: ["distance", "activity"],
    });
  }

  if (snap.activeEnergyAvg7dKcal != null) {
    const kcal = Math.round(snap.activeEnergyAvg7dKcal);
    rows.push({
      user_id: userId,
      occurred_at: today,
      date_precision: "day",
      title: "Active energy (7-day average)",
      event_type: "apple_health_active_energy_avg_7d",
      category: "activity",
      source: "apple_health",
      summary: `${kcal.toLocaleString()} kcal/day (7d avg)`,
      data: { kcal, window: "7d_avg", origin: "healthkit" },
      included_in_previsit: false,
      tags: ["energy", "activity"],
    });
  }

  if (rows.length === 0) {
    return { ok: true, wrote: 0 };
  }

  const { error: deleteError } = await supabase
    .from("timeline_events")
    .delete()
    .eq("user_id", userId)
    .eq("source", "apple_health")
    .eq("occurred_at", today);

  if (deleteError) {
    return { ok: false, wrote: 0, error: deleteError.message };
  }

  const { error: insertError } = await supabase
    .from("timeline_events")
    .insert(rows);

  if (insertError) {
    return { ok: false, wrote: 0, error: insertError.message };
  }

  return { ok: true, wrote: rows.length };
}