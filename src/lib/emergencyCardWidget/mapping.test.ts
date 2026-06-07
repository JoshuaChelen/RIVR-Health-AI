import { describe, expect, it } from "vitest";

import { mapCardToPayload } from "./mapping";

describe("mapCardToPayload", () => {
  it("maps a full card to the widget payload", () => {
    const payload = mapCardToPayload(
      {
        blood_type: "O+",
        major_conditions: ["Type 2 Diabetes"],
        major_surgeries: ["Appendectomy"],
        current_meds: ["Metformin", "Lisinopril"],
        allergies: ["Penicillin", "Nuts"],
        implants_devices: ["Pacemaker"],
        anticoagulants: ["Warfarin"],
        anesthesia_notes: ["Malignant hyperthermia risk"],
        emergency_contact: { name: "Jane", phone: "555-0142" },
        one_line_summary: "Diabetic on anticoagulants.",
      },
      "2026-06-05T12:00:00.000Z",
    );

    expect(payload).toEqual({
      schema_version: 1,
      blood_type: "O+",
      allergies: ["Penicillin", "Nuts"],
      emergency_contact: { name: "Jane", phone: "555-0142" },
      major_conditions: ["Type 2 Diabetes"],
      current_meds: ["Metformin", "Lisinopril"],
      anticoagulants: ["Warfarin"],
      implants_devices: ["Pacemaker"],
      anesthesia_notes: ["Malignant hyperthermia risk"],
      major_surgeries: ["Appendectomy"],
      one_line_summary: "Diabetic on anticoagulants.",
      updated_at: "2026-06-05T12:00:00.000Z",
    });
  });

  it("defaults nulls, missing arrays, and missing contact safely", () => {
    const payload = mapCardToPayload({ blood_type: null }, undefined);
    expect(payload.blood_type).toBeNull();
    expect(payload.allergies).toEqual([]);
    expect(payload.current_meds).toEqual([]);
    expect(payload.emergency_contact).toEqual({ name: null, phone: null });
    expect(payload.one_line_summary).toBe("");
    expect(payload.updated_at).toBeNull();
    expect(payload.schema_version).toBe(1);
  });

  it("drops empty/whitespace strings from arrays", () => {
    const payload = mapCardToPayload(
      { allergies: ["Penicillin", "", "   "] },
      null,
    );
    expect(payload.allergies).toEqual(["Penicillin"]);
  });

  it("returns an empty payload for a null/undefined card", () => {
    const payload = mapCardToPayload(null, null);
    expect(payload.blood_type).toBeNull();
    expect(payload.allergies).toEqual([]);
    expect(payload.one_line_summary).toBe("");
  });
});
