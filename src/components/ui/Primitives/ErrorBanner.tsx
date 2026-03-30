import React from "react";
import { View, Pressable, StyleSheet } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { AppText } from "./AppText";
import { radius, spacing, typescale } from "../../../theme/tokens";
import { createStyles } from "../../../theme/createStyles";
import { useTheme } from "../../../context/ThemeContext";

type Props = {
  message: string | null;
  onRetry?: () => void;
};

export function ErrorBanner({ message, onRetry }: Props) {
  const styles = useStyles();
  const { colors } = useTheme();
  if (!message) return null;
  return (
    <View style={styles.banner} accessibilityRole="alert" accessibilityLabel={message}>
      <Ionicons name="alert-circle" size={18} color={colors.warning} accessible={false} />
      <AppText style={styles.text}>{message}</AppText>
      {onRetry ? (
        <Pressable
          accessible
          accessibilityRole="button"
          accessibilityLabel="Retry"
          accessibilityHint="Attempts the failed action again"
          onPress={onRetry}
          style={({ pressed }) => [styles.retryBtn, pressed && { opacity: 0.6 }]}
        >
          <AppText style={styles.retryText}>Retry</AppText>
        </Pressable>
      ) : null}
    </View>
  );
}

const useStyles = createStyles((c) => StyleSheet.create({
  banner: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    backgroundColor: c.warnSoft,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderWidth: 1,
    borderColor: "rgba(217,119,6,0.20)",
  },
  text: {
    flex: 1,
    fontSize: typescale.size.sm,
    color: c.warning,
    fontWeight: typescale.weight.medium as any,
  },
  retryBtn: {
    paddingVertical: spacing.xxs,
    paddingHorizontal: spacing.xs,
  },
  retryText: {
    fontSize: typescale.size.sm,
    fontWeight: typescale.weight.semibold as any,
    color: c.warning,
  },
}));
