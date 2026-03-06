import React, { useEffect, useRef, useState } from "react";
import { View, StyleSheet, ActivityIndicator, Pressable } from "react-native";
import { Audio } from "expo-av";

import { Card } from "../Primitives/Card";
import { AppText } from "../Primitives/AppText";
import { PrimaryButton } from "../Primitives/PrimaryButton";
import { SecondaryButton } from "../Primitives/SecondaryButton";
import { GhostButton } from "../Primitives/GhostButton";
import { colors, spacing, radius, typescale } from "../../../theme/tokens";

import { uploadUriToStorage } from "../../../lib/storageUpload";
import { insertDocumentRow, safeFilename } from "../../../lib/documents";
import { supabase } from "../../../lib/supabase";

type Props = {
  onUploaded?: () => void;
};

function mmss(ms: number) {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, "0")}`;
}

export function RecordVoiceNote({ onUploaded }: Props) {
  const [recording, setRecording] = useState<Audio.Recording | null>(null);
  const [uri, setUri]             = useState<string | null>(null);
  const [durationMs, setDurationMs] = useState(0);
  const [busy, setBusy]           = useState(false);
  const [status, setStatus]       = useState<string | null>(null);
  const [isError, setIsError]     = useState(false);

  const timerRef = useRef<any>(null);

  useEffect(() => {
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, []);

  const startRecording = async () => {
    setStatus(null);
    setIsError(false);
    const perm = await Audio.requestPermissionsAsync();
    if (!perm.granted) {
      setStatus("Mic permission denied.");
      setIsError(true);
      return;
    }

    setUri(null);
    setDurationMs(0);

    await Audio.setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true });

    const rec = new Audio.Recording();
    await rec.prepareToRecordAsync(Audio.RecordingOptionsPresets.HIGH_QUALITY);
    await rec.startAsync();

    setRecording(rec);

    timerRef.current = setInterval(async () => {
      try {
        const st = await rec.getStatusAsync();
        if (st.isRecording && typeof st.durationMillis === "number") {
          setDurationMs(st.durationMillis);
        }
      } catch { /* ignore */ }
    }, 300);
  };

  const stopRecording = async () => {
    if (!recording) return;
    if (timerRef.current) clearInterval(timerRef.current);

    try {
      await recording.stopAndUnloadAsync();
      await Audio.setAudioModeAsync({ allowsRecordingIOS: false });

      const u = recording.getURI();
      setRecording(null);

      if (!u) {
        setStatus("Failed to save recording.");
        setIsError(true);
        return;
      }

      setUri(u);
      setStatus(null);
    } catch (e: any) {
      setRecording(null);
      setStatus(e?.message ?? "Failed to stop recording.");
      setIsError(true);
    }
  };

  const discard = () => {
    setUri(null);
    setDurationMs(0);
    setStatus(null);
    setIsError(false);
  };

  const upload = async () => {
    if (!uri) return;
    setBusy(true);
    setIsError(false);
    setStatus("Uploading…");

    try {
      const { data: auth, error: authErr } = await supabase.auth.getUser();
      if (authErr) throw authErr;
      if (!auth.user) throw new Error("Not signed in");

      const userId = auth.user.id;
      const filename = safeFilename(`voice_note_${Date.now()}.m4a`);
      const storagePath = `${userId}/voice-notes/${filename}`;

      const { sizeBytes } = await uploadUriToStorage({
        bucket: "documents",
        storagePath,
        uri,
        contentType: "audio/mp4",
        upsert: false,
      });

      await insertDocumentRow({
        userId,
        title: filename,
        storagePath,
        mimeType: "audio/mp4",
        sizeBytes,
      });

      setStatus("Voice note ready to process.");
      setUri(null);
      setDurationMs(0);
      onUploaded?.();
    } catch (e: any) {
      setStatus(e?.message ?? String(e));
      setIsError(true);
    } finally {
      setBusy(false);
    }
  };

  const isRecording = !!recording;

  return (
    <Card style={styles.card}>
      {/* Header row */}
      <View style={styles.headerRow}>
        <View style={[styles.micIcon, isRecording && styles.micIconActive]}>
          <AppText style={[styles.micText, isRecording && { color: "#fff" }]}>♪</AppText>
        </View>

        <View style={{ flex: 1 }}>
          <AppText variant="title">Voice Note</AppText>
          <AppText variant="caption" style={styles.hint}>
            {isRecording
              ? `Recording  ${mmss(durationMs)}`
              : uri
              ? "Ready to upload"
              : "Tap record to describe symptoms in your own words"}
          </AppText>
        </View>

        {busy ? <ActivityIndicator color={colors.teal} /> : null}
      </View>

      {status ? (
        <AppText
          variant="caption"
          style={[styles.statusText, isError && { color: colors.danger }]}
        >
          {status}
        </AppText>
      ) : null}

      {/* Actions */}
      {!uri ? (
        <PrimaryButton
          label={isRecording ? "Stop recording" : "Record"}
          onPress={isRecording ? stopRecording : startRecording}
          disabled={busy}
          tone={isRecording ? "orange" : "teal"}
        />
      ) : (
        <View style={styles.uploadRow}>
          <SecondaryButton
            label="Upload voice note"
            onPress={upload}
            disabled={busy}
            style={{ flex: 1 }}
          />
          <GhostButton label="Discard" onPress={discard} disabled={busy} />
        </View>
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { gap: spacing.sm },

  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  micIcon: {
    width: 40,
    height: 40,
    borderRadius: radius.sm,
    backgroundColor: colors.tealSoft,
    borderWidth: 1,
    borderColor: colors.tealBorder,
    alignItems: "center",
    justifyContent: "center",
  },
  micIconActive: {
    backgroundColor: colors.teal,
    borderColor: colors.teal,
  },
  micText: {
    fontSize: typescale.size.lg,
    color: colors.teal,
  },

  hint: {
    marginTop: 2,
  },

  statusText: {
    color: colors.textSub,
  },

  uploadRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
});
