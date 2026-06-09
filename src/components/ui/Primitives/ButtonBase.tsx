import React from "react";
import { Pressable, StyleProp, ViewStyle, TextStyle } from "react-native";
import { AppText } from "./AppText";

type Props = {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  /** Base container style for this button variant. */
  btnStyle: StyleProp<ViewStyle>;
  /** Label text style. */
  textStyle: StyleProp<TextStyle>;
  /** Applied while disabled. */
  disabledStyle: StyleProp<ViewStyle>;
  /** Applied while pressed (and not disabled). */
  pressedStyle: StyleProp<ViewStyle>;
  /** Optional extra container style applied right after btnStyle (e.g. a dynamic tone background). */
  extraStyle?: StyleProp<ViewStyle>;
  textVariant?: "body" | "caption";
};

/**
 * Shared Pressable + label scaffold for the button primitives
 * (PrimaryButton / SecondaryButton / GhostButton). Each variant supplies its
 * own styles; this owns the accessibility wiring and pressed/disabled state.
 */
export function ButtonBase({
  label,
  onPress,
  disabled,
  style,
  btnStyle,
  textStyle,
  disabledStyle,
  pressedStyle,
  extraStyle,
  textVariant = "body",
}: Props) {
  return (
    <Pressable
      accessible
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        btnStyle,
        extraStyle,
        disabled && disabledStyle,
        pressed && !disabled && pressedStyle,
        style,
      ]}
    >
      <AppText variant={textVariant} style={textStyle}>
        {label}
      </AppText>
    </Pressable>
  );
}
