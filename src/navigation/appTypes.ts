// src/navigation/appTypes.ts
export type AppStackParamList = {
  Home: undefined;
  AskAI: undefined;
  Details: { id: string };
  DocumentDetail: { id: string; title?: string };
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
