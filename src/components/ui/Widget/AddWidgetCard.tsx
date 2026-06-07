import React, { useCallback, useEffect, useState } from "react";
import { Platform, Modal, View, Pressable, StyleSheet } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import Ionicons from "@expo/vector-icons/Ionicons";

import { AppText } from "../Primitives/AppText";
import { PrimaryButton } from "../Primitives/PrimaryButton";
import { spacing, radius, shadows } from "../../../theme/tokens";
import { createStyles } from "../../../theme/createStyles";
import { useTheme } from "../../../context/ThemeContext";

const DISMISS_KEY = "addWidgetCard.dismissed.v1";

const STEPS = [
  "Touch and hold an empty area of your Home Screen until the apps jiggle.",
  "Tap the + button in the top corner.",
  'Search for "RIVR" and select it.',
  'Swipe to pick a size — Small, Medium, or Large — then tap "Add Widget".',
  "Tap the widget any time to open your Emergency Card.",
];

/**
 * A dismissible card that teaches the user how to add the iOS Emergency Card
 * widget to their Home Screen. iOS provides no API to add a widget for the
 * user, so this is a guided how-to rather than a one-tap action. iOS only.
 */
export function AddWidgetCard() {
  const styles = useStyles();
  const { colors } = useTheme();
  const [dismissed, setDismissed] = useState<boolean | null>(null);
  const [sheetVisible, setSheetVisible] = useState(false);

  useEffect(() => {
    let active = true;
    AsyncStorage.getItem(DISMISS_KEY)
      .then((v) => { if (active) setDismissed(v === "1"); })
      .catch(() => { if (active) setDismissed(false); });
    return () => { active = false; };
  }, []);

  const dismiss = useCallback(() => {
    setDismissed(true);
    AsyncStorage.setItem(DISMISS_KEY, "1").catch(() => {});
  }, []);

  // iOS only (the widget is iOS-only); render nothing while loading or once dismissed.
  if (Platform.OS !== "ios" || dismissed !== false) return null;

  return (
    <>
      <View style={styles.card}>
        <View style={styles.headerRow}>
          <View style={styles.iconWrap}>
            <Ionicons name="add-circle-outline" size={20} color={colors.teal} />
          </View>
          <AppText variant="title" style={styles.title}>
            Add the Emergency Card widget
          </AppText>
          <Pressable
            accessible
            accessibilityRole="button"
            accessibilityLabel="Dismiss"
            hitSlop={8}
            onPress={dismiss}
            style={({ pressed }) => [styles.closeBtn, pressed && { opacity: 0.6 }]}
          >
            <Ionicons name="close" size={16} color={colors.muted} />
          </Pressable>
        </View>

        <AppText variant="muted" style={styles.subtitle}>
          Keep your blood type, allergies and meds one tap away on your Home Screen.
        </AppText>

        <PrimaryButton label="Show me how" onPress={() => setSheetVisible(true)} style={styles.cta} />
      </View>

      <Modal
        transparent
        visible={sheetVisible}
        animationType="fade"
        onRequestClose={() => setSheetVisible(false)}
      >
        <Pressable
          style={styles.backdrop}
          accessible
          accessibilityRole="button"
          accessibilityLabel="Close"
          onPress={() => setSheetVisible(false)}
        >
          <Pressable style={styles.sheet} accessibilityViewIsModal onPress={() => {}}>
            <View style={styles.accentBar} />
            <View style={styles.sheetBody}>
              <AppText variant="h2">Add the widget</AppText>
              <AppText variant="muted" style={styles.sheetMessage}>
                iOS adds widgets from the Home Screen — here&apos;s how:
              </AppText>

              {STEPS.map((step, i) => (
                <View key={i} style={styles.stepRow} accessible accessibilityLabel={`Step ${i + 1}: ${step}`}>
                  <View style={styles.stepNum}>
                    <AppText variant="label" style={styles.stepNumText}>{i + 1}</AppText>
                  </View>
                  <AppText variant="muted" style={styles.stepText}>{step}</AppText>
                </View>
              ))}

              <PrimaryButton label="Got it" onPress={() => setSheetVisible(false)} style={styles.sheetCta} />
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

const useStyles = createStyles((c) => StyleSheet.create({
  card: {
    backgroundColor: c.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: c.border,
    padding: spacing.lg,
    ...shadows.xs,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  iconWrap: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: c.tealSoft,
    alignItems: "center",
    justifyContent: "center",
  },
  title: {
    flex: 1,
  },
  closeBtn: {
    width: 24,
    height: 24,
    alignItems: "center",
    justifyContent: "center",
  },
  subtitle: {
    marginTop: spacing.sm,
  },
  cta: {
    marginTop: spacing.md,
  },

  // ── How-to sheet ──
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.45)",
    justifyContent: "flex-end",
  },
  sheet: {
    backgroundColor: c.surface,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    ...shadows.lg,
  },
  accentBar: {
    alignSelf: "center",
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: c.border,
    marginTop: spacing.sm,
  },
  sheetBody: {
    padding: spacing.lg,
  },
  sheetMessage: {
    marginTop: spacing.xs,
    marginBottom: spacing.md,
  },
  stepRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  stepNum: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: c.tealSoft,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 1,
  },
  stepNumText: {
    color: c.teal,
  },
  stepText: {
    flex: 1,
  },
  sheetCta: {
    marginTop: spacing.sm,
  },
}));
