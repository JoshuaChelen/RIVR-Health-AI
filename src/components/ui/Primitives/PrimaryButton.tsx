import React from "react";
import { Pressable, StyleSheet, ViewStyle, StyleProp } from "react-native";
import { AppText } from "./AppText";
import { radius, typescale } from "../../../theme/tokens";
import { useTheme } from "../../../context/ThemeContext";

type Props = {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  tone?: "teal" | "blue" | "green" | "orange";
  style?: StyleProp<ViewStyle>;
};

export function PrimaryButton({ label, onPress, disabled, tone = "teal", style }: Props) {
  const { colors } = useTheme();

  const toneMap = {
    teal:   colors.teal,
    blue:   colors.blue,
    green:  colors.green,
    orange: colors.orange,
  };

  return (
    <Pressable
      accessible
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.btn,
        { backgroundColor: toneMap[tone] },
        disabled && styles.disabled,
        pressed && !disabled && styles.pressed,
        style,
      ]}
    >
      <AppText variant="body" style={styles.text}>
        {label}
      </AppText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  btn: {
    height: 48,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 16,
  },
  text: {
    color: "#fff",
    fontWeight: typescale.weight.bold,
    fontSize: typescale.size.base,
  },
  disabled: {
    opacity: 0.45,
  },
  pressed: {
    opacity: 0.88,
    transform: [{ scale: 0.985 }],
  },
});
