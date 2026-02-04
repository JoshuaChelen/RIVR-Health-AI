import React from "react";
import { View, StyleSheet } from "react-native";
import { Screen } from "../../components/ui/Primitives/Screen";
import { AppText } from "../../components/ui/Primitives/AppText";
import { UploadFile } from "../../components/ui/ManageDocuments/UploadFile";
import { ListDocuments } from "../../components/ui/ManageDocuments/ListDocuments";

export function ManageDocumentsScreen() {
  return (
    <Screen style={styles.container}>
      <AppText variant="h1">Documents</AppText>
      <UploadFile />
      <ListDocuments />
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: { padding: 16, gap: 12 },
});
