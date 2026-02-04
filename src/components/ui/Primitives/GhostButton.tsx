import React from "react";
import { Pressable, StyleSheet, ViewStyle, StyleProp } from "react-native";
import { AppText } from "./AppText";
import { colors, radius } from "../../../theme/tokens";

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
        disabled && { opacity: 0.5 },
        pressed && !disabled && { opacity: 0.7 },
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
    fontWeight: "600", // Reduced from 900
    fontSize: 14,
    opacity: 0.8, // Softens the "Logout" presence
  },
});