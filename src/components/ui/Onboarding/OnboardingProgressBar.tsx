import React from "react";
import { View, StyleSheet } from "react-native";
import { AppText } from "../Primitives/AppText";
import { radius, spacing } from "../../../theme/tokens";
import { createStyles } from "../../../theme/createStyles";

type Props = {
  current: number; // 1-based
  total: number;
};

export function OnboardingProgressBar({ current, total }: Props) {
  const styles = useStyles();
  return (
    <View style={styles.root}>
      <View style={styles.segments}>
        {Array.from({ length: total }).map((_, i) => (
          <View
            key={i}
            style={[styles.segment, i < current ? styles.filled : styles.empty]}
          />
        ))}
      </View>
      <AppText variant="caption" style={styles.label}>
        Step {current} of {total}
      </AppText>
    </View>
  );
}

const useStyles = createStyles((c) => StyleSheet.create({
  root: {
    gap: spacing.xs,
  },
  segments: {
    flexDirection: "row",
    gap: spacing.xs,
  },
  segment: {
    flex: 1,
    height: 4,
    borderRadius: radius.pill,
  },
  filled: {
    backgroundColor: c.teal,
  },
  empty: {
    backgroundColor: c.border,
  },
  label: {
    color: c.muted,
    textAlign: "right",
  },
}));
