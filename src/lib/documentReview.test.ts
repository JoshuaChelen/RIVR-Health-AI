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
