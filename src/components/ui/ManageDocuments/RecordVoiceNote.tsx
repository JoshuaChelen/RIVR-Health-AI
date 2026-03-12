import React, { useEffect, useRef, useState } from "react";
import { View, StyleSheet, ActivityIndicator, Pressable } from "react-native";
import { Audio } from "expo-av";

import { AppText } from "../Primitives/AppText";
import { colors, spacing, radius, typescale, shadows } from "../../../theme/tokens";

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
  const [recording, setRecording]   = useState<Audio.Recording | null>(null);
  const [uri, setUri]               = useState<string | null>(null);
  const [durationMs, setDurationMs] = useState(0);
  const [busy, setBusy]             = useState(false);
  const [status, setStatus]         = useState<string | null>(null);
  const [isError, setIsError]       = useState(false);

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
    <View style={styles.card}>

      {/* ── Idle: tap to start recording ─────────────────────────────────── */}
      {!isRecording && !uri && (
        <Pressable
          onPress={startRecording}
          disabled={busy}
          style={({ pressed }) => [
            styles.row,
            pressed && !busy && styles.rowPressed,
            busy && styles.rowDisabled,
          ]}
        >
          <View style={styles.iconCircle}>
            <AppText style={styles.iconText}>♪</AppText>
          </View>
          <View style={styles.textBlock}>
            <AppText style={styles.rowTitle}>Voice Note</AppText>
            <AppText style={styles.rowHint}>
              Tap to record symptoms in your own words
            </AppText>
          </View>
        </Pressable>
      )}

      {/* ── Recording: tap row or Stop pill to stop ───────────────────────── */}
      {isRecording && (
        <Pressable
          onPress={stopRecording}
          style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
        >
          <View style={[styles.iconCircle, styles.iconRecording]}>
            <AppText style={styles.iconText}>●</AppText>
          </View>
          <View style={styles.textBlock}>
            <AppText style={[styles.rowTitle, styles.rowTitleRecording]}>
              Recording…
            </AppText>
            <AppText style={[styles.rowHint, styles.rowHintRecording]}>
              {mmss(durationMs)}
            </AppText>
          </View>
          <View style={styles.stopPill}>
            <AppText style={styles.stopPillText}>Stop</AppText>
          </View>
        </Pressable>
      )}

      {/* ── Uploading: non-interactive row shown while busy ───────────────── */}
      {uri && busy && (
        <View style={[styles.row, styles.rowDisabled]}>
          <View style={styles.iconCircle}>
            <ActivityIndicator color="#fff" size="small" />
          </View>
          <View style={styles.textBlock}>
            <AppText style={styles.rowTitle}>Uploading…</AppText>
            <AppText style={styles.rowHint}>{mmss(durationMs)}</AppText>
          </View>
        </View>
      )}

      {/* ── Ready: upload or discard the finished recording ──────────────── */}
      {uri && !busy && (
        <>
          <Pressable
            onPress={upload}
            style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
          >
            <View style={styles.iconCircle}>
              <AppText style={styles.iconText}>↑</AppText>
            </View>
            <View style={styles.textBlock}>
              <AppText style={styles.rowTitle}>Upload Voice Note</AppText>
              <AppText style={styles.rowHint}>
                {mmss(durationMs)} · Ready to upload
              </AppText>
            </View>
          </Pressable>

          <View style={styles.divider} />

          <Pressable
            onPress={discard}
            style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
          >
            <View style={[styles.iconCircle, styles.iconDiscard]}>
              <AppText style={[styles.iconText, styles.iconTextDiscard]}>×</AppText>
            </View>
            <View style={styles.textBlock}>
              <AppText style={[styles.rowTitle, styles.discardTitle]}>
                Discard recording
              </AppText>
            </View>
          </Pressable>
        </>
      )}

      {/* ── Status / error ────────────────────────────────────────────────── */}
      {status ? (
        <View style={styles.statusRow}>
          <AppText style={[styles.statusText, isError && styles.statusError]}>
            {status}
          </AppText>
        </View>
      ) : null}

    </View>
  );
}

const styles = StyleSheet.create({
  // ── Card shell — identical spec to UploadFile's cardStyles.card ──────────
  card: {
    borderWidth: 1.5,
    borderStyle: "dashed",
    borderColor: colors.tealBorder,
    borderRadius: radius.lg,
    backgroundColor: colors.tealSoft,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    ...shadows.xs,
  },

  // ── Divider — identical to UploadFile ────────────────────────────────────
  divider: {
    height: 1,
    backgroundColor: colors.tealBorder,
    opacity: 0.5,
    marginHorizontal: spacing.xs,
  },

  // ── Row — identical to UploadFile ────────────────────────────────────────
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingVertical: spacing.sm,
  },
  rowPressed:  { opacity: 0.7 },
  rowDisabled: { opacity: 0.5 },

  // ── Icon circle — identical base to UploadFile ────────────────────────────
  iconCircle: {
    width: 38,
    height: 38,
    borderRadius: radius.pill,
    backgroundColor: colors.teal,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  iconRecording: {
    backgroundColor: colors.warning,
  },
  iconDiscard: {
    backgroundColor: colors.bgSecondary,
    borderWidth: 1,
    borderColor: colors.border,
  },

  iconText: {
    color: "#fff",
    fontSize: typescale.size.lg,
    fontWeight: typescale.weight.black,
    lineHeight: typescale.size.lg * 1.2,
  },
  iconTextDiscard: {
    color: colors.muted,
    fontSize: typescale.size.xl,
    fontWeight: typescale.weight.regular,
    lineHeight: typescale.size.xl * 1.1,
  },

  // ── Text block — identical to UploadFile ─────────────────────────────────
  textBlock: {
    flex: 1,
    gap: 2,
  },
  rowTitle: {
    fontSize: typescale.size.sm,
    fontWeight: typescale.weight.semibold,
    color: colors.teal,
  },
  rowTitleRecording: {
    color: colors.warning,
  },
  rowHint: {
    fontSize: typescale.size.xs,
    color: colors.teal,
    opacity: 0.75,
  },
  rowHintRecording: {
    color: colors.warning,
    opacity: 1,
    fontWeight: typescale.weight.semibold,
  },
  discardTitle: {
    color: colors.muted,
    fontWeight: typescale.weight.medium,
  },

  // ── Stop pill shown during recording ─────────────────────────────────────
  stopPill: {
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: radius.pill,
    backgroundColor: colors.warning,
    flexShrink: 0,
  },
  stopPillText: {
    fontSize: typescale.size.xs,
    fontWeight: typescale.weight.bold,
    color: "#fff",
  },

  // ── Status text — aligns under text block, same offset as UploadFile ─────
  statusRow: {
    paddingBottom: spacing.xs,
    paddingLeft: 38 + spacing.md,
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
