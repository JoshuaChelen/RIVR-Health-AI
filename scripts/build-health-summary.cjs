const fs = require("fs");
const path = require("path");
const readline = require("readline");

const INPUT = path.join(__dirname, "..", "src", "lib", "health", "export.xml");
const OUTPUT = path.join(__dirname, "..", "src", "lib", "health", "export.summary.json");

const ATTR_RE = /(\w+)="([^"]*)"/g;

function parseAppleDate(s) {
  // Apple export format: "YYYY-MM-DD HH:mm:ss -0500"
  const m = String(s || "").match(/^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2}) ([+-]\d{4})$/);
  if (m) {
    const off = m[3];
    const offIso = off.slice(0, 3) + ":" + off.slice(3);
    return new Date(`${m[1]}T${m[2]}${offIso}`);
  }
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

function parseAttrsFromRecordLine(line) {
  const attrs = {};
  let match;
  while ((match = ATTR_RE.exec(line))) {
    attrs[match[1]] = match[2];
  }
  return attrs;
}

function overlapMs(aStart, aEnd, bStart, bEnd) {
  const start = Math.max(aStart.getTime(), bStart.getTime());
  const end = Math.min(aEnd.getTime(), bEnd.getTime());
  return Math.max(0, end - start);
}

function sumQuantityWithinWindow(records, winStart, winEnd) {
  let total = 0;

  for (const r of records) {
    const ov = overlapMs(r.start, r.end, winStart, winEnd);
    if (ov <= 0) continue;

    const dur = r.end.getTime() - r.start.getTime();
    if (dur <= 0) continue;

    total += r.value * (ov / dur);
  }

  return total;
}

async function main() {
  if (!fs.existsSync(INPUT)) {
    console.error("Missing export.xml at:", INPUT);
    process.exit(1);
  }

  let latestHr = null; // { at: Date, bpm: number }
  let sleepSegments = []; // { start: Date, end: Date }
  let stepsSegments = []; // { start: Date, end: Date, value: number }

  let maxSleepEnd = null;
  let maxStepsEnd = null;

  const keepDays = 9;

  const rl = readline.createInterface({
    input: fs.createReadStream(INPUT, { encoding: "utf8" }),
    crlfDelay: Infinity,
  });

  let counts = { record: 0, heartRate: 0, sleep: 0, steps: 0 };

  for await (const line of rl) {
    if (!line.includes("<Record")) continue;

    counts.record += 1;
    const attrs = parseAttrsFromRecordLine(line);
    const type = attrs.type;

    if (!type) continue;

    if (type === "HKQuantityTypeIdentifierHeartRate") {
      counts.heartRate += 1;

      const at = parseAppleDate(attrs.endDate || attrs.startDate || attrs.creationDate);
      const bpm = Number(attrs.value);

      if (at && Number.isFinite(bpm)) {
        if (!latestHr || at > latestHr.at) latestHr = { at, bpm };
      }
    }

    if (type === "HKCategoryTypeIdentifierSleepAnalysis") {
      counts.sleep += 1;

      const val = String(attrs.value || "").toLowerCase();
      const isAsleep = val.includes("asleep") && !val.includes("inbed");

      if (!isAsleep) continue;

      const start = parseAppleDate(attrs.startDate);
      const end = parseAppleDate(attrs.endDate);
      if (!start || !end || end <= start) continue;

      if (!maxSleepEnd || end > maxSleepEnd) maxSleepEnd = end;
      sleepSegments.push({ start, end });

      const cutoff = new Date(maxSleepEnd.getTime() - keepDays * 24 * 60 * 60 * 1000);
      sleepSegments = sleepSegments.filter((s) => s.end >= cutoff);
    }

    if (type === "HKQuantityTypeIdentifierStepCount") {
      counts.steps += 1;

      const start = parseAppleDate(attrs.startDate);
      const end = parseAppleDate(attrs.endDate);
      const value = Number(attrs.value);

      if (!start || !end || end <= start || !Number.isFinite(value)) continue;

      if (!maxStepsEnd || end > maxStepsEnd) maxStepsEnd = end;
      stepsSegments.push({ start, end, value });

      const cutoff = new Date(maxStepsEnd.getTime() - keepDays * 24 * 60 * 60 * 1000);
      stepsSegments = stepsSegments.filter((s) => s.end >= cutoff);
    }
  }

  // Sleep avg last 7 days (minutes)
  let avg7dMinutes = null;
  if (maxSleepEnd && sleepSegments.length) {
    const winEnd = maxSleepEnd;
    const winStart = new Date(winEnd.getTime() - 7 * 24 * 60 * 60 * 1000);

    const totalMs = sleepSegments.reduce((sum, s) => {
      return sum + overlapMs(s.start, s.end, winStart, winEnd);
    }, 0);

    avg7dMinutes = Math.round(totalMs / 7 / 60000);
  }

  // Steps today + avg last 7 days
  let stepsOut = { todayCount: null, avg7dPerDay: null, last7dTotal: null, latestAt: null };

  if (maxStepsEnd && stepsSegments.length) {
    const latestAt = maxStepsEnd;

    const dayStart = new Date(latestAt);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);

    const todayTotal = sumQuantityWithinWindow(stepsSegments, dayStart, dayEnd);

    const winEnd = latestAt;
    const winStart = new Date(winEnd.getTime() - 7 * 24 * 60 * 60 * 1000);
    const last7dTotal = sumQuantityWithinWindow(stepsSegments, winStart, winEnd);

    stepsOut = {
      todayCount: Math.round(todayTotal),
      avg7dPerDay: Math.round(last7dTotal / 7),
      last7dTotal: Math.round(last7dTotal),
      latestAt: latestAt.toISOString(),
    };
  }

  const out = {
    generatedAt: new Date().toISOString(),
    heartRate: {
      latestBpm: latestHr ? Math.round(latestHr.bpm) : null,
      latestAt: latestHr ? latestHr.at.toISOString() : null,
    },
    sleep: {
      avg7dMinutes,
    },
    steps: stepsOut,
    debug: {
      counts,
      notes:
        counts.heartRate === 0 || counts.sleep === 0
          ? "Heart rate and/or sleep not found in export.xml. Steps were found."
          : "Heart rate, sleep, and steps found.",
    },
  };

  fs.writeFileSync(OUTPUT, JSON.stringify(out, null, 2), "utf8");
  console.log("Wrote:", OUTPUT);
  console.log("Counts:", out.debug.counts);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
