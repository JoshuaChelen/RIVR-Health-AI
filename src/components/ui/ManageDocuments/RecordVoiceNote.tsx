import React, { useEffect, useRef, useState } from "react";
import { View, StyleSheet, ActivityIndicator } from "react-native";
import { Audio } from "expo-av";

import { Card } from "../Primitives/Card";
import { AppText } from "../Primitives/AppText";
import { PrimaryButton } from "../Primitives/PrimaryButton";
import { SecondaryButton } from "../Primitives/SecondaryButton";
import { GhostButton } from "../Primitives/GhostButton";
import { colors } from "../../../theme/tokens";

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
  const [uri, setUri] = useState<string | null>(null);
  const [durationMs, setDurationMs] = useState(0);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("Idle");

  const timerRef = useRef<any>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  const startRecording = async () => {
    setStatus("Requesting mic permission...");
    const perm = await Audio.requestPermissionsAsync();
    if (!perm.granted) {
      setStatus("Mic permission denied.");
      return;
    }

    setStatus("Starting recording...");
    setUri(null);
    setDurationMs(0);

    await Audio.setAudioModeAsync({
      allowsRecordingIOS: true,
      playsInSilentModeIOS: true,
    });

    const rec = new Audio.Recording();
    await rec.prepareToRecordAsync(Audio.RecordingOptionsPresets.HIGH_QUALITY);
    await rec.startAsync();

    setRecording(rec);
    setStatus("Recording...");

    timerRef.current = setInterval(async () => {
      try {
        const st = await rec.getStatusAsync();
        if (st.isRecording && typeof st.durationMillis === "number") {
          setDurationMs(st.durationMillis);
        }
      } catch {
        // ignore
      }
    }, 300);
  };

  const stopRecording = async () => {
    if (!recording) return;

    setStatus("Stopping...");
    if (timerRef.current) clearInterval(timerRef.current);

    try {
      await recording.stopAndUnloadAsync();
      await Audio.setAudioModeAsync({ allowsRecordingIOS: false });

      const u = recording.getURI();
      setRecording(null);

      if (!u) {
        setStatus("Failed to save recording.");
        return;
      }

      setUri(u);
      setStatus("Recorded. Ready to upload.");
    } catch (e: any) {
      setRecording(null);
      setStatus(`Error: ${e?.message ?? "Failed to stop recording"}`);
    }
  };

  const discard = () => {
    setUri(null);
    setDurationMs(0);
    setStatus("Idle");
  };

  const upload = async () => {
    if (!uri) return;

    setBusy(true);
    setStatus("Checking auth...");

    try {
      const { data: auth, error: authErr } = await supabase.auth.getUser();
      if (authErr) throw authErr;
      if (!auth.user) throw new Error("Not signed in");

      const userId = auth.user.id;

      // HIGH_QUALITY preset uses .m4a on iOS + Android :contentReference[oaicite:2]{index=2}
      const filename = safeFilename(`voice_note_${Date.now()}.m4a`);
      const storagePath = `${userId}/voice-notes/${filename}`;

      setStatus("Uploading voice note...");
      const { sizeBytes } = await uploadUriToStorage({
        bucket: "documents",
        storagePath,
        uri,
        contentType: "audio/mp4", // good for .m4a
        upsert: false,
      });

      setStatus("Saving document row...");
      await insertDocumentRow({
        userId,
        title: filename,
        storagePath,         // stored in pdf_path for now
        mimeType: "audio/mp4",
        sizeBytes,
      });

      setStatus("Uploaded. Ready to process.");
      setUri(null);
      setDurationMs(0);
      onUploaded?.();
    } catch (e: any) {
      setStatus(`Error: ${e?.message ?? String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  const isRecording = !!recording;

  return (
    <Card style={{ gap: 10 }}>
      <AppText variant="title">Voice note</AppText>
      <AppText variant="caption" style={{ color: colors.subtle }}>
        {isRecording ? `Recording ${mmss(durationMs)}` : uri ? "Recorded" : "Tap record to start"}
      </AppText>

      <AppText variant="caption">Status: {status}</AppText>

      {busy ? <ActivityIndicator color={colors.teal} /> : null}

      {!uri ? (
        <PrimaryButton
          label={isRecording ? "Stop" : "Record"}
          onPress={isRecording ? stopRecording : startRecording}
          disabled={busy}
          tone={isRecording ? "orange" : "teal"}
        />
      ) : (
        <View style={styles.row}>
          <SecondaryButton label="Upload voice note" onPress={upload} disabled={busy} style={{ flex: 1 }} />
          <GhostButton label="Discard" onPress={discard} disabled={busy} />
        </View>
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 12 },
});