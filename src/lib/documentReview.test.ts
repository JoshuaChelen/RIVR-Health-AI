import { describe, expect, it } from "vitest";

import { badgeForState, isActionable } from "./documentReview";

describe("badgeForState", () => {
  it("labels reviewed states", () => {
    expect(badgeForState("confirmed", "ai").label).toBe("Confirmed");
    expect(badgeForState("rejected", "ai").tone).toBe("warn");
    expect(badgeForState("unreviewed", "ai").label).toBe("Needs review");
  });
  it("treats manual items distinctly", () => {
    expect(badgeForState("present", "manual").label).toBe("From your profile");
  });
});

describe("isActionable", () => {
  it("is true only for present AI items", () => {
    expect(isActionable("unreviewed", "ai")).toBe(true);
    expect(isActionable("rejected", "ai")).toBe(false);
    expect(isActionable("present", "manual")).toBe(false);
  });
});

import { confidenceChip } from "./documentReview";

describe("confidenceChip", () => {
  it("returns null for a non-number", () => {
    expect(confidenceChip(undefined)).toBeNull();
    expect(confidenceChip(null)).toBeNull();
  });
  it("labels a percent and is ok at/above 0.5", () => {
    expect(confidenceChip(0.82)).toEqual({ label: "82% confident", tone: "ok" });
  });
  it("warns below 0.5", () => {
    expect(confidenceChip(0.3)?.tone).toBe("warn");
  });
});
