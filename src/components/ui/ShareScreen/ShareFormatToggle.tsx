import React from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { AppText } from "../Primitives/AppText";
import { colors, radius, typescale } from "../../../theme/tokens";

export type ShareFileType = "card" | "pdf" | "fhir";

type Props = {
  value: ShareFileType;
  onChange: (v: ShareFileType) => void;
};

export function ShareFormatToggle({ value, onChange }: Props) {
  return (
    <View style={styles.track}>
      <TogglePill label="Card" active={value === "card"} onPress={() => onChange("card")} />
      <TogglePill label="FHIR" active={value === "fhir"} onPress={() => onChange("fhir")} />
      <TogglePill label="PDF"  active={value === "pdf"}  onPress={() => onChange("pdf")} />
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
      style={({ pressed }) => [
        styles.pill,
        active ? styles.pillActive : styles.pillInactive,
        pressed && { opacity: 0.85 },
      ]}
    >
      <AppText
        variant="label"
        style={[
          styles.pillText,
          active ? styles.pillTextActive : styles.pillTextInactive,
        ]}
      >
        {label}
      </AppText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  track: {
    flexDirection: "row",
    gap: 8,
    backgroundColor: colors.bgSecondary,
    padding: 4,
    borderRadius: radius.pill,
    alignSelf: "flex-start",
  },
  pill: {
    paddingVertical: 8,
    paddingHorizontal: 18,
    borderRadius: radius.pill,
  },
  pillActive: {
    backgroundColor: colors.teal,
  },
  pillInactive: {
    backgroundColor: "transparent",
  },
  pillText: {
    letterSpacing: 0.4,
    textTransform: "uppercase",
  },
  pillTextActive: {
    color: "#fff",
    fontWeight: typescale.weight.bold,
  },
  pillTextInactive: {
    color: colors.muted,
    fontWeight: typescale.weight.semibold,
  },
});
