import React, { useState } from "react";
import { View, StyleSheet } from "react-native";
import { Screen } from "../../components/ui/Primitives/Screen";
import { AppText } from "../../components/ui/Primitives/AppText";
import { UploadFile } from "../../components/ui/ManageDocuments/UploadFile";
import { ListDocuments } from "../../components/ui/ManageDocuments/ListDocuments";

export function ManageDocumentsScreen() {
  const [refreshKey, setRefreshKey] = useState<number>(0);

  return (
    <Screen style={styles.container}>
      <AppText variant="h1">Documents</AppText>
      <UploadFile onUploadComplete={() => setRefreshKey((k) => k + 1)} />
      <ListDocuments key={refreshKey} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: { padding: 16, gap: 12 },
});
