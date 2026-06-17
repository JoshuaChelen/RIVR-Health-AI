import { describe, it, expect } from "vitest";
import { allergySecondaryLabel } from "./intolerance";

describe("allergySecondaryLabel", () => {
  it("labels intolerance", () => {
    expect(allergySecondaryLabel("Hives", "Mild", "intolerance")).toContain("Intolerance");
  });
  it("does not label a normal allergy", () => {
    expect(allergySecondaryLabel("Hives", "Severe", "allergy")).not.toContain("Intolerance");
  });
  it("omits empty parts", () => {
    expect(allergySecondaryLabel("", "", "intolerance")).toBe("Intolerance");
  });
});
