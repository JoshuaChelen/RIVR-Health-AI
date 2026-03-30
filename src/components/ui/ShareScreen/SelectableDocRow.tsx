import React from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { AppText } from "../Primitives/AppText";
import Ionicons from "@expo/vector-icons/Ionicons";
import { radius, typescale } from "../../../theme/tokens";
import { createStyles } from "../../../theme/createStyles";

type Props = {
  title: string;
  subtitle: string;
  selected: boolean;
  onToggle: () => void;
};

export function SelectableDocRow({ title, subtitle, selected, onToggle }: Props) {
  const styles = useStyles();
  return (
    <Pressable
      onPress={onToggle}
      accessible
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityState={{ selected }}
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
          <Ionicons name="checkmark" size={14} color="#fff" />
        ) : null}
      </View>
    </Pressable>
  );
}

const useStyles = createStyles((c) => StyleSheet.create({
  row: {
    padding: 14,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  rowSelected: {
    backgroundColor: c.tealSoft,
  },
  textCol: { flex: 1, paddingRight: 12, gap: 3 },
  title: {
    color: c.text,
    fontSize: typescale.size.base,
  },
  subtitle: {
    color: c.muted,
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
    backgroundColor: c.teal,
    borderColor: c.teal,
  },
  boxUnselected: {
    backgroundColor: "transparent",
    borderColor: c.border,
  },
}));
