import React from "react";
import { View, StyleSheet } from "react-native";
import { AppText } from "../Primitives/AppText";
import { spacing, typescale } from "../../../theme/tokens";
import { createStyles } from "../../../theme/createStyles";

/**
 * Label / value row used in the profile section cards. Renders a muted em-dash
 * placeholder when the value is empty.
 */
export function DataRow({ label, value }: { label: string; value?: string | number | null }) {
  const styles = useStyles();
  const text =
    value !== null && value !== undefined && String(value).trim()
      ? String(value)
      : null;
  return (
    <View style={styles.row}>
      <AppText variant="label" style={styles.label}>{label}</AppText>
      <AppText style={[styles.value, !text && styles.empty]} numberOfLines={2}>
        {text ?? "—"}
      </AppText>
    </View>
  );
}

const useStyles = createStyles((c) => StyleSheet.create({
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    paddingVertical: 8,
    gap: spacing.sm,
  },
  label: {
    flex: 1,
    paddingTop: 1,
    color: c.muted,
  },
  value: {
    flex: 1.5,
    textAlign: "right",
    fontSize: typescale.size.base,
    fontWeight: typescale.weight.medium as any,
    color: c.text,
  },
  empty: {
    color: c.subtle,
    fontWeight: typescale.weight.regular as any,
  },
}));
