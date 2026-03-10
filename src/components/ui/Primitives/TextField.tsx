import React, { useState } from "react";
import { View, TextInput, StyleSheet, TextInputProps, Pressable } from "react-native";
import { AppText } from "./AppText";
import { colors, radius, shadows, typescale } from "../../../theme/tokens";

type Props = TextInputProps & {
  label?: string;
  rightAccessory?: React.ReactNode;
  disabled?: boolean;
};

export function TextField({ label, style, rightAccessory, onFocus, onBlur, disabled, ...props }: Props) {
  const [focused, setFocused] = useState(false);

  return (
    <View style={styles.container}>
      {label ? <AppText variant="label" style={styles.label}>{label}</AppText> : null}
      <View style={[styles.wrap, !disabled && focused && styles.wrapFocused, disabled && styles.wrapDisabled]}>
        <TextInput
          {...props}
          editable={disabled ? false : props.editable}
          placeholderTextColor={colors.subtle}
          style={[styles.input, disabled && styles.inputDisabled, style]}
          onFocus={(e) => { if (!disabled) { setFocused(true); onFocus?.(e); } }}
          onBlur={(e)  => { setFocused(false); onBlur?.(e); }}
        />
        {rightAccessory ? <View style={styles.right}>{rightAccessory}</View> : null}
      </View>
    </View>
  );
}

export function SmallTextButton({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.smallBtn, pressed && { opacity: 0.7 }]}
    >
      <AppText variant="caption" style={styles.smallBtnText}>{label}</AppText>
    </Pressable>
  );
}


const styles = StyleSheet.create({
  container: {
    gap: 7,
    width: "100%",
    minWidth: 0,
  },
  label: {
    marginBottom: 1,
  },
  labelFocused: {
    color: colors.teal,
  },
  wrap: {
    flexDirection: "row",
    alignItems: "center",
    width: "100%",
    minWidth: 0,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    paddingHorizontal: 14,
    height: 52,
    ...shadows.xs,
  },
  wrapFocused: {
    borderColor: colors.teal,
    borderWidth: 1,
    shadowColor: colors.teal,
    shadowOpacity: 0.12,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
  },
  wrapDisabled: {
    backgroundColor: colors.borderLight,
    borderColor: colors.border,
  },
  input: {
    flex: 1,
    minWidth: 0,
    height: "100%" as any,
    fontSize: typescale.size.base,
    fontWeight: typescale.weight.medium,
    color: colors.text,
    paddingVertical: 0,
  },
  inputDisabled: {
    color: colors.muted,
  },
  right: {
    marginLeft: 8,
    flexShrink: 0,
  },
  smallBtn: {
    paddingVertical: 4,
    paddingHorizontal: 2,
  },
  smallBtnText: {
    color: colors.teal,
    fontWeight: typescale.weight.semibold as any,
  },
});
