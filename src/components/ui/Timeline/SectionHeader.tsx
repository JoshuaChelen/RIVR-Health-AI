// components/SectionHeader.tsx
import React from "react";
import { View, Text, StyleSheet, ViewStyle, StyleProp } from "react-native";

type Props = {
  title: string;                 // e.g. "Health Timeline" / "Action Needed"
  subtitle?: string;             // optional small line under title
  right?: React.ReactNode;       // optional right-side content (tabs, button, etc.)
  style?: StyleProp<ViewStyle>;
};

export function SectionHeader({ title, subtitle, right, style }: Props) {
  return (
    <View style={[styles.wrap, style]}>
      <View style={styles.row}>
        <View style={styles.left}>
          <Text style={styles.title}>{title}</Text>
          {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
        </View>
        {right ? <View style={styles.right}>{right}</View> : null}
      </View>
      <View style={styles.divider} />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { width: "100%" },
  row: {
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 8,
    gap: 12,
  },
  left: { flex: 1 },
  right: { alignItems: "flex-end" },
  title: {
    fontSize: 15,
    fontWeight: "800",
    color: "#0F172A",
  },
  subtitle: {
    marginTop: 3,
    fontSize: 12,
    color: "#64748B",
    fontWeight: "600",
  },
  divider: {
    height: 1,
    backgroundColor: "#E6EEF5",
  },
});
