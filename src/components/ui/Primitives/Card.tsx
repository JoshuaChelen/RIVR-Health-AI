import React from "react";
import { View, StyleSheet, ViewProps } from "react-native";
import { colors, radius, shadows } from "../../../theme/tokens";

type Props = ViewProps & {
  variant?: "default" | "flat" | "elevated";
};

export function Card({ style, variant = "default", ...props }: Props) {
  return (
    <View
      {...props}
      style={[
        styles.card,
        variant === "flat" && styles.flat,
        variant === "elevated" && styles.elevated,
        style,
      ]}
    />
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 14,
    ...shadows.card,
  },
  flat: {
    ...shadows.xs,
    borderColor: colors.borderLight,
  },
  elevated: {
    ...shadows.lg,
    borderWidth: 0,
  },
});
