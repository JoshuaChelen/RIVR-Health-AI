import React from "react";
import { View, StyleSheet, ViewProps } from "react-native";
import { radius, shadows } from "../../../theme/tokens";
import { createStyles } from "../../../theme/createStyles";

type Props = ViewProps & {
  variant?: "default" | "flat" | "elevated";
};

export function Card({ style, variant = "default", ...props }: Props) {
  const styles = useStyles();
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

const useStyles = createStyles((c) => StyleSheet.create({
  card: {
    backgroundColor: c.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: c.border,
    padding: 14,
    ...shadows.card,
  },
  flat: {
    ...shadows.xs,
    borderColor: c.borderLight,
  },
  elevated: {
    ...shadows.lg,
    borderWidth: 0,
  },
}));
