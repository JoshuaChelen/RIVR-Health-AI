import React, { useState } from "react";
import { supabase } from "../../../lib/supabase";
import * as DocumentPicker from "expo-document-picker";

// Import Primitives
import { Card } from "../Primitives/Card";
import { AppText } from "../Primitives/AppText";
import { PrimaryButton } from "../Primitives/PrimaryButton";

async function insertDocumentRow(params: {
  userId: string;
  title: string;
  pdfPath: string;
}) {
  const { data, error } = await supabase
    .from("documents")
    .insert([
      {
        user_id: params.userId,
        title: params.title,
        pdf_path: params.pdfPath,
        status: "uploaded",
      },
    ])
    .select()
    .single();

  if (error) throw error;
  return data;
}

export function UploadFile({ onUploadComplete }: { onUploadComplete?: () => void }) {
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
        error: userError,
      } = await supabase.auth.getUser();

      if (userError) throw userError;
      if (!user) throw new Error("User not authenticated");

      if (!asset?.uri) throw new Error("No file selected");
      if (asset.mimeType && asset.mimeType !== "application/pdf") {
        throw new Error("Please select a PDF file");
      }

      const response = await fetch(asset.uri);
      if (!response.ok) throw new Error("Failed to read local file");
      const fileBlob = await response.blob();

      setStatus("Uploading file…");

      // Full storage path you actually upload to
      const storageObjectPath = `${user.id}/medical-documents/${asset.name}`;

      const { error: uploadError } = await supabase.storage
        .from("documents")
        .upload(storageObjectPath, fileBlob, {
          contentType: asset.mimeType ?? "application/pdf",
          upsert: false,
        });

      if (uploadError) throw uploadError;

      setStatus("Creating document row…");

      // ✅ FIX: store the same full path you uploaded to
      const pdfPath = storageObjectPath;

      await insertDocumentRow({
        userId: user.id,
        title: asset.name,
        pdfPath,
      });

      setStatus("Notifying server…");

      // Call edge function to log that the file exists / can be downloaded
      const { data: fnData, error: fnError } = await supabase.functions.invoke(
        "log-pdf-upload",
        {
          body: {
            bucket: "documents",
            path: storageObjectPath,
            userId: user.id,
            title: asset.name,
          },
        }
      );

      if (fnError) throw fnError;

      setStatus(
        `Upload complete!`
      );
      
    } catch (error: any) {
      setStatus(`Error: ${error?.message ?? String(error)}`);
    } finally {
      setBusy(false);
      onUploadComplete?.();
    }
  };

  return (
    <Card style={{ gap: 10 }}>
      <AppText variant="title">Upload PDF</AppText>
      <AppText variant="caption">Status: {status}</AppText>

      <PrimaryButton
        label={busy ? "Uploading..." : "Upload Document"}
        onPress={pickAndUpload}
        disabled={busy}
      />
    </Card>
  );
}
