import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

type Props = {
  title: string;
  subtitle: string;
  selected: boolean;
  onToggle: () => void;
};

export function SelectableDocRow({ title, subtitle, selected, onToggle }: Props) {
  return (
    <Pressable onPress={onToggle} style={styles.row}>
      <View style={styles.textCol}>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.subtitle}>{subtitle}</Text>
      </View>

      <View style={[styles.box, selected ? styles.boxSelected : styles.boxUnselected]}>
        <Text style={styles.boxText}>{selected ? "✓" : ""}</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    padding: 12,
    borderWidth: 1,
    borderRadius: 12,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  textCol: { flex: 1, paddingRight: 12 },
  title: { fontSize: 16, fontWeight: "600" },
  subtitle: { marginTop: 4, opacity: 0.75 },
  box: {
    width: 26,
    height: 26,
    borderWidth: 1,
    borderRadius: 6,
    alignItems: "center",
    justifyContent: "center",
  },
  boxSelected: { backgroundColor: "#000", borderColor: "#000" },
  boxUnselected: { backgroundColor: "transparent", borderColor: "#000" },
  boxText: { color: "#fff", fontWeight: "800" },
});
