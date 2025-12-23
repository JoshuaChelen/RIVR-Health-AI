// src/navigation/types.ts
export type RootStackParamList = {
  Home: undefined;
  Details: { id: string } | undefined;
  ShareFile: undefined
  
  ShareSelectDocument: undefined;
  ShareSelectFormat: { documentId: string; title: string | null };
  ShareOut: { documentId: string; fileType: "fhir" | "card"; title: string | null };

  DocumentsList: undefined

  DebugStorage: undefined
};
