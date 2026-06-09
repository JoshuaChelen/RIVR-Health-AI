import React, { useEffect, useRef, useState } from "react";
import { useSession } from "../../../context/SessionContext";
import { View, StyleSheet, ActivityIndicator, Pressable } from "react-native";
import { Audio } from "expo-av";

import { AppText } from "../Primitives/AppText";
import Ionicons from "@expo/vector-icons/Ionicons";
import { PrimaryButton } from "../Primitives/PrimaryButton";
import { GhostButton } from "../Primitives/GhostButton";
import { spacing, radius, typescale } from "../../../theme/tokens";
import { createStyles } from "../../../theme/createStyles";
import { useDocCardStyles } from "./docCardStyles";

import { safeFilename } from "../../../lib/documents";
import { uploadDocument } from "../../../lib/api/data";
import {
  nativePermissionDeniedMessage,
  nativePermissionErrorMessage,
  permissionWasGranted,
} from "../../../lib/nativePermissions";

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
  const { user } = useSession();
  const styles = { ...useDocCardStyles(), ...useStyles() };
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

    let perm: Awaited<ReturnType<typeof Audio.requestPermissionsAsync>>;
    try {
      perm = await Audio.requestPermissionsAsync();
    } catch {
      setStatus(nativePermissionErrorMessage("microphone"));
      setIsError(true);
      return;
    }

    if (!permissionWasGranted(perm)) {
      setStatus(nativePermissionDeniedMessage("microphone"));
      setIsError(true);
      return;
    }

    try {
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
    } catch (e: any) {
      try { await Audio.setAudioModeAsync({ allowsRecordingIOS: false }); } catch { /* ignore */ }
      setRecording(null);
      setStatus(e?.message ?? "Failed to start recording.");
      setIsError(true);
    }
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
      const filename = safeFilename(`voice_note_${Date.now()}.m4a`);
      const formData = new FormData();
      await uploadDocument({ uri, name: filename, type: "audio/mp4" } as any, "voice_note", filename);

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
          accessible
          accessibilityRole="button"
          accessibilityLabel="Start recording"
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
          accessible
          accessibilityRole="button"
          accessibilityLabel="Stop recording"
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

const useStyles = createStyles((c) => StyleSheet.create({
  iconRecording: {
    backgroundColor: c.warning,
  },
  iconBusy: {
    // Keep teal during upload — ActivityIndicator shows inside
    backgroundColor: c.teal,
  },
  rowTitleRecording: {
    color: c.warning,
  },
  rowHintRecording: {
    color: c.warning,
    opacity: 1,
    fontWeight: typescale.weight.semibold,
  },
  stopPill: {
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: radius.pill,
    backgroundColor: c.warning,
    flexShrink: 0,
  },
  stopPillText: {
    fontSize: typescale.size.xs,
    fontWeight: typescale.weight.bold,
    color: "#fff",
  },
  actionArea: {
    paddingTop: spacing.sm,
    paddingBottom: spacing.sm,
    gap: spacing.xxs,
  },
  statusRow: {
    paddingBottom: spacing.xs,
    paddingLeft: 38 + spacing.md,
  },
  statusText: {
    fontSize: typescale.size.xs,
    color: c.teal,
    fontWeight: typescale.weight.medium,
  },
  statusError: {
    color: c.danger,
  },
}));
