import React from "react";
import {  View } from "react-native";
import { UploadFile } from "../../components/ui/ManageDocuments/UploadFile";
import { ListDocuments } from "../../components/ui/ManageDocuments/ListDocuments";


export function ManageDocumentsScreen() {
  return (
    <View style={{ flex: 1 }}>
      <UploadFile />
      <ListDocuments />
    </View>
  );
}
