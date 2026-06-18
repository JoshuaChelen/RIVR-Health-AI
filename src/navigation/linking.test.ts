import { describe, expect, it } from "vitest";

import { appLinking } from "./linking";

describe("app deep linking", () => {
  it("keeps release QA screens addressable by app scheme links", () => {
    expect(appLinking.prefixes).toContain("rivrhealth://");
    expect(appLinking.config?.screens).toMatchObject({
      Login: "auth/confirmed",
      // UpdatePassword now uses an object config with parse-time validation;
      // toMatchObject checks the nested path property.
      UpdatePassword: { path: "auth/reset" },
      Home: "",
      ManageDocuments: "documents",
      Share: "share",
      Timeline: "timeline",
      PreVisitNote: "pre-visit",
      HealthSummary: "health-summary",
      AIInsights: "ai-insights",
      Profile: "profile",
      MedicalProfile: "medical-profile",
      Story: "story",
      AppleHealth: "apple-health",
    });
  });

  it("rejects malformed uid/token at parse time", () => {
    const screens = appLinking.config?.screens as any;
    const parse = screens.UpdatePassword.parse;

    // Valid values pass through unchanged.
    expect(parse.uid("12345")).toBe("12345");
    expect(parse.token("abcdefghij0123456789")).toBe("abcdefghij0123456789");

    // Invalid values are nulled out so UpdatePasswordScreen shows an error.
    expect(parse.uid("bad<uid>")).toBeNull();
    expect(parse.token("short")).toBeNull();
    expect(parse.token("<script>alert(1)</script>")).toBeNull();
  });
});
