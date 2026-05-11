import { describe, expect, it } from "vitest";

import { appLinking } from "./linking";

describe("app deep linking", () => {
  it("keeps release QA screens addressable by app scheme links", () => {
    expect(appLinking.prefixes).toContain("rivrhealth://");
    expect(appLinking.config?.screens).toMatchObject({
      Login: "auth/confirmed",
      UpdatePassword: "auth/reset",
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
});
