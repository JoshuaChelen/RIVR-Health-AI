// components/MonthDivider.tsx
import React from "react";
import { View, Text, StyleSheet, ViewStyle, StyleProp } from "react-native";

type Props = {
  label: string;                 // "November 2025"
  style?: StyleProp<ViewStyle>;
};

export function MonthDivider({ label, style }: Props) {
  return (
    <View style={[styles.row, style]}>
      <View style={styles.line} />
      <View style={styles.pill}>
        <Text style={styles.text}>{label}</Text>
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
    backgroundColor: "#DDF2E6",
  },
  pill: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: "#EAFBF1",
    borderWidth: 1,
    borderColor: "#BFEACF",
  },
  text: {
    fontSize: 13,
    fontWeight: "800",
    color: "#0F7A4A",
  },
});
