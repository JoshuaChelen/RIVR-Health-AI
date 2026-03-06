import React from "react";
import { View, TextInput, StyleSheet, TextInputProps, Pressable } from "react-native";
import { AppText } from "./AppText";
import { colors, radius, shadows, typescale } from "../../../theme/tokens";

type Props = TextInputProps & {
  label?: string;
  rightAccessory?: React.ReactNode;
};

export function TextField({ label, style, rightAccessory, ...props }: Props) {
  return (
    <View style={styles.container}>
      {label ? <AppText variant="label" style={styles.label}>{label}</AppText> : null}
      <View style={styles.wrap}>
        <TextInput
          {...props}
          placeholderTextColor={colors.subtle}
          style={[styles.input, style]}
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
  container: { gap: 7 },
  label: {
    marginBottom: 1,
  },
  wrap: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    paddingHorizontal: 14,
    height: 50,
    ...shadows.xs,
  },
  input: {
    flex: 1,
    fontSize: typescale.size.base,
    fontWeight: typescale.weight.medium,
    color: colors.text,
  },
  right: { marginLeft: 10 },
  smallBtn: {
    paddingHorizontal: 6,
    paddingVertical: 4,
  },
  smallBtnText: {
    color: colors.teal,
    fontWeight: typescale.weight.bold,
  },
});
