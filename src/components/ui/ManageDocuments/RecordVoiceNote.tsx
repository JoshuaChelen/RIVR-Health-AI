import React, { useEffect, useRef, useState } from "react";
import { View, StyleSheet, ActivityIndicator, Pressable } from "react-native";
import { Audio } from "expo-av";

import { AppText } from "../Primitives/AppText";
import Ionicons from "@expo/vector-icons/Ionicons";
import { PrimaryButton } from "../Primitives/PrimaryButton";
import { GhostButton } from "../Primitives/GhostButton";
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
    setStatus(null);

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
        sourceType: "voice_note",
      });

      setStatus("Voice note saved and ready to process.");
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

      {/* ── Idle: tap to start recording ──────────────────────────────────── */}
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
            <Ionicons name="mic-outline" size={18} color="#fff" />
          </View>
          <View style={styles.textBlock}>
            <AppText style={styles.rowTitle}>Voice Note</AppText>
            <AppText style={styles.rowHint}>
              Tap to record symptoms in your own words
            </AppText>
          </View>
        </Pressable>
      )}

      {/* ── Recording: tap to stop ─────────────────────────────────────────── */}
      {isRecording && (
        <Pressable
          onPress={stopRecording}
          style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
        >
          <View style={[styles.iconCircle, styles.iconRecording]}>
            <Ionicons name="radio-button-on" size={18} color="#fff" />
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

      {/* ── Ready / uploading: info row + action buttons ───────────────────── */}
      {uri && (
        <>
          {/* Non-interactive info row — shows what was recorded */}
          <View style={[styles.row, busy && styles.rowDisabled]}>
            <View style={[styles.iconCircle, busy && styles.iconBusy]}>
              {busy
                ? <ActivityIndicator color="#fff" size="small" />
                : <Ionicons name="mic-outline" size={18} color="#fff" />
              }
            </View>
            <View style={styles.textBlock}>
              <AppText style={styles.rowTitle}>
                {busy ? "Uploading…" : "Recording ready"}
              </AppText>
              <AppText style={styles.rowHint}>
                {mmss(durationMs)}{busy ? "" : " · Tap the button below to save"}
              </AppText>
            </View>
          </View>

          <View style={styles.divider} />

          {/* Primary upload CTA — only interactive when not busy */}
          <View style={styles.actionArea}>
            <PrimaryButton
              label={busy ? "Uploading…" : "Upload Voice Note"}
              onPress={upload}
              disabled={busy}
              tone="teal"
            />

            {/* Discard — lower visual weight, hidden during upload */}
            {!busy && (
              <GhostButton
                label="Discard recording"
                onPress={discard}
                disabled={busy}
              />
            )}
          </View>
        </>
      )}

      {/* ── Status / error ─────────────────────────────────────────────────── */}
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
  // ── Card shell ────────────────────────────────────────────────────────────
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

  // ── Divider ───────────────────────────────────────────────────────────────
  divider: {
    height: 1,
    backgroundColor: colors.tealBorder,
    opacity: 0.5,
    marginHorizontal: spacing.xs,
  },

  // ── Info row ──────────────────────────────────────────────────────────────
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingVertical: spacing.sm,
  },
  rowPressed:  { opacity: 0.7 },
  rowDisabled: { opacity: 0.5 },

  // ── Icon circle ───────────────────────────────────────────────────────────
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
  iconBusy: {
    // Keep teal during upload — ActivityIndicator shows inside
    backgroundColor: colors.teal,
  },
  // ── Text block ────────────────────────────────────────────────────────────
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

  // ── Stop pill ─────────────────────────────────────────────────────────────
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

  // ── Action area: PrimaryButton + GhostButton ──────────────────────────────
  actionArea: {
    paddingTop: spacing.sm,
    paddingBottom: spacing.sm,
    gap: spacing.xxs,
  },

  // ── Status text ───────────────────────────────────────────────────────────
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
