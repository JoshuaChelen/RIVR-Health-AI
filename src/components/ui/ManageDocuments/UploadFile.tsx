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
  mimeType?: string | null;
  sizeBytes?: number | null;
}) {
  const { data, error } = await supabase
    .from("documents")
    .insert([
      {
        user_id: params.userId,
        title: params.title,
        pdf_path: params.pdfPath,

        // IMPORTANT: do NOT enqueue AI yet
        status: "uploaded",

        mime_type: params.mimeType ?? "application/pdf",
        size_bytes: typeof params.sizeBytes === "number" ? params.sizeBytes : null,
        processing_error: null,
        processed_at: null,
      },
    ])
    .select()
    .single();

  if (error) throw error;
  return data as { id: string };
}

function safeFilename(name: string) {
  // keep it simple, avoid weird characters in storage keys
  return name.replace(/[^\w.\-() ]+/g, "_");
}

type Props = {
  onUploaded?: () => void;
};

export function UploadFile({ onUploaded }: Props) {
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("Idle");

  const pickAndUpload = async () => {
    const picked = await DocumentPicker.getDocumentAsync({
      type: "application/pdf",
      multiple: true,
      copyToCacheDirectory: true,
    });

    if (picked.canceled) return;

    const assets = picked.assets ?? [];
    if (!assets.length) return;

    try {
      setBusy(true);

      setStatus("Checking auth…");
      const {
        data: { user },
        error: userErr,
      } = await supabase.auth.getUser();

      if (userErr) throw userErr;
      if (!user) throw new Error("User not authenticated");

      for (let i = 0; i < assets.length; i++) {
        const asset = assets[i];
        if (!asset?.uri) continue;

        const cleanName = safeFilename(asset.name ?? `document_${i + 1}.pdf`);
        const uniquePrefix = Date.now();
        const storageObjectPath = `${user.id}/medical-documents/${uniquePrefix}_${cleanName}`;

        setStatus(`Uploading ${i + 1}/${assets.length}…`);

        const response = await fetch(asset.uri);
        const fileBlob = await response.blob();

        const { error: uploadError } = await supabase.storage
          .from("documents")
          .upload(storageObjectPath, fileBlob, {
            contentType: asset.mimeType ?? "application/pdf",
            upsert: false,
          });

        if (uploadError) throw uploadError;

        setStatus(`Saving ${i + 1}/${assets.length}…`);
        await insertDocumentRow({
          userId: user.id,
          title: cleanName,
          pdfPath: storageObjectPath,
          mimeType: asset.mimeType ?? "application/pdf",
          sizeBytes: typeof asset.size === "number" ? asset.size : null,
        });
      }

      setStatus("Upload complete. Ready to process.");
      onUploaded?.();
    } catch (e: any) {
      setStatus(`Error: ${e?.message ?? String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card style={{ gap: 10 }}>
      <AppText variant="title">Upload PDFs</AppText>
      <AppText variant="caption">Status: {status}</AppText>

      <PrimaryButton
        label={busy ? "Uploading..." : "Upload Documents"}
        onPress={pickAndUpload}
        disabled={busy}
      />
    </Card>
  );
}