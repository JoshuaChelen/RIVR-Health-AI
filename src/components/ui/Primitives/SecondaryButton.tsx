import React from "react";
import { Pressable, StyleSheet, ViewStyle, StyleProp } from "react-native";
import { AppText } from "./AppText";
import { colors, radius, typescale } from "../../../theme/tokens";

type Props = {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
};

export function SecondaryButton({ label, onPress, disabled, style }: Props) {
  return (
    <Pressable
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.btn,
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
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  text: {
    color: colors.text,
    fontWeight: typescale.weight.semibold,
    fontSize: typescale.size.base,
  },
  disabled: {
    opacity: 0.45,
  },
  pressed: {
    opacity: 0.75,
    backgroundColor: colors.bgSecondary,
  },
});
