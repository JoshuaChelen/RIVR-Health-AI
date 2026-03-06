import React from "react";
import { Pressable, StyleSheet, ViewStyle, StyleProp } from "react-native";
import { AppText } from "./AppText";
import { colors, typescale } from "../../../theme/tokens";

type Props = {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
};

export function GhostButton({ label, onPress, disabled, style }: Props) {
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
      <AppText variant="caption" style={styles.text}>
        {label}
      </AppText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  btn: {
    height: 44,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "transparent",
  },
  text: {
    color: colors.teal,
    fontWeight: typescale.weight.semibold,
    fontSize: typescale.size.base,
  },
  disabled: {
    opacity: 0.4,
  },
  pressed: {
    opacity: 0.65,
  },
});
