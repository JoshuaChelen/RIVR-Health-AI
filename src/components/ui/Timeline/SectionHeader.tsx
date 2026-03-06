import React from "react";
import { View, StyleSheet, ViewStyle, StyleProp } from "react-native";
import { AppText } from "../Primitives/AppText";
import { colors } from "../../../theme/tokens";

type Props = {
  title: string;
  subtitle?: string;
  right?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
};

export function SectionHeader({ title, subtitle, right, style }: Props) {
  return (
    <View style={[styles.wrap, style]}>
      <View style={styles.row}>
        <View style={styles.left}>
          <AppText variant="h2" style={styles.title}>{title}</AppText>
          {subtitle ? (
            <AppText variant="caption" style={styles.subtitle}>{subtitle}</AppText>
          ) : null}
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
    paddingTop: 14,
    paddingBottom: 10,
    gap: 12,
  },
  left:  { flex: 1 },
  right: { alignItems: "flex-end" },
  title: {
    color: colors.text,
  },
  subtitle: {
    marginTop: 2,
    color: colors.muted,
  },
  divider: {
    height: 1,
    backgroundColor: colors.border,
  },
});
