import React, { useState } from "react";
import { View, TextInput, StyleSheet, TextInputProps, Pressable } from "react-native";
import { AppText } from "./AppText";
import { radius, shadows, typescale } from "../../../theme/tokens";
import { createStyles } from "../../../theme/createStyles";
import { useTheme } from "../../../context/ThemeContext";

type Props = TextInputProps & {
  label?: string;
  rightAccessory?: React.ReactNode;
  disabled?: boolean;
};

export function TextField({ label, style, rightAccessory, onFocus, onBlur, disabled, ...props }: Props) {
  const [focused, setFocused] = useState(false);
  const styles = useStyles();
  const { colors } = useTheme();

  return (
    <View style={styles.container}>
      {label ? <AppText variant="label" style={styles.label}>{label}</AppText> : null}
      <View style={[styles.wrap, !disabled && focused && styles.wrapFocused, disabled && styles.wrapDisabled]}>
        <TextInput
          {...props}
          accessibilityLabel={props.accessibilityLabel ?? label}
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
  const styles = useStyles();
  return (
    <Pressable
      accessible
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [styles.smallBtn, pressed && { opacity: 0.7 }]}
    >
      <AppText variant="caption" style={styles.smallBtnText}>{label}</AppText>
    </Pressable>
  );
}


const useStyles = createStyles((c) => StyleSheet.create({
  container: {
    gap: 7,
    width: "100%",
    minWidth: 0,
  },
  label: {
    marginBottom: 1,
  },
  labelFocused: {
    color: c.teal,
  },
  wrap: {
    flexDirection: "row",
    alignItems: "center",
    width: "100%",
    minWidth: 0,
    borderWidth: 1,
    borderColor: c.border,
    borderRadius: radius.md,
    backgroundColor: c.surface,
    paddingHorizontal: 14,
    height: 52,
    ...shadows.xs,
  },
  wrapFocused: {
    borderColor: c.teal,
    borderWidth: 1,
    shadowColor: c.teal,
    shadowOpacity: 0.12,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
  },
  wrapDisabled: {
    backgroundColor: c.borderLight,
    borderColor: c.border,
  },
  input: {
    flex: 1,
    minWidth: 0,
    height: "100%" as any,
    fontSize: typescale.size.base,
    fontWeight: typescale.weight.medium,
    color: c.text,
    paddingVertical: 0,
  },
  inputDisabled: {
    color: c.muted,
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
    color: c.teal,
    fontWeight: typescale.weight.semibold as any,
  },
}));
