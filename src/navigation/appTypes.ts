// src/navigation/appTypes.ts
export type AppStackParamList = {
  Home: undefined;
  Details: { id: string };
  ManageDocuments: undefined;
  Share: undefined;
  Timeline: undefined;
  PreVisitNote: undefined;
  ShinScore: undefined;
  HealthSummary: undefined;
  AIInsights: undefined;
  Profile: undefined;
  MedicalProfile: undefined;
  Story: undefined;
  AppleHealth: { initialMetric?: "sleep" | "steps" | "heartRate" } | undefined;
};
