import React from "react";
import { View, Pressable, Text, StyleSheet } from "react-native";
import { colors, radius, spacing, typescale } from "../../../theme/tokens";

type Props = {
  options: string[];
  selected: string | null;
  onSelect: (value: string) => void;
};

export function OptionPills({ options, selected, onSelect }: Props) {
  return (
    <View style={styles.row}>
      {options.map((opt) => (
        <Pressable
          key={opt}
          onPress={() => onSelect(opt)}
          style={({ pressed }) => [
            styles.pill,
            selected === opt && styles.pillSelected,
            pressed && { opacity: 0.7 },
          ]}
        >
          <Text style={[styles.label, selected === opt && styles.labelSelected]}>
            {opt}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.xs,
  },
  pill: {
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: radius.pill,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  pillSelected: {
    borderColor: colors.teal,
    backgroundColor: colors.tealSoft,
  },
  label: {
    fontSize: typescale.size.sm,
    fontWeight: typescale.weight.medium as any,
    color: colors.textSub,
  },
  labelSelected: {
    color: colors.teal,
    fontWeight: typescale.weight.semibold as any,
  },
});
