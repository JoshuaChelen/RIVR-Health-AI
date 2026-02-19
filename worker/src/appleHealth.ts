import { supabaseAdmin } from "./supabaseAdmin";

function daysAgoISO(days: number) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

export async function getAppleHealthSnapshot(userId: string) {
  const since = daysAgoISO(14);

  const { data: events, error } = await supabaseAdmin
    .from("timeline_events")
    .select("occurred_at,event_type,source,data")
    .eq("user_id", userId)
    .eq("source", "apple_health")
    .gte("occurred_at", since)
    .limit(500);

  if (error || !events) {
    return { steps_avg_7d: null, sleep_avg_min_7d: null, resting_hr_recent: null };
  }

  const stepValues: number[] = [];
  const sleepValues: number[] = [];
  const hrValues: number[] = [];

  for (const e of events) {
    const t = String(e.event_type || "").toLowerCase();
    const data = (e.data || {}) as any;

    if (t.includes("steps")) {
      const v = Number(data.steps ?? data.value ?? NaN);
      if (Number.isFinite(v)) stepValues.push(v);
    }

    if (t.includes("sleep")) {
      const v = Number(data.minutes ?? data.sleep_minutes ?? data.value ?? NaN);
      if (Number.isFinite(v)) sleepValues.push(v);
    }

    if (t.includes("heart") || t.includes("hr") || t.includes("resting")) {
      const v = Number(data.bpm ?? data.value ?? NaN);
      if (Number.isFinite(v)) hrValues.push(v);
    }
  }

  const avg = (arr: number[]) => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null;

  return {
    steps_avg_7d: avg(stepValues),
    sleep_avg_min_7d: avg(sleepValues),
    resting_hr_recent: hrValues.length ? hrValues[hrValues.length - 1] : null
  };
}
