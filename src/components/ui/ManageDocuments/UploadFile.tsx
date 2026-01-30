import React, { useState } from "react";
import { Button, View, Text } from "react-native";
import { supabase } from "../../../lib/supabase";
import * as DocumentPicker from "expo-document-picker";

export function UploadFile() {
  const [busy, setBusy] = useState<boolean>(false);
  const [status, setStatus] = useState<string>("Idle");

  const pickAndUpload = async () => {
    const picked_files = await DocumentPicker.getDocumentAsync({
      type: "application/pdf",
      multiple: false,
      copyToCacheDirectory: true,
    });

    if (picked_files.canceled) {
      return;
    }

    try {
      setBusy(true);
      setStatus("Reading file…");

      const asset = picked_files.assets[0];

      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        throw new Error("User not authenticated");
      }

      const response = await fetch(asset.uri);
      const fileBlob = await response.blob();

      setStatus("Uploading file…");

      const { error } = await supabase.storage
        .from("documents")
        .upload(`${user.id}/${asset.name}`, 
        fileBlob, 
        {contentType: asset.mimeType ?? "application/pdf",}
      );

      if (error) {
        throw error;
      }
      
      setStatus("Upload complete!");
    } catch (error: any) {
      setStatus(`Error: ${error.message ?? error}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={{ padding: 16, gap: 12 }}>
      <Button
        title={busy ? "Busy…" : "Upload Document"}
        onPress={() => {
          pickAndUpload();
        }}
      />
      <Text>Status: {status}</Text>
    </View>
  );
}
