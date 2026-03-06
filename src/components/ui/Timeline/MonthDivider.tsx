import React from "react";
import { View, StyleSheet, ViewStyle, StyleProp } from "react-native";
import { AppText } from "../Primitives/AppText";
import { colors, radius, spacing, typescale } from "../../../theme/tokens";

type Props = {
  label: string;
  style?: StyleProp<ViewStyle>;
};

export function MonthDivider({ label, style }: Props) {
  return (
    <View style={[styles.row, style]}>
      <View style={styles.badge}>
        <AppText style={styles.text}>{label}</AppText>
      </View>
      <View style={styles.line} />
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingTop: spacing.lg,
    paddingBottom: spacing.xs,
  },
  badge: {
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: radius.pill,
    backgroundColor: colors.tealSoft,
    borderWidth: 1,
    borderColor: colors.tealBorder,
    flexShrink: 0,
  },
  text: {
    fontSize: typescale.size.xs,
    fontWeight: typescale.weight.bold,
    color: colors.teal,
    textTransform: "uppercase",
    letterSpacing: 0.8,
  },
  line: {
    flex: 1,
    height: 1,
    backgroundColor: colors.borderLight,
  },
});
