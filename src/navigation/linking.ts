import type { LinkingOptions } from "@react-navigation/native";

type RootLinkingParamList = {
  Login: undefined;
  UpdatePassword: undefined;
  Home: undefined;
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
      UpdatePassword: "auth/reset",
      Home: "",
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
