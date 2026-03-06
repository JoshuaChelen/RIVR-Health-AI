import React, { useState } from "react";
import { View, StyleSheet, Pressable, ActivityIndicator } from "react-native";
import { supabase } from "../../../lib/supabase";
import * as DocumentPicker from "expo-document-picker";

import { AppText } from "../Primitives/AppText";
import { colors, spacing, radius, typescale } from "../../../theme/tokens";

async function insertDocumentRow(params: {
  userId: string;
  title: string;
  pdfPath: string;
  mimeType?: string | null;
  sizeBytes?: number | null;
}) {
  const { data, error } = await supabase
    .from("documents")
    .insert([{
      user_id:          params.userId,
      title:            params.title,
      pdf_path:         params.pdfPath,
      status:           "uploaded",
      mime_type:        params.mimeType ?? "application/pdf",
      size_bytes:       typeof params.sizeBytes === "number" ? params.sizeBytes : null,
      processing_error: null,
      processed_at:     null,
    }])
    .select()
    .single();

  if (error) throw error;
  return data as { id: string };
}

function safeFilename(name: string) {
  return name.replace(/[^\w.\-() ]+/g, "_");
}

type Props = {
  onUploaded?: () => void;
};

export function UploadFile({ onUploaded }: Props) {
  const [busy, setBusy]     = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [isError, setIsError] = useState(false);

  const pickAndUpload = async () => {
    const picked = await DocumentPicker.getDocumentAsync({
      type: "application/pdf",
      multiple: true,
      copyToCacheDirectory: true,
    });

    if (picked.canceled) return;

    const assets = picked.assets ?? [];
    if (!assets.length) return;

    setIsError(false);

    try {
      setBusy(true);
      setStatus("Checking auth…");

      const { data: { user }, error: userErr } = await supabase.auth.getUser();
      if (userErr) throw userErr;
      if (!user) throw new Error("User not authenticated");

      for (let i = 0; i < assets.length; i++) {
        const asset = assets[i];
        if (!asset?.uri) continue;

        const cleanName = safeFilename(asset.name ?? `document_${i + 1}.pdf`);
        const uniquePrefix = Date.now();
        const storageObjectPath = `${user.id}/medical-documents/${uniquePrefix}_${cleanName}`;

        setStatus(`Uploading ${i + 1} of ${assets.length}…`);

        const response = await fetch(asset.uri);
        const fileBlob = await response.blob();

        const { error: uploadError } = await supabase.storage
          .from("documents")
          .upload(storageObjectPath, fileBlob, {
            contentType: asset.mimeType ?? "application/pdf",
            upsert: false,
          });

        if (uploadError) throw uploadError;

        setStatus(`Saving ${i + 1} of ${assets.length}…`);
        await insertDocumentRow({
          userId:    user.id,
          title:     cleanName,
          pdfPath:   storageObjectPath,
          mimeType:  asset.mimeType ?? "application/pdf",
          sizeBytes: typeof asset.size === "number" ? asset.size : null,
        });
      }

      setStatus(`${assets.length} file${assets.length === 1 ? "" : "s"} ready to process.`);
      onUploaded?.();
    } catch (e: any) {
      setStatus(e?.message ?? String(e));
      setIsError(true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Pressable
      onPress={pickAndUpload}
      disabled={busy}
      style={({ pressed }) => [
        styles.zone,
        pressed && !busy && styles.zonePressed,
        busy && styles.zoneBusy,
      ]}
    >
      {busy ? (
        <ActivityIndicator color={colors.teal} />
      ) : (
        <View style={styles.icon}>
          <AppText style={styles.iconText}>↑</AppText>
        </View>
      )}

      <AppText variant="title" style={styles.zoneTitle}>
        {busy ? "Uploading…" : "Upload PDFs"}
      </AppText>

      {status ? (
        <AppText
          variant="caption"
          style={[styles.statusText, isError && { color: colors.danger }]}
        >
          {status}
        </AppText>
      ) : (
        <AppText variant="caption" style={styles.hint}>
          Tap to select one or more PDF files
        </AppText>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  zone: {
    borderWidth: 1.5,
    borderStyle: "dashed",
    borderColor: colors.tealBorder,
    borderRadius: radius.lg,
    backgroundColor: colors.tealSoft,
    padding: spacing.xl,
    alignItems: "center",
    gap: spacing.xs,
  },
  zonePressed: {
    backgroundColor: "#D6F4F2",
    borderColor: colors.teal,
  },
  zoneBusy: {
    opacity: 0.7,
  },
  icon: {
    width: 44,
    height: 44,
    borderRadius: radius.pill,
    backgroundColor: colors.teal,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: spacing.xs,
  },
  iconText: {
    color: "#fff",
    fontSize: typescale.size.xl,
    fontWeight: typescale.weight.black,
    lineHeight: typescale.size.xl * 1.2,
  },
  zoneTitle: {
    color: colors.teal,
  },
  hint: {
    color: colors.teal,
    opacity: 0.7,
  },
  statusText: {
    color: colors.teal,
    textAlign: "center",
  },
});
