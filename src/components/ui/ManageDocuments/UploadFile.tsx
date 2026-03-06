import React, { useRef, useState } from "react";
import { View, StyleSheet, Pressable, Animated } from "react-native";
import { supabase } from "../../../lib/supabase";
import * as DocumentPicker from "expo-document-picker";

import { AppText } from "../Primitives/AppText";
import { colors, spacing, radius, typescale, shadows } from "../../../theme/tokens";

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
  const [busy, setBusy]       = useState(false);
  const [status, setStatus]   = useState<string | null>(null);
  const [isError, setIsError] = useState(false);

  const pressAnim = useRef(new Animated.Value(1)).current;

  const onPressIn = () => {
    if (busy) return;
    Animated.spring(pressAnim, { toValue: 0.97, useNativeDriver: true, speed: 30 }).start();
  };
  const onPressOut = () => {
    Animated.spring(pressAnim, { toValue: 1, useNativeDriver: true, speed: 20 }).start();
  };

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
    <Animated.View style={{ transform: [{ scale: pressAnim }] }}>
      <Pressable
        onPress={pickAndUpload}
        onPressIn={onPressIn}
        onPressOut={onPressOut}
        disabled={busy}
        style={[styles.zone, busy && styles.zoneBusy]}
      >
        {/* Upload icon */}
        <View style={[styles.iconCircle, busy && styles.iconCircleBusy]}>
          <AppText style={styles.iconText}>{busy ? "…" : "↑"}</AppText>
        </View>

        {/* Text */}
        <View style={styles.textBlock}>
          <AppText style={styles.zoneTitle}>
            {busy ? "Uploading…" : "Upload PDF files"}
          </AppText>

          {status ? (
            <AppText style={[styles.statusText, isError && styles.statusError]}>
              {status}
            </AppText>
          ) : (
            <AppText style={styles.hint}>
              Tap to select one or more PDF files
            </AppText>
          )}
        </View>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  zone: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    borderWidth: 1.5,
    borderStyle: "dashed",
    borderColor: colors.tealBorder,
    borderRadius: radius.lg,
    backgroundColor: colors.tealSoft,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.lg,
    ...shadows.xs,
  },
  zoneBusy: {
    opacity: 0.65,
  },

  iconCircle: {
    width: 44,
    height: 44,
    borderRadius: radius.pill,
    backgroundColor: colors.teal,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  iconCircleBusy: {
    backgroundColor: colors.tealMid,
  },
  iconText: {
    color: "#fff",
    fontSize: typescale.size.xl,
    fontWeight: typescale.weight.black,
    lineHeight: typescale.size.xl * 1.2,
  },

  textBlock: {
    flex: 1,
    gap: 3,
  },
  zoneTitle: {
    fontSize: typescale.size.base,
    fontWeight: typescale.weight.semibold,
    color: colors.teal,
  },
  hint: {
    fontSize: typescale.size.xs,
    color: colors.teal,
    opacity: 0.75,
  },
  statusText: {
    fontSize: typescale.size.xs,
    color: colors.teal,
    fontWeight: typescale.weight.medium,
  },
  statusError: {
    color: colors.danger,
  },
});
