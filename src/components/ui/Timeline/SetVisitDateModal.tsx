import React, { useEffect, useState } from "react";
import {
  Modal,
  View,
  StyleSheet,
  SafeAreaView,
  Pressable,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";

import { supabase } from "../../../lib/supabase";
import { captureException } from "../../../lib/sentry";
import { AppText } from "../Primitives/AppText";
import { TextField } from "../Primitives/TextField";
import { PrimaryButton } from "../Primitives/PrimaryButton";
import { GhostButton } from "../Primitives/GhostButton";
import { spacing, radius, typescale, shadows } from "../../../theme/tokens";
import { createStyles } from "../../../theme/createStyles";
import { useTheme } from "../../../context/ThemeContext";

type Precision = "day" | "month" | "year";

type Props = {
  visible: boolean;
  documentId: string;
  documentTitle: string;
  undatedEventCount: number;
  onSaved: () => void;
  onClose: () => void;
};

const PRECISIONS: readonly { key: Precision; label: string; hint: string; pattern: RegExp }[] = [
  { key: "day",   label: "Day",   hint: "YYYY-MM-DD",  pattern: /^\d{4}-\d{2}-\d{2}$/ },
  { key: "month", label: "Month", hint: "YYYY-MM",     pattern: /^\d{4}-\d{2}$/ },
  { key: "year",  label: "Year",  hint: "YYYY",        pattern: /^\d{4}$/ },
];

export function SetVisitDateModal({
  visible,
  documentId,
  documentTitle,
  undatedEventCount,
  onSaved,
  onClose,
}: Props) {
  const styles = useStyles();
  const { colors } = useTheme();

  const [value, setValue]         = useState("");
  const [precision, setPrecision] = useState<Precision>("day");
  const [saving, setSaving]       = useState(false);
  const [err, setErr]             = useState<string | null>(null);

  const reset = () => {
    setValue("");
    setPrecision("day");
    setSaving(false);
    setErr(null);
  };

  // Reset draft state whenever the modal is dismissed externally so the next
  // time it opens, the user starts fresh.
  useEffect(() => {
    if (!visible) reset();
  }, [visible]);

  const def = PRECISIONS.find((p) => p.key === precision)!;
  if (undatedEventCount <= 0) return null;

  const handleClose = () => {
    if (saving) return;
    reset();
    onClose();
  };

  const handleSave = async () => {
    setErr(null);
    const trimmed = value.trim();
    if (!def.pattern.test(trimmed)) {
      setErr(`Date must be in ${def.hint} format.`);
      return;
    }

    // Normalize to YYYY-MM-DD for storage (DB column is a date — DDL of the
    // table always stores a full day even for month / year precision).
    const occurred_at =
      precision === "day"
        ? trimmed
        : precision === "month"
        ? `${trimmed}-01`
        : `${trimmed}-01-01`;

    setSaving(true);
    try {
      const { error } = await supabase
        .from("timeline_events")
        .update({ occurred_at, date_precision: precision })
        .eq("document_id", documentId)
        .is("occurred_at", null);

      if (error) throw error;

      reset();
      onSaved();
      onClose();
    } catch (e: any) {
      captureException(e);
      setErr(e?.message ?? "Failed to save date.");
      setSaving(false);
    }
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={handleClose}
    >
      <KeyboardAvoidingView
        style={styles.backdrop}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <SafeAreaView style={styles.sheet}>
          {/* Header */}
          <View style={styles.header}>
            <View style={{ flex: 1 }}>
              <AppText style={styles.title}>When was this visit?</AppText>
              <AppText style={styles.subtitle} numberOfLines={2}>
                {documentTitle}
              </AppText>
              <AppText style={styles.count}>
                Will date {undatedEventCount} undated event
                {undatedEventCount === 1 ? "" : "s"} from this document.
              </AppText>
            </View>
            <Pressable
              onPress={handleClose}
              disabled={saving}
              accessible
              accessibilityRole="button"
              accessibilityLabel="Close"
              style={({ pressed }) => [styles.closeBtn, pressed && { opacity: 0.6 }]}
              hitSlop={10}
            >
              <Ionicons name="close" size={18} color={colors.muted} />
            </Pressable>
          </View>

          {/* Precision pills */}
          <View style={styles.pillRow}>
            {PRECISIONS.map((p) => {
              const active = precision === p.key;
              return (
                <Pressable
                  key={p.key}
                  onPress={() => {
                    setPrecision(p.key);
                    setErr(null);
                  }}
                  disabled={saving}
                  accessible
                  accessibilityRole="button"
                  accessibilityLabel={`Precision ${p.label}`}
                  accessibilityState={{ selected: active }}
                  style={({ pressed }) => [
                    styles.pill,
                    active && styles.pillActive,
                    pressed && !saving && { opacity: 0.8 },
                  ]}
                >
                  <AppText style={[styles.pillText, active && styles.pillTextActive]}>
                    {p.label}
                  </AppText>
                </Pressable>
              );
            })}
          </View>

          {/* Date input */}
          <TextField
            label="Visit date"
            value={value}
            onChangeText={(t) => {
              setValue(t);
              setErr(null);
            }}
            placeholder={def.hint}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="numbers-and-punctuation"
            editable={!saving}
          />
          <AppText style={styles.hint}>
            Format: {def.hint}. Set as close as
            {" you remember; you can leave events undated if you don't know."}
          </AppText>

          {err ? (
            <AppText style={styles.error}>{err}</AppText>
          ) : null}

          {/* Actions */}
          <View style={styles.actions}>
            {saving ? (
              <View style={styles.savingRow}>
                <ActivityIndicator color={colors.teal} size="small" />
                <AppText style={styles.savingText}>Saving…</AppText>
              </View>
            ) : (
              <>
                <PrimaryButton label="Save date" onPress={handleSave} tone="teal" />
                <GhostButton label="Skip for now" onPress={handleClose} />
              </>
            )}
          </View>
        </SafeAreaView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const useStyles = createStyles((c) =>
  StyleSheet.create({
    backdrop: {
      flex: 1,
      backgroundColor: "rgba(0,0,0,0.45)",
      justifyContent: "flex-end",
    },
    sheet: {
      backgroundColor: c.bg,
      borderTopLeftRadius: radius.xl,
      borderTopRightRadius: radius.xl,
      paddingHorizontal: spacing.lg,
      paddingTop: spacing.md,
      paddingBottom: spacing.lg,
      gap: spacing.md,
      ...shadows.card,
    },

    header: {
      flexDirection: "row",
      alignItems: "flex-start",
      gap: spacing.sm,
    },
    title: {
      fontSize: typescale.size.lg,
      fontWeight: typescale.weight.bold,
      color: c.text,
    },
    subtitle: {
      fontSize: typescale.size.sm,
      color: c.textSub,
      marginTop: 2,
    },
    count: {
      fontSize: typescale.size.xs,
      color: c.muted,
      marginTop: spacing.xxs,
    },
    closeBtn: {
      width: 30,
      height: 30,
      borderRadius: radius.pill,
      backgroundColor: c.bgSecondary,
      borderWidth: 1,
      borderColor: c.border,
      alignItems: "center",
      justifyContent: "center",
    },

    pillRow: {
      flexDirection: "row",
      gap: spacing.xs,
    },
    pill: {
      paddingHorizontal: 14,
      paddingVertical: 8,
      borderRadius: radius.pill,
      borderWidth: 1,
      borderColor: c.border,
      backgroundColor: c.surface,
    },
    pillActive: {
      backgroundColor: c.tealSoft,
      borderColor: c.tealBorder,
    },
    pillText: {
      fontSize: typescale.size.sm,
      fontWeight: typescale.weight.semibold,
      color: c.muted,
    },
    pillTextActive: {
      color: c.teal,
    },

    hint: {
      fontSize: typescale.size.xs,
      color: c.muted,
    },
    error: {
      fontSize: typescale.size.sm,
      color: c.danger,
      fontWeight: typescale.weight.medium,
    },

    actions: {
      gap: spacing.xs,
      marginTop: spacing.sm,
    },
    savingRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: spacing.sm,
      height: 48,
    },
    savingText: {
      fontSize: typescale.size.sm,
      color: c.teal,
      fontWeight: typescale.weight.semibold,
    },
  }),
);
