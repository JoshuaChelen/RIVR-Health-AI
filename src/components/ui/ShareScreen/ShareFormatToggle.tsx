import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

export type ShareFileType = "card" | "pdf" | "fhir";

type Props = {
  value: ShareFileType;
  onChange: (v: ShareFileType) => void;
};

export function ShareFormatToggle({ value, onChange }: Props) {
  return (
    <View style={styles.row}>
      <TogglePill
        label="Card"
        active={value === "card"}
        onPress={() => onChange("card")}
      />
      <TogglePill
        label="FHIR"
        active={value === "fhir"}
        onPress={() => onChange("fhir")}
      />
      <TogglePill
        label="PDF"
        active={value === "pdf"}
        onPress={() => onChange("pdf")}
      />
    </View>
  );
}

function TogglePill({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={[styles.pill, active ? styles.pillActive : styles.pillInactive]}
    >
      <Text style={[styles.pillText, active ? styles.pillTextActive : styles.pillTextInactive]}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", gap: 10 },
  pill: {
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderRadius: 999,
  },
  pillActive: { backgroundColor: "#000", borderColor: "#000" },
  pillInactive: { backgroundColor: "transparent", borderColor: "#000" },
  pillText: { fontSize: 14, fontWeight: "600" },
  pillTextActive: { color: "#fff" },
  pillTextInactive: { color: "#000" },
});
