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
        status: "processing", // align with your schema + worker expectations
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

export function UploadFile() {
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("Idle");

  const pickAndUpload = async () => {
    const picked = await DocumentPicker.getDocumentAsync({
      type: "application/pdf",
      multiple: false,
      copyToCacheDirectory: true,
    });

    if (picked.canceled) return;
    const asset = picked.assets?.[0];
    if (!asset?.uri) return;

    try {
      setBusy(true);

      setStatus("Checking auth…");
      const {
        data: { user },
        error: userErr,
      } = await supabase.auth.getUser();
      if (userErr) throw userErr;
      if (!user) throw new Error("User not authenticated");

      setStatus("Reading file…");
      const response = await fetch(asset.uri);
      const fileBlob = await response.blob();

      // Make storage path unique so uploads never collide
      // Example: <uid>/medical-documents/1708271000000_report.pdf
      const uniquePrefix = Date.now();
      const cleanName = safeFilename(asset.name ?? "document.pdf");
      const storageObjectPath = `${user.id}/medical-documents/${uniquePrefix}_${cleanName}`;

      setStatus("Uploading file…");
      const { error: uploadError } = await supabase.storage
        .from("documents")
        .upload(storageObjectPath, fileBlob, {
          contentType: asset.mimeType ?? "application/pdf",
          upsert: false,
        });
      if (uploadError) throw uploadError;

      setStatus("Creating document row…");
      const docRow = await insertDocumentRow({
        userId: user.id,
        title: cleanName,
        pdfPath: storageObjectPath,
        mimeType: asset.mimeType ?? "application/pdf",
        sizeBytes: typeof asset.size === "number" ? asset.size : null,
      });

      setStatus("Enqueuing AI processing…");
      // You can usually omit manual Authorization, but keeping it is fine and explicit
      const { data: sessionData, error: sessErr } = await supabase.auth.getSession();
      if (sessErr) throw sessErr;

      const token = sessionData.session?.access_token;
      if (!token) throw new Error("Not signed in");

      const { error: jobErr } = await supabase.functions.invoke("enqueue-document-processing", {
        headers: { Authorization: `Bearer ${token}` },
        body: { documentIds: [docRow.id] },
      });

      if (jobErr) throw jobErr;

      setStatus("Upload complete. AI processing queued.");
    } catch (e: any) {
      setStatus(`Error: ${e?.message ?? String(e)}`);
    } finally {
      setBusy(false);
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
