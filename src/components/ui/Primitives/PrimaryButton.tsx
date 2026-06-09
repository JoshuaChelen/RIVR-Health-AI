import React from "react";
import { StyleSheet, ViewStyle, StyleProp } from "react-native";
import { ButtonBase } from "./ButtonBase";
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
    <ButtonBase
      label={label}
      onPress={onPress}
      disabled={disabled}
      style={style}
      btnStyle={styles.btn}
      textStyle={styles.text}
      disabledStyle={styles.disabled}
      pressedStyle={styles.pressed}
      extraStyle={{ backgroundColor: toneMap[tone] }}
    />
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
