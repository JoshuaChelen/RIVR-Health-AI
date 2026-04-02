import React from "react";
import { View, Pressable, StyleSheet } from "react-native";
import { AppText } from "../Primitives/AppText";
import { radius, spacing, typescale } from "../../../theme/tokens";
import { createStyles } from "../../../theme/createStyles";

type Props = {
  options: string[];
  selected: string | null;
  onSelect: (value: string) => void;
};

export function OptionPills({ options, selected, onSelect }: Props) {
  const styles = useStyles();
  return (
    <View style={styles.row}>
      {options.map((opt) => (
        <Pressable
          key={opt}
          accessible
          accessibilityRole="button"
          accessibilityLabel={opt}
          accessibilityState={{ selected: selected === opt }}
          onPress={() => onSelect(opt)}
          style={({ pressed }) => [
            styles.pill,
            selected === opt && styles.pillSelected,
            pressed && { opacity: 0.7 },
          ]}
        >
          <AppText style={[styles.label, selected === opt && styles.labelSelected]}>
            {opt}
          </AppText>
        </Pressable>
      ))}
    </View>
  );
}

const useStyles = createStyles((c) => StyleSheet.create({
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
    borderColor: c.border,
    backgroundColor: c.surface,
  },
  pillSelected: {
    borderColor: c.teal,
    backgroundColor: c.tealSoft,
  },
  label: {
    fontSize: typescale.size.sm,
    fontWeight: typescale.weight.medium as any,
    color: c.textSub,
  },
  labelSelected: {
    color: c.teal,
    fontWeight: typescale.weight.semibold as any,
  },
}));
