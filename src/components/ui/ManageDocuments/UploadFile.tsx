import React, { useState } from "react";
import { Button, View, Text } from "react-native";
import { supabase } from "../../../lib/supabase";
import * as DocumentPicker from "expo-document-picker";

async function insertDocumentRow(params: {
  userId: string;
  title: string;
  pdfPath: string; // path AFTER the user uuid prefix
}) {
  const { data, error } = await supabase
    .from("documents")
    .insert([
      {
        user_id: params.userId,
        title: params.title,
        pdf_path: params.pdfPath,
        status: "uploaded", // change if you want: "processing", etc.
      },
    ])
    .select()
    .single();

  if (error) throw error;
  return data;
}

export function UploadFile() {
  const [busy, setBusy] = useState<boolean>(false);
  const [status, setStatus] = useState<string>("Idle");

  const pickAndUpload = async () => {
    const picked_files = await DocumentPicker.getDocumentAsync({
      type: "application/pdf",
      multiple: false,
      copyToCacheDirectory: true,
    });

    if (picked_files.canceled) return;

    try {
      setBusy(true);
      setStatus("Reading file…");

      const asset = picked_files.assets[0];

      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) throw new Error("User not authenticated");

      const response = await fetch(asset.uri);
      const fileBlob = await response.blob();

      setStatus("Uploading file…");

      // Full storage object path (includes uuid)
      const storageObjectPath = `${user.id}/medical-documents/${asset.name}`;

      const { error: uploadError } = await supabase.storage
        .from("documents")
        .upload(storageObjectPath, fileBlob, {
          contentType: asset.mimeType ?? "application/pdf",
          upsert: false,
        });

      if (uploadError) throw uploadError;

      setStatus("Creating document row…");

      // Everything AFTER the uuid prefix
      const pdfPath = `medical-documents/${asset.name}`;

      await insertDocumentRow({
        userId: user.id,
        title: asset.name,
        pdfPath,
      });

      setStatus("Upload complete!");
    } catch (error: any) {
      setStatus(`Error: ${error?.message ?? String(error)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={{ padding: 16, gap: 12 }}>
      <Button
        title={busy ? "Busy…" : "Upload Document"}
        onPress={pickAndUpload}
        disabled={busy}
      />
      <Text>Status: {status}</Text>
    </View>
  );
}
