import React from "react";
import { Modal, View, Pressable, StyleSheet } from "react-native";
import { AppText } from "./AppText";
import { spacing, radius, typescale, shadows } from "../../../theme/tokens";
import { createStyles } from "../../../theme/createStyles";

/**
 * Bottom-anchored modal sheet with a colored accent bar, used for action
 * sheets and confirmation dialogs. Tapping the backdrop calls onClose; the
 * sheet itself swallows the press. Pass the action buttons/rows as children.
 */
export function BottomSheet({
  visible,
  onClose,
  accent = "teal",
  title,
  message,
  children,
}: {
  visible: boolean;
  onClose: () => void;
  accent?: "teal" | "danger";
  title?: string;
  message?: string;
  children?: React.ReactNode;
}) {
  const styles = useStyles();
  return (
    <Modal transparent visible={visible} animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={() => {}}>
          <View style={[styles.accentBar, accent === "danger" ? styles.accentDanger : styles.accentTeal]} />
          <View style={styles.body}>
            {title ? <AppText style={styles.title}>{title}</AppText> : null}
            {message ? <AppText style={styles.message}>{message}</AppText> : null}
            {children}
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const useStyles = createStyles((c) => StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(13,27,42,0.45)",
    alignItems: "center",
    justifyContent: "flex-end",
    paddingBottom: spacing.xxl,
    paddingHorizontal: spacing.lg,
  },
  sheet: {
    width: "100%",
    backgroundColor: c.surface,
    borderRadius: radius.xl,
    overflow: "hidden",
    ...shadows.lg,
  },
  accentBar: { height: 4 },
  accentDanger: { backgroundColor: c.danger },
  accentTeal: { backgroundColor: c.teal },
  body: {
    padding: spacing.lg,
    gap: spacing.sm,
  },
  title: {
    fontSize: typescale.size.lg,
    fontWeight: typescale.weight.bold,
    color: c.text,
  },
  message: {
    fontSize: typescale.size.sm,
    color: c.textSub,
    lineHeight: typescale.size.sm * typescale.lineHeight.relaxed,
  },
}));
