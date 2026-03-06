import React from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { AppText } from "../Primitives/AppText";
import { colors, radius, typescale } from "../../../theme/tokens";

type Props = {
  title: string;
  subtitle: string;
  selected: boolean;
  onToggle: () => void;
};

export function SelectableDocRow({ title, subtitle, selected, onToggle }: Props) {
  return (
    <Pressable
      onPress={onToggle}
      style={({ pressed }) => [
        styles.row,
        selected && styles.rowSelected,
        pressed && { opacity: 0.85 },
      ]}
    >
      <View style={styles.textCol}>
        <AppText variant="title" style={styles.title}>{title}</AppText>
        <AppText variant="caption" style={styles.subtitle}>{subtitle}</AppText>
      </View>

      <View style={[styles.box, selected ? styles.boxSelected : styles.boxUnselected]}>
        {selected ? (
          <AppText style={styles.checkmark}>✓</AppText>
        ) : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    padding: 14,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  rowSelected: {
    backgroundColor: colors.tealSoft,
  },
  textCol: { flex: 1, paddingRight: 12, gap: 3 },
  title: {
    color: colors.text,
    fontSize: typescale.size.base,
  },
  subtitle: {
    color: colors.muted,
    marginTop: 2,
  },
  box: {
    width: 24,
    height: 24,
    borderWidth: 1.5,
    borderRadius: radius.xs,
    alignItems: "center",
    justifyContent: "center",
  },
  boxSelected: {
    backgroundColor: colors.teal,
    borderColor: colors.teal,
  },
  boxUnselected: {
    backgroundColor: "transparent",
    borderColor: colors.border,
  },
  checkmark: {
    color: "#fff",
    fontWeight: typescale.weight.bold,
    fontSize: typescale.size.xs,
  },
});
