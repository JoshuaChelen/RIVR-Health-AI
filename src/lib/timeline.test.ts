import { describe, expect, test, vi } from "vitest";

import {
  ageAtIncident,
  buildTimelineEventSavePayload,
  clinicalTagsForEvent,
  formatTimelineDateDetail,
  formatTimelineDateMain,
  normalizeClinicalLabel,
  normalizeStoredDate,
  normalizeTimelineEvent,
} from "./timeline";

describe("timeline release helpers", () => {
  test("normalizes legacy timeline rows with missing fields into safe render defaults", () => {
    const event = normalizeTimelineEvent({
      id: null,
      occurred_at: "2018",
      date_precision: null,
      title: null,
      category: null,
      source: null,
      tags: "old-tag-shape",
      data: ["old-data-shape"],
    });

    expect(event).toMatchObject({
      id: "",
      occurred_at: "2018-01-01",
      date_precision: "year",
      title: "Untitled event",
      event_type: "other",
      category: "Other",
      source: "unknown",
      summary: "",
      included_in_previsit: false,
      document_id: null,
      documentTitle: null,
      created_at: null,
      tags: [],
      data: {},
    });
  });

  test("rejects malformed calendar dates instead of rolling them forward", () => {
    expect(normalizeStoredDate("2024-13-40")).toBeNull();
    expect(normalizeStoredDate("2024-02-30")).toBeNull();
  });

  test("formats old events with incident year and patient age in main view", () => {
    vi.setSystemTime(new Date("2026-05-11T12:00:00Z"));
    const event = normalizeTimelineEvent({
      occurred_at: "2016-04-20",
      date_precision: "day",
      created_at: "2024-03-15",
    });

    expect(formatTimelineDateMain(event, "1974-02-10")).toEqual({
      primary: "Incident year 2016, patient age 42",
      secondary: "Reported March 2024",
    });
  });

  test("shows detailed date for recent day-precision events in main view", () => {
    vi.setSystemTime(new Date("2026-05-11T12:00:00Z"));
    const event = normalizeTimelineEvent({
      occurred_at: "2025-12-02",
      date_precision: "day",
    });

    expect(formatTimelineDateMain(event, "1990-01-01").primary).toContain("Occurred");
    expect(formatTimelineDateMain(event, "1990-01-01").primary).toContain("patient age 35");
  });

  test("detail view distinguishes incident and reported dates", () => {
    const event = normalizeTimelineEvent({
      occurred_at: "2018",
      created_at: "2024-03-15",
    });

    expect(formatTimelineDateDetail(event, "1982-06-01")).toEqual({
      incident: "2018",
      reported: "March 2024",
      sentence: "Occurred in 2018, when the patient was 35 years old.",
    });
  });

  test("normalizes clinical labels and detects scannable clinical tags", () => {
    expect(normalizeClinicalLabel("body_part")).toBe("Body Part");
    expect(normalizeClinicalLabel("L")).toBe("Left");
    expect(normalizeClinicalLabel("R")).toBe("Right");

    const event = normalizeTimelineEvent({
      title: "L thumb fracture with recurring pain",
      event_type: "diagnosis",
      category: "Injury",
      tags: ["surgery"],
    });

    expect(clinicalTagsForEvent(event)).toEqual(
      expect.arrayContaining([
        { label: "Side", value: "Left" },
        { label: "Body Part", value: "Thumb" },
        { label: "Diagnosis", value: "Diagnosis" },
        { label: "Injury", value: "Injury" },
        { label: "Symptom", value: "Symptom" },
      ]),
    );
  });

  test("does not calculate impossible patient ages", () => {
    expect(ageAtIncident("2020-01-01", "2018-01-01")).toBeNull();
    expect(ageAtIncident("1800-01-01", "2025-01-01")).toBeNull();
  });

  test("builds safe edit-save payloads for cleared and partial incident dates", () => {
    expect(
      buildTimelineEventSavePayload({
        title: "  Left thumb injury  ",
        summary: "  Follow up  ",
        occurred_at: "2018",
        date_precision: "year",
        category: " Injury ",
        event_type: " diagnosis ",
        tagsCsv: "thumb, injury, thumb",
      }),
    ).toEqual({
      ok: true,
      payload: {
        title: "Left thumb injury",
        summary: "Follow up",
        occurred_at: "2018-01-01",
        date_precision: "year",
        category: "Injury",
        event_type: "diagnosis",
        tags: ["thumb", "injury"],
      },
    });

    expect(
      buildTimelineEventSavePayload({
        title: "",
        summary: "",
        occurred_at: "",
        date_precision: "month",
        category: "",
        event_type: "",
        tagsCsv: "",
      }),
    ).toEqual({
      ok: true,
      payload: {
        title: "Untitled event",
        summary: "",
        occurred_at: null,
        date_precision: null,
        category: "Other",
        event_type: "other",
        tags: [],
      },
    });
  });

  test("rejects malformed edit-save incident dates with precision-specific messages", () => {
    expect(
      buildTimelineEventSavePayload({
        title: "Bad date",
        summary: "",
        occurred_at: "2024-02-30",
        date_precision: "day",
        category: "",
        event_type: "",
        tagsCsv: "",
      }),
    ).toEqual({ ok: false, error: "Date must be a real date in YYYY-MM-DD format." });

    expect(
      buildTimelineEventSavePayload({
        title: "Bad month",
        summary: "",
        occurred_at: "2024-13",
        date_precision: "month",
        category: "",
        event_type: "",
        tagsCsv: "",
      }),
    ).toEqual({ ok: false, error: "Date must be in YYYY-MM or YYYY-MM-DD format." });
  });
});
