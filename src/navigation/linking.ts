import type { LinkingOptions } from "@react-navigation/native";

import { validateTokenFormat } from "../lib/tokenValidator";

type RootLinkingParamList = {
  Login: undefined;
  UpdatePassword: { uid?: string; token?: string } | undefined;
  Home: undefined;
  AskAI: undefined;
  ManageDocuments: undefined;
  Share: undefined;
  Timeline: undefined;
  ShinScore: undefined;
  HealthSummary: undefined;
  AIInsights: undefined;
  PreVisitNote: undefined;
  Profile: undefined;
  MedicalProfile: undefined;
  Story: undefined;
  AppleHealth: undefined;
};

export const appLinking: LinkingOptions<RootLinkingParamList> = {
  prefixes: ["rivrhealth://"],
  config: {
    screens: {
      Login: "auth/confirmed",
      UpdatePassword: {
        path: "auth/reset",
        parse: {
          // Reject malformed or injected uid/token values at parse time — before
          // navigation even completes — so UpdatePasswordScreen never receives
          // an unvalidated value.  Invalid params are nulled out; the screen
          // checks isValidResetToken() and shows an appropriate error message.
          uid: (value: string) =>
            validateTokenFormat(value, "uid") ? value : null,
          token: (value: string) =>
            validateTokenFormat(value, "token") ? value : null,
        },
      },
      Home: "",
      AskAI: "ask-ai",
      ManageDocuments: "documents",
      Share: "share",
      Timeline: "timeline",
      ShinScore: "shin-score",
      HealthSummary: "health-summary",
      AIInsights: "ai-insights",
      PreVisitNote: "pre-visit",
      Profile: "profile",
      MedicalProfile: "medical-profile",
      Story: "story",
      AppleHealth: "apple-health",
    },
  },
};
