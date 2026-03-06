import React from "react";
import { View, StyleSheet, ViewStyle, StyleProp } from "react-native";
import { AppText } from "../Primitives/AppText";
import { colors, radius } from "../../../theme/tokens";

type Props = {
  label: string;
  style?: StyleProp<ViewStyle>;
};

export function MonthDivider({ label, style }: Props) {
  return (
    <View style={[styles.row, style]}>
      <View style={styles.line} />
      <View style={styles.pill}>
        <AppText variant="label" style={styles.text}>{label}</AppText>
      </View>
      <View style={styles.line} />
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 10,
  },
  line: {
    flex: 1,
    height: 1,
    backgroundColor: colors.border,
  },
  pill: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: radius.pill,
    backgroundColor: colors.tealSoft,
    borderWidth: 1,
    borderColor: colors.tealBorder,
  },
  text: {
    color: colors.teal,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
});
